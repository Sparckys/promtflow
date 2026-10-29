package com.guionflow.tablet;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.Build;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;

import org.json.JSONObject;

import java.util.function.Consumer;

// Teleprompter flotante: una ventana encima de Loom, la cámara, Slides o cualquier otra app.
// Con "Invisible en la grabación" activo lleva FLAG_SECURE: Android no deja que ninguna
// grabación ni captura de pantalla copie su contenido (en una grabación de pantalla completa
// sale como un recuadro negro; si Loom graba solo una app, no aparece en absoluto).
public class PrompterService extends Service {
    static PrompterService instance;

    static final String CHANNEL = "prompter";
    private static final int NOTIF_ID = 7;
    private static final String ACT_TOGGLE = "com.guionflow.tablet.TOGGLE";
    private static final String ACT_SHOW = "com.guionflow.tablet.SHOW";
    private static final String ACT_TOUCH = "com.guionflow.tablet.TOUCH";
    private static final String ACT_CLOSE = "com.guionflow.tablet.CLOSE";

    private Hub hub;
    private WindowManager wm;
    private WebView view;
    private WindowManager.LayoutParams lp;
    private boolean visible = true;

    private boolean dragging;
    private float lastRawX, lastRawY;

    private Consumer<Integer> recordingCallback;
    private int recordingState = -1;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        hub = Hub.get(this);
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        goForeground();
        createWindow();
        registerRecordingCallback();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (action == null) return START_NOT_STICKY;
        switch (action) {
            case ACT_TOGGLE: hub.handleCommand("toggle", null); break;
            case ACT_SHOW: setVisible(!visible); break;
            case ACT_TOUCH: hub.setClickThrough(false); break;
            case ACT_CLOSE: stopSelf(); break;
            default:
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        unregisterRecordingCallback();
        if (view != null) {
            try { wm.removeView(view); } catch (Exception ignored) { }
            view.destroy();
            view = null;
        }
        instance = null;
        hub.onPrompterClosed();
        super.onDestroy();
    }

    boolean hasWindow() { return view != null; }

    boolean isVisible() { return visible; }

    // ---------- Ventana ----------

