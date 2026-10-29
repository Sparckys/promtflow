package com.guionflow.tablet;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.Iterator;

// Almacenamiento local: un archivo JSON privado de la app (mismo formato que desktop/src/store.js).
// Sin internet, sin cuentas: ninguna otra app puede leerlo.
final class Store {
    private static final String SAMPLE = "[Diapositiva 1] Bienvenida\n\n"
            + "Hoy quiero mostrarte algo importante.\n\n"
            + "¿Y si pudieras convertir lo que ya sabes en un negocio real?\n\n"
            + "[PAUSA]\n\n"
            + "[Diapositiva 2] El problema\n\n"
            + "La mayoría de las personas pasa años sentada sobre una idea. La piensa, la imagina... pero nunca la graba.\n\n"
            + "**No es falta de conocimiento. Es falta de un sistema.**\n\n"
            + "[Diapositiva 3] La solución\n\n"
            + "La verdad es que no necesitas millones de seguidores. Necesitas un mensaje claro, una estructura simple y la constancia de presentarlo.\n\n"
            + "[mirar a cámara]\n\n"
            + "[Diapositiva 4] Cierre\n\n"
            + "Si llegaste hasta aquí, ya estás haciendo lo que el 99% no hace.\n\n"
            + "Empecemos.";

    private final File file;
    private JSONObject data;
    private final SecureRandom random = new SecureRandom();
    private final Runnable flushTask = this::flush;
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());

    Store(Context ctx) {
        file = new File(ctx.getFilesDir(), "guionflow-data.json");
        load();
    }

    private static JSONObject defaults() {
        JSONObject s = new JSONObject();
        try {
            s.put("language", "es");
            s.put("scrollMode", "auto");
            s.put("speed", 3);
            s.put("fontSize", 42);
            s.put("lineHeight", 1.5);
            s.put("fontFamily", "sans");
            s.put("textColor", "#ffffff");
            s.put("bgOpacity", 0.9);
            s.put("textWidth", 92);
            s.put("readingLine", 30);
            s.put("highlight", true);
            s.put("mirror", false);
            s.put("countdown", 3);
            s.put("autoPause", true);
            s.put("compact", false);
            s.put("captureProtection", true);
            s.put("remoteEnabled", false);
            s.put("prompterBounds", JSONObject.NULL);
            s.put("lastCheck", JSONObject.NULL);
        } catch (JSONException ignored) { }
        return s;
    }

    private void load() {
        try {
            if (file.exists()) data = new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        } catch (Exception e) {
            data = null;
        }
        try {
            if (data == null || data.optJSONArray("scripts") == null) {
                long now = System.currentTimeMillis();
                JSONObject sample = new JSONObject()
                        .put("id", newId()).put("title", "Guion de ejemplo").put("folder", "Ejemplos")
                        .put("content", SAMPLE).put("createdAt", now).put("updatedAt", now);
                data = new JSONObject().put("scripts", new JSONArray().put(sample)).put("settings", new JSONObject());
            }
            JSONObject merged = defaults();
            merge(merged, data.optJSONObject("settings"));
            if (merged.optDouble("countdown", 0) == 0) merged.put("countdown", 3);
            data.put("settings", merged);
        } catch (JSONException ignored) { }
        save();
    }

    private static void merge(JSONObject into, JSONObject patch) throws JSONException {
        if (patch == null) return;
        for (Iterator<String> it = patch.keys(); it.hasNext(); ) {
            String k = it.next();
            into.put(k, patch.get(k));
        }
    }

    private String newId() {
        byte[] b = new byte[8];
        random.nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    private void save() {
        handler.removeCallbacks(flushTask);
        handler.postDelayed(flushTask, 250);
    }

    void flush() {
        handler.removeCallbacks(flushTask);
        File tmp = new File(file.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(data.toString(2).getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (Exception e) {
            return;
        }
        //noinspection ResultOfMethodCallIgnored
        tmp.renameTo(file);
    }

    JSONObject getAll() throws JSONException {
        return new JSONObject().put("scripts", scripts()).put("settings", getSettings());
    }

    JSONObject getSettings() {
        return data.optJSONObject("settings");
    }

    JSONObject setSettings(JSONObject patch) throws JSONException {
        merge(getSettings(), patch);
        save();
        return getSettings();
    }

    private JSONArray scripts() {
        return data.optJSONArray("scripts");
    }

    JSONObject getScript(String id) {
        if (id == null) return null;
        JSONArray arr = scripts();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject s = arr.optJSONObject(i);
            if (s != null && id.equals(s.optString("id"))) return s;
        }
        return null;
    }

    JSONObject saveScript(JSONObject script) throws JSONException {
        long now = System.currentTimeMillis();
        JSONObject existing = getScript(script.optString("id", null));
        if (existing != null) {
            for (String k : new String[]{"title", "folder", "content"}) {
                if (script.has(k) && !script.isNull(k)) existing.put(k, script.getString(k));
            }
            existing.put("updatedAt", now);
            save();
            return existing;
        }
        String title = script.optString("title", "");
        JSONObject created = new JSONObject()
                .put("id", newId())
                .put("title", title.isEmpty() ? "Nuevo guion" : title)
                .put("folder", script.optString("folder", ""))
                .put("content", script.optString("content", ""))
                .put("createdAt", now)
                .put("updatedAt", now);
        JSONArray next = new JSONArray().put(created);
        JSONArray arr = scripts();
        for (int i = 0; i < arr.length(); i++) next.put(arr.get(i));
        data.put("scripts", next);
        save();
        return created;
    }

    void deleteScript(String id) throws JSONException {
        JSONArray next = new JSONArray();
        JSONArray arr = scripts();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject s = arr.optJSONObject(i);
            if (s != null && !s.optString("id").equals(id)) next.put(s);
        }
        data.put("scripts", next);
        save();
    }

    JSONObject duplicateScript(String id) throws JSONException {
        JSONObject s = getScript(id);
        if (s == null) return null;
        return saveScript(new JSONObject()
                .put("title", s.optString("title") + " (copia)")
                .put("folder", s.optString("folder"))
                .put("content", s.optString("content")));
    }
}
