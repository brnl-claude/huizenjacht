package app.huizenjacht;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.List;

/**
 * What another app shares with Huizenjacht (Delen → Huizenjacht): photos, videos and voice
 * memos, with the title and text the app adds. The server takes it at /api/share, the PWA's share target, and asks which
 * house it belongs to.
 */
final class Shared {
    static final String SHARE_PATH = "/api/share";
    static final String[] FILE_TYPES = {"image/*", "video/*", "audio/*"};

    @Nullable final String title;
    @Nullable final String text;
    final List<Uri> files;

    private Shared(@Nullable String title, @Nullable String text, List<Uri> files) {
        this.title = title;
        this.text = text;
        this.files = files;
    }

    static boolean isShare(@Nullable Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        return Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action);
    }

    @Nullable
    static Shared from(@Nullable Intent intent) {
        if (!isShare(intent)) return null;
        String title = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        List<Uri> files = new ArrayList<>();
        if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            ArrayList<Uri> streams = streams(intent);
            if (streams != null) files.addAll(streams);
        } else {
            Uri stream = stream(intent);
            if (stream != null) files.add(stream);
        }
        // Some apps only put the files in the clip data.
        ClipData clip = intent.getClipData();
        if (files.isEmpty() && clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null) files.add(uri);
            }
        }
        // The server's share target takes files only (plus a title and text).
        if (files.isEmpty()) return null;
        return new Shared(title, text == null ? null : text.toString(), files);
    }

    /** The text when it is only a link, such as a Funda listing shared from the browser. */
    @Nullable
    String url() {
        if (text == null) return null;
        String trimmed = text.trim();
        return trimmed.matches("https?://\\S+") ? trimmed : null;
    }

    @SuppressWarnings("deprecation")
    @Nullable
    private static Uri stream(Intent intent) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    @SuppressWarnings("deprecation")
    @Nullable
    private static ArrayList<Uri> streams(Intent intent) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
    }
}
