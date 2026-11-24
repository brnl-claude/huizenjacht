package app.huizenjacht;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import androidx.annotation.Nullable;

import java.util.Locale;

/** The address of your Huizenjacht server, such as https://huizen.example.com. */
final class Server {
    private static final String PREFS = "server";
    private static final String KEY_URL = "url";

    private Server() {}

    /** The saved server, as https://host[:port] without a slash at the end; null before setup. */
    @Nullable
    static String url(Context context) {
        String url = prefs(context).getString(KEY_URL, null);
        return url == null || url.isEmpty() ? null : url;
    }

    static void save(Context context, String url) {
        prefs(context).edit().putString(KEY_URL, url).apply();
    }

    @Nullable
    static String host(Context context) {
        String url = url(context);
        return url == null ? null : Uri.parse(url).getHost();
    }

    /**
     * What someone typed, as https://host[:port]: "huizen.example.com",
     * "https://huizen.example.com/huizen/12" and "HTTPS://Huizen.Example.com/" all become
     * https://huizen.example.com. Only https: the login cookie needs it. Null when it isn't an
     * address.
     */
    @Nullable
    static String normalize(String typed) {
        if (typed == null) return null;
        String text = typed.trim();
        if (text.isEmpty()) return null;
        if (!text.contains("://")) text = "https://" + text;
        Uri uri = Uri.parse(text);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || !scheme.equalsIgnoreCase("https")) return null;
        if (host == null || host.isEmpty() || host.contains(" ")) return null;
        String origin = "https://" + host.toLowerCase(Locale.ROOT);
        if (uri.getPort() != -1 && uri.getPort() != 443) origin += ":" + uri.getPort();
        return origin;
    }

    /** True for a page on the saved server. */
    static boolean isServerPage(Context context, Uri url) {
        String server = url(context);
        if (server == null || url == null) return false;
        Uri origin = Uri.parse(server);
        return "https".equals(url.getScheme())
                && origin.getHost() != null && origin.getHost().equalsIgnoreCase(url.getHost())
                && origin.getPort() == url.getPort();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
