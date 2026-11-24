package app.huizenjacht;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.CookieManager;

import androidx.annotation.Nullable;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Sends what was shared to /api/share as the browser would for the PWA's share target
 * (multipart/form-data with title, text, url and files), with the WebView's login cookie.
 * Used in the WebView; in Chrome, Chrome posts it itself (LauncherActivity).
 */
final class ShareUpload {
    /** How it went: the page to open next, or why it didn't work. */
    static final class Result {
        @Nullable final String page;
        final int status;
        @Nullable final String error;

        Result(@Nullable String page, int status, @Nullable String error) {
            this.page = page;
            this.status = status;
            this.error = error;
        }
    }

    private ShareUpload() {}

    /** Runs on a background thread. */
    static Result send(Context context, String server, Shared shared) {
        String boundary = "----Huizenjacht" + UUID.randomUUID().toString().replace("-", "");
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(server + Shared.SHARE_PATH).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setDoOutput(true);
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(120_000);
            connection.setChunkedStreamingMode(64 * 1024);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            String cookie = CookieManager.getInstance().getCookie(server + "/");
            if (cookie != null) connection.setRequestProperty("Cookie", cookie);

            ContentResolver resolver = context.getContentResolver();
            try (OutputStream out = connection.getOutputStream()) {
                field(out, boundary, "title", shared.title);
                field(out, boundary, "text", shared.text);
                field(out, boundary, "url", shared.url());
                for (Uri file : shared.files) {
                    String type = resolver.getType(file);
                    if (type == null) type = "application/octet-stream";
                    String name = displayName(resolver, file);
                    out.write(("--" + boundary + "\r\n"
                            + "Content-Disposition: form-data; name=\"files\"; filename=\""
                            + name.replace("\"", "'").replace("\r", "").replace("\n", "") + "\"\r\n"
                            + "Content-Type: " + type + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                    try (InputStream in = resolver.openInputStream(file)) {
                        if (in == null) throw new IOException("Kan " + name + " niet lezen");
                        byte[] buffer = new byte[64 * 1024];
                        int read;
                        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                    }
                    out.write("\r\n".getBytes(StandardCharsets.UTF_8));
                }
                out.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            }

            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                // A server that answers with the redirect anyway: follow it in the WebView.
                return new Result(connection.getHeaderField("Location"), status, null);
            }
            if (status < 200 || status >= 300) return new Result(null, status, "HTTP " + status);
            String body = read(connection.getInputStream());
            String page = new JSONObject(body).optString("url", null);
            return new Result(page, status, null);
        } catch (Exception e) {
            String message = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            return new Result(null, 0, message);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static void field(OutputStream out, String boundary, String name, @Nullable String value)
            throws IOException {
        if (value == null || value.isEmpty()) return;
        out.write(("--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"" + name + "\"\r\n\r\n"
                + value + "\r\n").getBytes(StandardCharsets.UTF_8));
    }

    private static String displayName(ContentResolver resolver, Uri file) {
        try (Cursor cursor = resolver.query(file,
                new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) {
                return cursor.getString(0);
            }
        } catch (Exception ignored) {
            // Some apps don't answer; the last part of the address will do.
        }
        String last = file.getLastPathSegment();
        return last != null ? last : "bestand";
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream body = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = body.read(buffer)) != -1 && out.size() < 65536) out.write(buffer, 0, read);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
