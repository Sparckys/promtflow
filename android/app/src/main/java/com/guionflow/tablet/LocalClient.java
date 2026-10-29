package com.guionflow.tablet;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

// Sirve la interfaz desde los archivos del APK con un origen https propio (sin file://).
// Cualquier otra petición se bloquea: la interfaz nunca carga nada de internet.
final class LocalClient extends WebViewClient {
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST + "/";

    private final Context ctx;

    LocalClient(Context ctx) {
        this.ctx = ctx.getApplicationContext();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
        Uri url = req.getUrl();
        if (!"https".equals(url.getScheme()) || !HOST.equals(url.getHost())) return blocked();
        String path = url.getPath() == null ? "" : url.getPath().replaceFirst("^/+", "");
        if (path.isEmpty() || path.contains("..") || path.contains("\\")) return blocked();
        try {
            InputStream in = ctx.getAssets().open(path);
            String mime = mime(path);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            headers.put("X-Content-Type-Options", "nosniff");
            if (path.endsWith(".html")) in = new ByteArrayInputStream(inject(read(in)).getBytes(StandardCharsets.UTF_8));
            return new WebResourceResponse(mime, "utf-8", 200, "OK", headers, in);
        } catch (IOException e) {
            return blocked();
        }
    }

    // Añade la capa de Android (puente window.pf, textos y estilos táctiles) a las páginas de escritorio.
    private static String inject(String html) {
        return html
                .replace("<head>", "<head>\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover\" />")
                .replace("</head>", "  <link rel=\"stylesheet\" href=\"android.css\" />\n</head>")
                .replace("<script src=\"parser.js\"></script>", "<script src=\"android.js\"></script>\n  <script src=\"parser.js\"></script>");
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
        Uri url = req.getUrl();
        if (HOST.equals(url.getHost())) return false;
        // Enlaces externos (p. ej. "Abrir Loom"): se abren fuera de la app, nunca dentro.
        if ("https".equals(url.getScheme()) || "http".equals(url.getScheme())) {
            try {
                ctx.startActivity(new Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception ignored) { }
        }
        return true;
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream src = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = src.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }

    private static String mime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }
}
