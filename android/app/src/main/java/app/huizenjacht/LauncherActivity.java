package app.huizenjacht;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;

import androidx.annotation.Nullable;

import com.google.androidbrowserhelper.trusted.TwaLauncher;

import java.util.Arrays;
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

    @Override
    protected void launchTwa() {
        if (isFinishing()) return;
        if (Server.url(this) == null) {
            startActivity(new Intent(this, SetupActivity.class));
            finish();
            return;
        }
        mBrowser = trustedBrowser();
        if (mBrowser == null) {
            startActivity(new Intent(this, WebViewActivity.class));
            finish();
            return;
        }
        super.launchTwa();
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
