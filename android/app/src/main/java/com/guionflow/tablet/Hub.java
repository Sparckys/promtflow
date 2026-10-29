package com.guionflow.tablet;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// Equivalente al proceso principal de Electron (desktop/src/main.js): guarda los datos,
// recibe los mensajes de la interfaz (window.pf) y coordina el editor con el teleprompter flotante.
final class Hub {
    private static Hub instance;

    static synchronized Hub get(Context ctx) {
        if (instance == null) instance = new Hub(ctx.getApplicationContext());
        return instance;
    }

    final Context app;
    final Store store;
    final Handler main = new Handler(Looper.getMainLooper());

    MainActivity activity;
    WebView mainView;
    WebView prompterView;

    String currentScriptId;
    boolean clickThrough;
    String pendingThenCmd;
    private JSONObject lastStatus = new JSONObject();
    private boolean lastPlaying;

    private static final String[][] SHORTCUTS = {
            {"CommandOrControl+Alt+P", "countdown"},
            {"CommandOrControl+Alt+I", "toggle"},
            {"CommandOrControl+Alt+Up", "faster"},
            {"CommandOrControl+Alt+Down", "slower"},
            {"CommandOrControl+Alt+B", "back"},
            {"CommandOrControl+Alt+F", "forward"},
            {"CommandOrControl+Alt+N", "nextSection"},
            {"CommandOrControl+Alt+V", "prevSection"},
            {"CommandOrControl+Alt+X", "clickThrough"},
            {"CommandOrControl+Alt+H", "hide"},
    };

    private Hub(Context app) {
        this.app = app;
        this.store = new Store(app);
    }

    // ---------- WebViews ----------

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    void setupWebView(WebView view, String page) {
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setGeolocationEnabled(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) s.setSafeBrowsingEnabled(false); // todo es local: no hace falta consultar a Google
        view.setWebViewClient(new LocalClient(app));
        view.setWebChromeClient(new WebChromeClient());
        view.addJavascriptInterface(new Bridge(view), "PFNative");
        view.loadUrl(LocalClient.ORIGIN + page);
    }

    // Lo que la interfaz llama como window.PFNative.*. Llega en un hilo aparte: se pasa al hilo principal.
    final class Bridge {
        private final WebView view;

        Bridge(WebView view) { this.view = view; }

        @JavascriptInterface
        public void invoke(int id, String channel, String argsJson) {
            main.post(() -> {
                try {
                    handleInvoke(view, id, channel, new JSONArray(argsJson));
                } catch (Exception e) {
                    resolve(view, id, JSONObject.NULL);
                }
            });
        }