    @SuppressLint("ClickableViewAccessibility")
    private void createWindow() {
        lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, 0, PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        Rect b = initialBounds();
        lp.x = b.left;
        lp.y = b.top;
        lp.width = b.width();
        lp.height = b.height();
        lp.setTitle("GuionFlow");

        view = new WebView(this);
        view.setBackgroundColor(Color.TRANSPARENT);
        view.setOnTouchListener((v, e) -> {
            float rx = e.getRawX(), ry = e.getRawY();
            int action = e.getActionMasked();
            if (dragging && action == MotionEvent.ACTION_MOVE) {
                lp.x = Math.round(lp.x + rx - lastRawX);
                lp.y = Math.round(lp.y + ry - lastRawY);
                clampToScreen();
                wm.updateViewLayout(view, lp);
            }
            lastRawX = rx;
            lastRawY = ry;
            if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                if (dragging) rememberBounds();
                dragging = false;
            }
            return false;
        });
        applyFlags(false);
        wm.addView(view, lp);
        hub.prompterView = view;
        hub.setupWebView(view, "prompter.html");
    }

    void startDrag() { dragging = true; }

    // Combina las opciones: protección de captura, click-through y oculto.
    void applyFlags() { applyFlags(true); }

    private void applyFlags(boolean update) {
        int f = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED;
        if (hub.protection()) f |= WindowManager.LayoutParams.FLAG_SECURE;
        // Android 12+ solo deja pasar los toques a la app de abajo si la ventana es al menos 20 % transparente.
        if (!visible) {
            f |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
            lp.alpha = 0f;
        } else if (hub.clickThrough) {
            f |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
            lp.alpha = 0.8f;
        } else {
            lp.alpha = 1f;
        }
        lp.flags = f;
        if (update && view != null) wm.updateViewLayout(view, lp);
    }

    void setVisible(boolean v) {
        if (view == null) return;
        visible = v;
        view.setVisibility(v ? View.VISIBLE : View.INVISIBLE);
        applyFlags();
        updateNotification();
        hub.updateStatus(new JSONObject());
    }

    private Rect screen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return wm.getCurrentWindowMetrics().getBounds();
        }
        DisplayMetrics m = new DisplayMetrics();
        //noinspection deprecation
        wm.getDefaultDisplay().getRealMetrics(m);
        return new Rect(0, 0, m.widthPixels, m.heightPixels);
    }

    private int dp(float v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private Rect initialBounds() {
        Rect s = screen();
        JSONObject saved = hub.store.getSettings().optJSONObject("prompterBounds");
        if (saved != null) {
            Rect r = new Rect(saved.optInt("x"), saved.optInt("y"),
                    saved.optInt("x") + saved.optInt("width"), saved.optInt("y") + saved.optInt("height"));
            if (r.width() >= dp(280) && r.height() >= dp(120) && r.width() <= s.width() && r.height() <= s.height()
                    && r.left >= -dp(40) && r.right <= s.width() + dp(40) && r.top >= 0 && r.top < s.height() - dp(60)) return r;
        }
        // Arriba al centro, junto a la cámara frontal.
        int w = Math.min(dp(900), Math.round(s.width() * 0.62f));
        int h = Math.min(dp(380), Math.round(s.height() * 0.36f));
        int x = (s.width() - w) / 2;
        return new Rect(x, dp(28), x + w, dp(28) + h);
    }

    private void clampToScreen() {
        Rect s = screen();
        lp.width = Math.min(lp.width, s.width());
        lp.height = Math.min(lp.height, s.height());
        lp.x = Math.max(-lp.width + dp(80), Math.min(s.width() - dp(80), lp.x));
        lp.y = Math.max(0, Math.min(s.height() - dp(48), lp.y));
    }

    private void rememberBounds() {
        hub.savePrompterBounds(lp.x, lp.y, lp.width, lp.height);
    }

    void resizeCss(double w, double h) {
        if (view == null) return;
        float d = getResources().getDisplayMetrics().density;
        lp.width = Math.max(dp(280), (int) Math.round(w * d));
        lp.height = Math.max(dp(120), (int) Math.round(h * d));
        clampToScreen();
        wm.updateViewLayout(view, lp);
        rememberBounds();
    }

    void position(String preset) {
        if (view == null) return;
        Rect s = screen();
        int sw = s.width(), sh = s.height(), m = dp(10), top = dp(28);
        switch (preset) {
            case "camera": lp.width = Math.round(sw * 0.6f); lp.height = Math.round(sh * 0.34f); lp.x = (sw - lp.width) / 2; lp.y = top; break;
            case "bottom": lp.width = Math.round(sw * 0.7f); lp.height = Math.round(sh * 0.3f); lp.x = (sw - lp.width) / 2; lp.y = sh - lp.height - dp(56); break;
            case "left": lp.width = Math.round(sw * 0.36f); lp.height = Math.round(sh * 0.78f); lp.x = m; lp.y = (sh - lp.height) / 2; break;
            case "right": lp.width = Math.round(sw * 0.36f); lp.height = Math.round(sh * 0.78f); lp.x = sw - lp.width - m; lp.y = (sh - lp.height) / 2; break;
            case "full": lp.width = sw; lp.height = sh - top; lp.x = 0; lp.y = top; break;
            default: lp.x = (sw - lp.width) / 2; lp.y = top;
        }
        clampToScreen();
        wm.updateViewLayout(view, lp);
        rememberBounds();
        setVisible(true);
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        if (view == null) return;
        clampToScreen();
        wm.updateViewLayout(view, lp);
    }

    // ---------- ¿Lo ve una grabación? (Android 15+) ----------

    private void registerRecordingCallback() {
        if (Build.VERSION.SDK_INT < 35) return;
        try {
            recordingCallback = state -> hub.main.post(() -> {
                recordingState = state;
                pushRecordingState();
            });
            recordingState = wm.addScreenRecordingCallback(getMainExecutor(), recordingCallback);
        } catch (Exception e) {
            recordingCallback = null;
        }
    }

    private void unregisterRecordingCallback() {
        if (Build.VERSION.SDK_INT < 35 || recordingCallback == null) return;
        try { wm.removeScreenRecordingCallback(recordingCallback); } catch (Exception ignored) { }
        recordingCallback = null;
    }

    // "visible" = una grabación de pantalla está captando la pantalla donde está el teleprompter.
    void pushRecordingState() {
        if (recordingState < 0 || Build.VERSION.SDK_INT < 35) return;
        boolean captured = recordingState == WindowManager.SCREEN_RECORDING_STATE_VISIBLE;
        try {
            JSONObject o = new JSONObject().put("captured", captured).put("protected", hub.protection());
            hub.sendToPrompter("recording", o);
            hub.sendToMain("recording", o);
        } catch (Exception ignored) { }
    }

    // ---------- Notificación con controles ----------

    private void goForeground() {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTIF_ID, n);
    }

    void updateNotification() {
        android.app.NotificationManager nm = getSystemService(android.app.NotificationManager.class);
        if (nm != null) nm.notify(NOTIF_ID, buildNotification());
    }

    private PendingIntent action(String a) {
        return PendingIntent.getService(this, a.hashCode(), new Intent(this, PrompterService.class).setAction(a),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification buildNotification() {
        boolean en = "en".equals(hub.store.getSettings().optString("language"));
        PendingIntent open = PendingIntent.getActivity(this, 1, new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_notif)
                .setContentTitle(en ? "Teleprompter open" : "Teleprompter abierto")
                .setContentText(!visible ? (en ? "Hidden — tap Show to bring it back" : "Oculto — pulsa Mostrar para verlo")
                        : hub.clickThrough ? (en ? "Touches pass through the script" : "Los toques atraviesan el guion")
                        : (en ? "Invisible in recordings when protection is on" : "Invisible en la grabación si la protección está activa"))
                .setContentIntent(open)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .addAction(new Notification.Action.Builder(null, hub.isPlaying() ? (en ? "Pause" : "Pausar") : (en ? "Start" : "Iniciar"), action(ACT_TOGGLE)).build());
        if (hub.clickThrough && visible) {
            b.addAction(new Notification.Action.Builder(null, en ? "Touch script" : "Tocar guion", action(ACT_TOUCH)).build());
        } else {
            b.addAction(new Notification.Action.Builder(null, visible ? (en ? "Hide" : "Ocultar") : (en ? "Show" : "Mostrar"), action(ACT_SHOW)).build());
        }
        b.addAction(new Notification.Action.Builder(null, en ? "Close" : "Cerrar", action(ACT_CLOSE)).build());
        return b.build();
    }
}
