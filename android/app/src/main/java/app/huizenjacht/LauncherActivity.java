package app.huizenjacht;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;

import androidx.annotation.Nullable;
import androidx.browser.trusted.TrustedWebActivityIntentBuilder;
import androidx.browser.trusted.sharing.ShareData;
import androidx.browser.trusted.sharing.ShareTarget;

import com.google.androidbrowserhelper.trusted.TwaLauncher;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Starts the app: asks for the server the first time (SetupActivity), then opens Huizenjacht
 * full screen in a browser that supports Trusted Web Activities, or in the app's own WebView
 * when there is none.
 *
 * The browser shows Huizenjacht without an address bar once the server names this app in
 * /.well-known/assetlinks.json (Helm value android.certFingerprints, see android/README.md);
 * until then it works the same with a thin address bar on top.
 *
 * Only browsers known to check assetlinks.json count. Cromite and browsers built on it, such as
 * the /e/OS browser, turn that check off on purpose and would show an ordinary tab.
 */
public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    static final List<String> TRUSTED_BROWSERS = Arrays.asList(
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "com.chrome.canary",
            "com.microsoft.emmx",
            "com.sec.android.app.sbrowser");

    @Nullable
    private String mBrowser;
    @Nullable
    private TwaLauncher mShareLauncher;

    @Override
    protected void launchTwa() {
        if (isFinishing()) return;
        if (Server.url(this) == null) {
            startActivity(new Intent(this, SetupActivity.class));
            finish();
            return;
        }
        mBrowser = trustedBrowser();
        Shared shared = Shared.from(getIntent());
        if (mBrowser == null) {
            Intent page = new Intent(this, WebViewActivity.class);
            if (shared != null) {
                // The WebView sends it to the server itself; it may read the shared files.
                page = new Intent(getIntent()).setClass(this, WebViewActivity.class)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            startActivity(page);
            finish();
            return;
        }
        if (shared != null) {
            shareInBrowser(shared);
            return;
        }
        super.launchTwa();
    }

    /**
     * Something shared from another app (Delen → Huizenjacht): the browser posts it to the
     * PWA's share target, /api/share on the saved server, with its own login cookie, and shows
     * the page where you pick the house. The share target is built here rather than in the
     * manifest, because the server is only known at run time.
     */
    private void shareInBrowser(Shared shared) {
        ShareTarget target = new ShareTarget(
                Server.url(this) + Shared.SHARE_PATH,
                ShareTarget.METHOD_POST,
                ShareTarget.ENCODING_TYPE_MULTIPART,
                new ShareTarget.Params("title", "text", Collections.singletonList(
                        new ShareTarget.FileFormField("files", Arrays.asList(Shared.FILE_TYPES)))));
        ShareData data = new ShareData(shared.title, shared.text, shared.files);
        TrustedWebActivityIntentBuilder builder =
                new TrustedWebActivityIntentBuilder(getLaunchingUrl())
                        .setShareParams(target, data);
        mShareLauncher = createTwaLauncher();
        mShareLauncher.launch(builder, null, null, this::finish);
    }

    @Override
    protected void onDestroy() {
        if (mShareLauncher != null) mShareLauncher.destroy();
        super.onDestroy();
    }

    @Override
    protected TwaLauncher createTwaLauncher() {
        return new TwaLauncher(this, mBrowser, getTaskId());
    }

    /** The saved server, instead of an address built into the app. */
    @Override
    protected Uri getLaunchingUrl() {
        return Uri.parse(Server.url(this) + "/");
    }

    /** The default browser if it is a trusted one, else the first trusted one installed. */
    @Nullable
    private String trustedBrowser() {
        PackageManager packages = getPackageManager();
        ResolveInfo defaultBrowser = packages.resolveActivity(
                new Intent(Intent.ACTION_VIEW, Uri.parse("https://")),
                PackageManager.MATCH_DEFAULT_ONLY);
        if (defaultBrowser != null && defaultBrowser.activityInfo != null) {
            String name = defaultBrowser.activityInfo.packageName;
            if (TRUSTED_BROWSERS.contains(name) && isEnabled(packages, name)) return name;
        }
        for (String name : TRUSTED_BROWSERS) {
            if (isEnabled(packages, name)) return name;
        }
        return null;
    }

    private static boolean isEnabled(PackageManager packages, String name) {
        try {
            ApplicationInfo app = packages.getApplicationInfo(name, 0);
            return app.enabled;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}