        @JavascriptInterface
        public void send(String channel, String argsJson) {
            main.post(() -> {
                try {
                    handleSend(channel, new JSONArray(argsJson));
                } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface
        public void dragStart() {
            main.post(() -> { if (PrompterService.instance != null) PrompterService.instance.startDrag(); });
        }
    }

    void resolve(WebView view, int id, Object result) {
        if (view == null) return;
        String json = result == null ? "null" : result instanceof String ? JSONObject.quote((String) result) : result.toString();
        view.evaluateJavascript("window.__pf&&__pf.resolve(" + id + "," + JSONObject.quote(json) + ")", null);
    }

    void emit(WebView view, String channel, Object payload) {
        if (view == null) return;
        String json = payload == null ? "null" : payload instanceof String ? JSONObject.quote((String) payload) : payload.toString();
        view.evaluateJavascript("window.__pf&&__pf.emit(" + JSONObject.quote(channel) + "," + JSONObject.quote(json) + ")", null);
    }

    void sendToMain(String channel, Object payload) { emit(mainView, channel, payload); }

    void sendToPrompter(String channel, Object payload) { emit(prompterView, channel, payload); }

    void broadcastSettings() {
        JSONObject s = store.getSettings();
        sendToMain("settings", s);
        sendToPrompter("settings", s);
    }

    boolean protection() {
        return store.getSettings().optBoolean("captureProtection", true);
    }

    // ---------- Mensajes de la interfaz ----------

    private void handleInvoke(WebView from, int id, String channel, JSONArray args) throws JSONException {
        switch (channel) {
            case "data:get":
                resolve(from, id, store.getAll());
                return;
            case "script:save": {
                JSONObject saved = store.saveScript(args.getJSONObject(0));
                if (saved.optString("id").equals(currentScriptId)) sendScriptToPrompter();
                resolve(from, id, saved);
                return;
            }
            case "script:delete":
                store.deleteScript(args.getString(0));
                resolve(from, id, null);
                return;
            case "script:duplicate":
                resolve(from, id, store.duplicateScript(args.getString(0)));
                return;
            case "script:import":
                if (activity == null) resolve(from, id, new JSONObject().put("imported", new JSONArray()).put("errors", new JSONArray()));
                else activity.pickFiles(id);
                return;
            case "settings:set": {
                JSONObject patch = args.getJSONObject(0);
                boolean before = protection();
                JSONObject s = store.setSettings(patch);
                if (patch.has("captureProtection") && protection() != before) applyProtection();
                broadcastSettings();
                resolve(from, id, s);
                return;
            }
            case "prompter:open":
                openPrompter(args.isNull(0) ? null : args.optString(0, null), args.length() > 1 && !args.isNull(1) ? args.optString(1) : null);
                resolve(from, id, null);
                return;
            case "prompter:init":
                resolve(from, id, new JSONObject()
                        .put("script", currentScriptId != null && store.getScript(currentScriptId) != null ? store.getScript(currentScriptId) : JSONObject.NULL)
                        .put("settings", store.getSettings())
                        .put("clickThrough", clickThrough));
                if (pendingThenCmd != null) {
                    String cmd = pendingThenCmd;
                    pendingThenCmd = null;
                    main.postDelayed(() -> sendToPrompter("cmd", cmdJson(cmd, null)), 400);
                }
                if (PrompterService.instance != null) PrompterService.instance.pushRecordingState();
                return;
            case "prompter:position": {
                JSONObject a = args.getJSONObject(0);
                if (PrompterService.instance == null) openPrompter(null, null);
                if (PrompterService.instance != null) PrompterService.instance.position(a.optString("preset"));
                resolve(from, id, null);
                return;
            }
            case "displays:list": {
                android.util.DisplayMetrics m = app.getResources().getDisplayMetrics();
                resolve(from, id, new JSONArray().put(new JSONObject().put("id", 0).put("index", 1).put("primary", true)
                        .put("size", m.widthPixels + "×" + m.heightPixels)));
                return;
            }
            case "shortcuts:list": {
                JSONArray list = new JSONArray();
                for (String[] sc : SHORTCUTS) list.put(new JSONObject().put("keys", sc[0]).put("cmd", sc[1]).put("ok", true));
                resolve(from, id, list);
                return;
            }
            case "remote:set":
            case "remote:info":
                resolve(from, id, new JSONObject().put("running", false));
                return;
            case "firewall:status":
            case "firewall:allow":
                resolve(from, id, new JSONObject().put("needed", false).put("allowed", true));
                return;
            case "capture:selftest":
                resolve(from, id, new JSONObject().put("error", "android"));
                return;
            case "system:info": {
                JSONObject prot = new JSONObject().put("level", "ok").put("code", "protAndroid").put("build", Build.VERSION.RELEASE);
                resolve(from, id, new JSONObject().put("platform", "android").put("release", Build.VERSION.RELEASE)
                        .put("version", versionName()).put("protection", prot)
                        .put("recordingDetection", Build.VERSION.SDK_INT >= 35));
                return;
            }
            case "android:overlayPermission":
                resolve(from, id, Settings.canDrawOverlays(app));
                return;
            default:
                resolve(from, id, null);
        }
    }

    private void handleSend(String channel, JSONArray args) throws JSONException {
        switch (channel) {
            case "prompter:cmd": {
                JSONObject a = args.getJSONObject(0);
                handleCommand(a.optString("cmd"), a.opt("arg"));
                return;
            }
            case "prompter:status":
                updateStatus(args.getJSONObject(0));
                return;
            case "prompter:close":
                closePrompter();
                return;
            case "prompter:minimize":
                if (PrompterService.instance != null) PrompterService.instance.setVisible(false);
                return;
            case "prompter:resize": {
                JSONObject a = args.getJSONObject(0);
                if (PrompterService.instance != null) PrompterService.instance.resizeCss(a.optDouble("width"), a.optDouble("height"));
                return;
            }
            default:
        }
    }

    static JSONObject cmdJson(String cmd, Object arg) {
        JSONObject o = new JSONObject();
        try {
            o.put("cmd", cmd);
            if (arg != null) o.put("arg", arg);
        } catch (JSONException ignored) { }
        return o;
    }

    // ---------- Teleprompter ----------

    void openPrompter(String scriptId, String thenCmd) {
        if (scriptId != null) currentScriptId = scriptId;
        if (!Settings.canDrawOverlays(app)) {
            pendingThenCmd = thenCmd;
            if (activity != null) activity.askOverlayPermission();
            return;
        }
        PrompterService svc = PrompterService.instance;
        if (svc != null && svc.hasWindow()) {
            svc.setVisible(true);
            sendScriptToPrompter();
            if (thenCmd != null) sendToPrompter("cmd", cmdJson(thenCmd, null));
            return;
        }
        pendingThenCmd = thenCmd;
        if (activity != null) activity.askNotificationPermission();
        Intent i = new Intent(app, PrompterService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) app.startForegroundService(i);
        else app.startService(i);
    }

    void closePrompter() {
        app.stopService(new Intent(app, PrompterService.class));
    }

    void onPrompterClosed() {
        prompterView = null;
        clickThrough = false;
        updateStatus(new JSONObject());
        sendToMain("clickthrough", false);
    }

    void sendScriptToPrompter() {
        JSONObject s = currentScriptId != null ? store.getScript(currentScriptId) : null;
        sendToPrompter("script", s == null ? JSONObject.NULL : s);
    }

    void applyProtection() {
        if (activity != null) activity.applyProtection(protection());
        if (PrompterService.instance != null) PrompterService.instance.applyFlags();
    }

    void setClickThrough(boolean on) {
        clickThrough = on;
        if (PrompterService.instance != null) PrompterService.instance.applyFlags();
        sendToPrompter("clickthrough", on);
        sendToMain("clickthrough", on);
        if (PrompterService.instance != null) PrompterService.instance.updateNotification();
    }

    boolean isPrompterOpen() {
        return PrompterService.instance != null && PrompterService.instance.hasWindow();
    }

    void updateStatus(JSONObject patch) {
        try {
            for (java.util.Iterator<String> it = patch.keys(); it.hasNext(); ) {
                String k = it.next();
                lastStatus.put(k, patch.get(k));
            }
            lastStatus.put("clickThrough", clickThrough);
            lastStatus.put("open", isPrompterOpen());
            lastStatus.put("lang", store.getSettings().optString("language", "es"));
            if (!isPrompterOpen()) lastStatus.put("playing", false);
        } catch (JSONException ignored) { }
        sendToMain("status", lastStatus);
        boolean playing = lastStatus.optBoolean("playing") || lastStatus.optBoolean("counting");
        if (playing != lastPlaying) {
            lastPlaying = playing;
            if (PrompterService.instance != null) PrompterService.instance.updateNotification();
        }
    }

    boolean isPlaying() { return lastPlaying; }

    private String versionName() {
        try {
            return app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    private static double clamp(double v, double a, double b) { return Math.min(b, Math.max(a, v)); }

    private static double round2(double v) { return Math.round(v * 100) / 100.0; }

    void handleCommand(String cmd, Object arg) {
        JSONObject s = store.getSettings();
        try {
            switch (cmd) {
                case "faster":
                    store.setSettings(new JSONObject().put("speed", round2(clamp(s.optDouble("speed", 3) + 0.25, 0.25, 10))));
                    broadcastSettings();
                    return;
                case "slower":
                    store.setSettings(new JSONObject().put("speed", round2(clamp(s.optDouble("speed", 3) - 0.25, 0.25, 10))));
                    broadcastSettings();
                    return;
                case "setSpeed": {
                    double v = arg == null ? s.optDouble("speed", 3) : Double.parseDouble(String.valueOf(arg));
                    store.setSettings(new JSONObject().put("speed", round2(clamp(v, 0.25, 10))));
                    broadcastSettings();
                    return;
                }
                case "fontUp":
                    store.setSettings(new JSONObject().put("fontSize", clamp(s.optDouble("fontSize", 42) + 2, 16, 140)));
                    broadcastSettings();
                    return;
                case "fontDown":
                    store.setSettings(new JSONObject().put("fontSize", clamp(s.optDouble("fontSize", 42) - 2, 16, 140)));
                    broadcastSettings();
                    return;
                case "clickThrough":
                    setClickThrough(!clickThrough);
                    return;
                case "hide": {
                    PrompterService svc = PrompterService.instance;
                    if (svc == null || !svc.hasWindow()) { openPrompter(null, null); return; }
                    svc.setVisible(!svc.isVisible());
                    return;
                }
                default:
                    PrompterService svc = PrompterService.instance;
                    if (svc == null || !svc.hasWindow()) {
                        if (cmd.equals("toggle") || cmd.equals("play")) openPrompter(null, "play");
                        if (cmd.equals("countdown")) openPrompter(null, "playCountdown");
                        return;
                    }
                    if (!svc.isVisible() && (cmd.equals("toggle") || cmd.equals("countdown") || cmd.equals("play"))) svc.setVisible(true);
                    sendToPrompter("cmd", cmdJson(cmd, arg));
            }
        } catch (JSONException ignored) { }
    }

    void savePrompterBounds(int x, int y, int w, int h) {
        try {
            store.setSettings(new JSONObject().put("prompterBounds",
                    new JSONObject().put("x", x).put("y", y).put("width", w).put("height", h)));
        } catch (JSONException ignored) { }
    }
}
