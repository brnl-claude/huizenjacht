package app.huizenjacht;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.Settings;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

/**
 * The screen over the WebView when Huizenjacht can't be loaded: what went wrong in plain
 * words, what to check, and buttons to try again, open the page in the browser, change the
 * server, or open the network settings (or the app's own settings, when Android blocks the
 * app's network).
 */
final class LoadErrorScreen {
    enum Kind { HOST, CONNECT, SERVER, CERT, BLOCKED, OTHER }

    private final Activity mActivity;
    private final View mView;
    private final TextView mTitle;
    private final TextView mMessage;
    private final TextView mTips;
    private final TextView mDetail;
    private final Button mSettings;
    private String mUrl;
    private Kind mKind;

    LoadErrorScreen(Activity activity, ViewGroup parent, Runnable retry) {
        mActivity = activity;
        mView = LayoutInflater.from(activity).inflate(R.layout.load_error, parent, false);
        parent.addView(mView);
        mTitle = mView.findViewById(R.id.errorTitle);
        mMessage = mView.findViewById(R.id.errorMessage);
        mTips = mView.findViewById(R.id.errorTips);
        mDetail = mView.findViewById(R.id.errorDetail);
        mView.findViewById(R.id.errorRetry).setOnClickListener(button -> retry.run());
        mView.findViewById(R.id.errorBrowser).setOnClickListener(button -> openInBrowser());
        mView.findViewById(R.id.errorServer).setOnClickListener(button ->
                activity.startActivity(new Intent(activity, SetupActivity.class)));
        mSettings = mView.findViewById(R.id.errorSettings);
        mSettings.setOnClickListener(button -> openSettings());
    }

    boolean isShowing() {
        return mView.getVisibility() == View.VISIBLE;
    }

    /** The page that failed, to load again. */
    String url() {
        return mUrl;
    }

    /**
     * Shows the screen for a failed page.
     *
     * @param status the HTTP status for {@link Kind#SERVER}, else ignored
     * @param detail the technical reason, such as net::ERR_NAME_NOT_RESOLVED
     */
    // Every message gets the host and the status; only the server error one shows the status.
    @SuppressLint("StringFormatMatches")
    void show(Kind kind, String url, int status, CharSequence detail) {
        mUrl = url;
        mKind = kind;
        String host = Uri.parse(url).getHost();
        if (host == null) host = url;
        int title, message, tips;
        switch (kind) {
            case HOST:
                title = R.string.errorHostTitle;
                message = R.string.errorHostMessage;
                tips = R.string.errorHostTips;
                break;
            case CONNECT:
                title = R.string.errorConnectTitle;
                message = R.string.errorConnectMessage;
                tips = R.string.errorConnectTips;
                break;
            case SERVER:
                title = R.string.errorServerTitle;
                message = R.string.errorServerMessage;
                tips = R.string.errorServerTips;
                break;
            case CERT:
                title = R.string.errorCertTitle;
                message = R.string.errorCertMessage;
                tips = R.string.errorCertTips;
                break;
            case BLOCKED:
                title = R.string.errorBlockedTitle;
                message = R.string.errorBlockedMessage;
                tips = R.string.errorBlockedTips;
                break;
            default:
                title = R.string.errorOtherTitle;
                message = R.string.errorOtherMessage;
                tips = R.string.errorOtherTips;
        }
        mTitle.setText(title);
        mMessage.setText(mActivity.getString(message, host, status));
        String allTips = mActivity.getString(tips);
        if (kind == Kind.BLOCKED) {
            allTips += "\n\n" + mActivity.getString(R.string.errorBlockedRetry);
        } else if (kind != Kind.CERT) {
            allTips += "\n\n" + mActivity.getString(R.string.errorAutoRetry);
        }
        mSettings.setText(kind == Kind.BLOCKED
                ? R.string.errorAppSettings : R.string.errorNetworkSettings);
        mTips.setText(allTips);
        mDetail.setText(detail == null ? url : detail + "\n" + url);
        mView.setVisibility(View.VISIBLE);
    }

    void hide() {
        mView.setVisibility(View.GONE);
    }

    /** In the browser itself, never back in this app. */
    private void openInBrowser() {
        if (mUrl == null) return;
        Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(mUrl))
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ResolveInfo browser = mActivity.getPackageManager().resolveActivity(
                new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.org/")),
                PackageManager.MATCH_DEFAULT_ONLY);
        if (browser != null && browser.activityInfo != null
                && !"android".equals(browser.activityInfo.packageName)
                && !mActivity.getPackageName().equals(browser.activityInfo.packageName)) {
            view.setPackage(browser.activityInfo.packageName);
        }
        try {
            mActivity.startActivity(view);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(mActivity, R.string.noAppForLink, Toast.LENGTH_SHORT).show();
        }
    }

    private void openSettings() {
        if (mKind == Kind.BLOCKED) {
            // The app's page, with Mobile data & Wi-Fi and its per-app network switches.
            mActivity.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", mActivity.getPackageName(), null)));
            return;
        }
        try {
            mActivity.startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
        } catch (ActivityNotFoundException e) {
            mActivity.startActivity(new Intent(Settings.ACTION_SETTINGS));
        }
    }
}
