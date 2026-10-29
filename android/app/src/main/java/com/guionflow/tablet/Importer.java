package com.guionflow.tablet;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Xml;

import org.xmlpull.v1.XmlPullParser;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

// Importa guiones desde TXT, Markdown y Word (.docx), todo dentro de la tablet.
final class Importer {
    static final class Result {
        final String title;
        final String content;
        Result(String title, String content) { this.title = title; this.content = content; }
    }

    private static final int MAX_BYTES = 20 * 1024 * 1024;

    static String displayName(ContentResolver cr, Uri uri) {
        try (Cursor c = cr.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) { }
        String last = uri.getLastPathSegment();
        return last != null ? last : "guion";
    }

    static Result importUri(ContentResolver cr, Uri uri) throws IOException {
        String name = displayName(cr, uri);
        int dot = name.lastIndexOf('.');
        String ext = dot >= 0 ? name.substring(dot).toLowerCase() : "";
        String title = dot > 0 ? name.substring(0, dot) : name;
        String text;
        try (InputStream in = cr.openInputStream(uri)) {
            if (in == null) throw new IOException("no se pudo abrir");
            switch (ext) {
                case ".txt":
                case ".md":
                case ".markdown":
                    text = new String(readAll(in), StandardCharsets.UTF_8);
                    break;
                case ".docx":
                    text = docxText(in);
                    break;
                case ".pdf":
                    throw new IOException("PDF aún no se puede importar en la tablet: abre el PDF, copia el texto y pégalo en un guion nuevo.");
                default:
                    throw new IOException("Formato no compatible: " + (ext.isEmpty() ? name : ext));
            }
        }
        text = text.replace("\r\n", "\n").replace('\r', '\n').replaceAll("\n{3,}", "\n\n").trim();
        return new Result(title, text);
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            if (out.size() > MAX_BYTES) throw new IOException("archivo demasiado grande");
        }
        return out.toByteArray();
    }

    // Un .docx es un zip: el texto está en word/document.xml (<w:t>, párrafos <w:p>).
    private static String docxText(InputStream in) throws IOException {
        try (ZipInputStream zip = new ZipInputStream(in)) {
            ZipEntry e;
            while ((e = zip.getNextEntry()) != null) {
                if (!"word/document.xml".equals(e.getName())) continue;
                return parseDocument(new java.io.ByteArrayInputStream(readAll(zip)));
            }
        }
        throw new IOException("el archivo Word está vacío o dañado");
    }

    private static String parseDocument(InputStream xml) throws IOException {
        StringBuilder sb = new StringBuilder();
        try {
            XmlPullParser p = Xml.newPullParser();
            p.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false);
            p.setInput(xml, "UTF-8");
            boolean inText = false;
            for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next()) {
                String tag = p.getName();
                if (ev == XmlPullParser.START_TAG) {
                    if ("w:t".equals(tag)) inText = true;
                    else if ("w:tab".equals(tag)) sb.append('\t');
                    else if ("w:br".equals(tag) || "w:cr".equals(tag)) sb.append('\n');
                } else if (ev == XmlPullParser.END_TAG) {
                    if ("w:t".equals(tag)) inText = false;
                    else if ("w:p".equals(tag)) sb.append("\n\n");
                } else if (ev == XmlPullParser.TEXT && inText) {
                    sb.append(p.getText());
                }
            }
        } catch (Exception e) {
            throw new IOException("no se pudo leer el Word: " + e.getMessage());
        }
        return sb.toString();
    }
}
