package com.guionflow.tablet;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebView;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

// El editor de guiones: la misma interfaz que la versión de escritorio, adaptada a pantalla táctil.
public class MainActivity extends Activity {
    private static final int REQ_IMPORT = 41;
    private static final int REQ_NOTIF = 42;

    private Hub hub;
    private WebView web;
    private int pendingImportId = -1;
    private boolean waitingOverlayPermission;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        hub = Hub.get(this);
        applyProtection(hub.protection());

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0A0C11);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0A0C11);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Android 15 dibuja la app de borde a borde: se deja espacio para las barras del sistema y el teclado.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            } else {
                //noinspection deprecation
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        hub.activity = this;
        hub.mainView = web;
        hub.setupWebView(web, "index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        hub.activity = this;
        if (waitingOverlayPermission && Settings.canDrawOverlays(this)) {
            waitingOverlayPermission = false;
            hub.openPrompter(null, hub.pendingThenCmd);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        hub.store.flush();
    }

    @Override
    protected void onDestroy() {
        if (hub.activity == this) hub.activity = null;
        if (hub.mainView == web) hub.mainView = null;
        web.destroy();
        super.onDestroy();
    }

    void applyProtection(boolean on) {
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    // ---------- Permisos ----------

    void askOverlayPermission() {
        boolean en = "en".equals(hub.store.getSettings().optString("language"));
        new AlertDialog.Builder(this)
                .setTitle(en ? "Allow the floating teleprompter" : "Permite el teleprompter flotante")
                .setMessage(en
                        ? "To read your script on top of Loom, the camera or your slides, Android needs the \"Display over other apps\" permission.\n\nOn the next screen, find GuionFlow and turn it on, then come back."
                        : "Para leer tu guion encima de Loom, la cámara o tu presentación, Android necesita el permiso \"Mostrar sobre otras apps\".\n\nEn la siguiente pantalla busca GuionFlow, actívalo y vuelve a la app.")
                .setPositiveButton(en ? "Open settings" : "Dar permiso", (d, w) -> {
                    waitingOverlayPermission = true;
                    try {
                        startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
                    } catch (Exception e) {
                        startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION));
                    }
                })
                .setNegativeButton(en ? "Cancel" : "Ahora no", null)
                .show();
    }

    void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
        }
    }

    // ---------- Importar guiones ----------

    void pickFiles(int callId) {
        pendingImportId = callId;
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*")
                .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                .putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                        "text/plain", "text/markdown", "text/x-markdown",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        "application/pdf", "application/octet-stream"});
        try {
            startActivityForResult(i, REQ_IMPORT);
        } catch (Exception e) {
            finishImport(new ArrayList<>());
        }
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req != REQ_IMPORT) return;
        List<Uri> uris = new ArrayList<>();
        if (result == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
            else if (data.getData() != null) uris.add(data.getData());
        }
        finishImport(uris);
    }

    private void finishImport(List<Uri> uris) {
        int id = pendingImportId;
        pendingImportId = -1;
        if (id < 0) return;
        JSONArray imported = new JSONArray();
        JSONArray errors = new JSONArray();
        for (Uri u : uris) {
            try {
                Importer.Result r = Importer.importUri(getContentResolver(), u);
                imported.put(hub.store.saveScript(new JSONObject().put("title", r.title).put("content", r.content).put("folder", "Importados")));
            } catch (Exception e) {
                errors.put(Importer.displayName(getContentResolver(), u) + ": " + e.getMessage());
            }
        }
        try {
            hub.resolve(web, id, new JSONObject().put("imported", imported).put("errors", errors));
        } catch (Exception ignored) { }
    }

    @Override
    public void onBackPressed() {
        // Atrás deja la app en segundo plano sin cerrarla: el teleprompter flotante sigue abierto.
        moveTaskToBack(true);
    }
}
