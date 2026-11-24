package app.huizenjacht;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.File;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;

/**
 * Huizenjacht in the app's own WebView, for devices without a browser that supports Trusted
 * Web Activities (see LauncherActivity). It keeps its own cookies, so you log in once inside
 * the app.
 *
 * Pages of your server stay in the app, and so do the login pages (Authelia or another OIDC
 * provider) it redirects to. Every other link, such as a listing on Funda, opens in the
 * browser or the app it belongs to.
 *
 * The page may take photos and videos (a file input with capture) and record voice memos (the
 * microphone); Android asks for the camera and microphone the first time. Something shared from
 * another app is sent to the server's /api/share here (ShareUpload).
 */
public class WebViewActivity extends Activity {
    private static final int REQUEST_FILE = 1;
    private static final int REQUEST_PAGE_PERMISSION = 2;
    private static final int REQUEST_CAMERA_FOR_CAPTURE = 3;

    // A pull at the top of the page refreshes it, unless it starts in a part of the page that
    // scrolls on its own and isn't at its top yet.
    private static final String PULL_SCRIPT =
            "(function () {"
            + "  if (!window.HuizenjachtAndroid) return;"
            + "  addEventListener('touchstart', function (event) {"
            + "    var scrolled = false;"
            + "    for (var el = event.target; el && el !== document.body; el = el.parentElement) {"
            + "      if (el.scrollTop > 0) { scrolled = true; break; }"
            + "    }"
            + "    window.HuizenjachtAndroid.postMessage(scrolled ? 'inner-scrolled' : 'inner-top');"
            + "  }, { capture: true, passive: true });"
            + "})();";

    // Looked up when the page can't load on a network Android says works: if this fails too,
    // Android doesn't let the app use the network.
    private static final String PROBE_HOST = "example.com";

    private String mServer;
    private WebView mWebView;
    private PullToRefreshLayout mRefresh;
    private boolean mInnerScrolled;
    private ValueCallback<Uri[]> mFileCallback;
    private WebChromeClient.FileChooserParams mFileParams;
    // The files the camera app writes a photo or video to, for a file input with capture.
    private final List<File> mCaptureFiles = new ArrayList<>();
    private final List<Uri> mCaptureUris = new ArrayList<>();
    private PermissionRequest mPendingPermission;
    private boolean mPageEngineGone;
    private LoadErrorScreen mErrorScreen;
    // The page being loaded, to tell its certificate errors from those of other requests.
    private String mLoadingUrl;
    private boolean mOffline;
    private Network mNetwork;
    private boolean mValidated;
    private boolean mBlocked;
    private ConnectivityManager.NetworkCallback mNetworkCallback;
    private Object mBackCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        mServer = Server.url(this);
        if (mServer == null) {
            startActivity(new Intent(this, SetupActivity.class));
            finish();
            return;
        }
        int themeColor = getColor(R.color.themeColor);

        FrameLayout root = new FrameLayout(this);
        mWebView = new WebView(this);
        mRefresh = new PullToRefreshLayout(this);
        // Fill the layout: with the default wrap_content height the WebView lays the page out
        // as zero high, so CSS vh units become 0.
        mRefresh.addView(mWebView, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        mRefresh.setColorSchemeColors(getColor(R.color.accent));
        mRefresh.setOnChildScrollUpCallback(
                (parent, child) -> mInnerScrolled || mWebView.canScrollVertically(-1));
        mRefresh.setOnRefreshListener(() -> mWebView.reload());
        root.addView(mRefresh, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        mErrorScreen = new LoadErrorScreen(this, root, this::retry);
        fitSystemBars(root, themeColor);
        watchNetwork();

        setUpWebView();
        if (savedInstanceState != null) {
            mWebView.restoreState(savedInstanceState);
        } else {
            mWebView.loadUrl(mServer + "/");
            share(getIntent());
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        share(intent);
    }

    /** Something shared from another app: send it to the server, then pick the house there. */
    private void share(Intent intent) {
        Shared shared = Shared.from(intent);
        if (shared == null) return;
        // Only once, also when the activity is recreated.
        intent.setAction(null);
        Toast.makeText(this, R.string.shareSending, Toast.LENGTH_SHORT).show();
        String server = mServer;
        new Thread(() -> {
            ShareUpload.Result result = ShareUpload.send(this, server, shared);
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                if (result.page != null) {
                    String page = result.page.startsWith("/") ? server + result.page : result.page;
                    mWebView.loadUrl(page);
                } else if (result.status == 401 || result.status == 403) {
                    mWebView.loadUrl(server + "/");
                    Toast.makeText(this, R.string.shareLogin, Toast.LENGTH_LONG).show();
                } else if (result.status == 404) {
                    Toast.makeText(this, R.string.shareUnsupported, Toast.LENGTH_LONG).show();
                } else {
                    Toast.makeText(this, getString(R.string.shareFailed, result.error),
                            Toast.LENGTH_LONG).show();
                }
            });
        }, "share-upload").start();
    }

    /** The app's version, such as 0.7.0. */
    private String appVersion() {
        try {
            String name = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            if (name != null) return name.replaceFirst("^v", "");
        } catch (PackageManager.NameNotFoundException ignored) {
            // Never happens for the app itself.
        }
        return "unknown";
    }

    private boolean isServerPage(Uri url) {
        return Server.isServerPage(this, url);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setUpWebView() {
        WebSettings settings = mWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // Tells the site it runs in this app, and which version.
        settings.setUserAgentString(
                settings.getUserAgentString() + " HuizenjachtAndroid/" + appVersion());

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(mWebView, true);

        Set<String> appOrigin = Collections.singleton(mServer);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addWebMessageListener(mWebView, "HuizenjachtAndroid", appOrigin,
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                        if (isMainFrame) {
                            mInnerScrolled = "inner-scrolled".equals(message.getData());
                        }
                    });
            WebViewCompat.addDocumentStartJavaScript(mWebView, PULL_SCRIPT, appOrigin);
        }

        mWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri url = request.getUrl();
                String scheme = url.getScheme();
                if ("https".equals(scheme) || "http".equals(scheme)) {
                    // The login provider is wherever Huizenjacht sends you (a redirect from
                    // /api/auth/login), and its own pages stay with it until it sends you back.
                    if (isServerPage(url) || request.isRedirect() || isSameHost(url, view.getUrl())) {
                        return false;
                    }
                }
                openOutside(url);
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                mLoadingUrl = url;
                mInnerScrolled = false;
                mErrorScreen.hide();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                mRefresh.setRefreshing(false);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                    WebResourceError error) {
                if (!request.isForMainFrame()) return;
                CharSequence detail = error.getDescription();
                // A link that turns out to be a download stops its page load; that's fine.
                if (detail != null && detail.toString().contains("ERR_ABORTED")) return;
                int code = error.getErrorCode();
                LoadErrorScreen.Kind kind = LoadErrorScreen.Kind.OTHER;
                if (code == ERROR_HOST_LOOKUP) {
                    kind = LoadErrorScreen.Kind.HOST;
                } else if (code == ERROR_CONNECT || code == ERROR_TIMEOUT) {
                    kind = LoadErrorScreen.Kind.CONNECT;
                } else if (code == ERROR_FAILED_SSL_HANDSHAKE) {
                    kind = LoadErrorScreen.Kind.CERT;
                }
                showError(kind, request.getUrl().toString(), 0, detail);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                    WebResourceResponse response) {
                // The ingress in front of the server answers these while the pod is down.
                int status = response.getStatusCode();
                if (request.isForMainFrame() && status >= 502 && status <= 504) {
                    showError(LoadErrorScreen.Kind.SERVER, request.getUrl().toString(), status,
                            "HTTP " + status);
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Never continue past a bad certificate.
                handler.cancel();
                if (mLoadingUrl != null && isSameHost(Uri.parse(error.getUrl()), mLoadingUrl)) {
                    showError(LoadErrorScreen.Kind.CERT, mLoadingUrl, 0,
                            "SSL error " + error.getPrimaryError());
                }
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                updateBack();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // The page's engine stopped (out of memory, for example): start it again.
                mPageEngineGone = true;
                recreate();
                return true;
            }
        });

        mWebView.setWebChromeClient(new WebChromeClient() {
            // Taking a photo or video (capture), or picking files: photos, a report, a saved
            // listing page, a back-up.
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (mFileCallback != null) mFileCallback.onReceiveValue(null);
                mFileCallback = callback;
                mFileParams = params;
                if (params.isCaptureEnabled() && !hasPermission(Manifest.permission.CAMERA)) {
                    requestPermissions(new String[] {Manifest.permission.CAMERA},
                            REQUEST_CAMERA_FOR_CAPTURE);
                } else {
                    chooseFile();
                }
                return true;
            }

            // Voice memos ask for the microphone; only Huizenjacht's own pages may have it.
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> askPagePermission(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (request == mPendingPermission) mPendingPermission = null;
            }
        });

        // The back-up (Instellingen → Back-up downloaden) is a download; it needs the login
        // cookie, and lands in Downloads with a notification.
        mWebView.setDownloadListener((url, userAgent, disposition, mimeType, length) -> {
            Uri uri = Uri.parse(url);
            if (!isServerPage(uri)) {
                openOutside(uri);
                return;
            }
            String name = URLUtil.guessFileName(url, disposition, mimeType);
            DownloadManager.Request download = new DownloadManager.Request(uri)
                    .setMimeType(mimeType)
                    .addRequestHeader("User-Agent", userAgent)
                    .setTitle(name)
                    .setNotificationVisibility(
                            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) download.addRequestHeader("Cookie", cookie);
            getSystemService(DownloadManager.class).enqueue(download);
            Toast.makeText(this, getString(R.string.downloading, name), Toast.LENGTH_SHORT).show();
        });
    }

    private boolean hasPermission(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * With capture (Opnemen), the camera app straight away: photo, video or a choice of both,
     * as the page accepts. Without, the file picker, with several files when the page allows.
     */
    private void chooseFile() {
        mCaptureFiles.clear();
        mCaptureUris.clear();
        Intent intent;
        if (mFileParams.isCaptureEnabled() && hasPermission(Manifest.permission.CAMERA)) {
            List<Intent> cameras = new ArrayList<>();
            if (accepts("image/")) {
                cameras.add(captureIntent(MediaStore.ACTION_IMAGE_CAPTURE, "photo", ".jpg"));
            }
            if (accepts("video/")) {
                cameras.add(captureIntent(MediaStore.ACTION_VIDEO_CAPTURE, "video", ".mp4"));
            }
            intent = cameras.size() == 1 ? cameras.get(0) : Intent.createChooser(cameras.get(0), null)
                    .putExtra(Intent.EXTRA_INITIAL_INTENTS,
                            cameras.subList(1, cameras.size()).toArray(new Intent[0]));
        } else {
            Intent pick = mFileParams.createIntent();
            if (mFileParams.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            intent = Intent.createChooser(pick, null);
        }
        try {
            startActivityForResult(intent, REQUEST_FILE);
        } catch (ActivityNotFoundException e) {
            mFileCallback.onReceiveValue(null);
            mFileCallback = null;
        }
    }

    /** True when the file input takes this kind of file (image/ or video/), or anything. */
    private boolean accepts(String kind) {
        String[] types = mFileParams.getAcceptTypes();
        if (types == null || types.length == 0) return true;
        for (String type : types) {
            for (String one : type.split(",")) {
                String t = one.trim();
                if (t.isEmpty() || t.equals("*/*") || t.startsWith(kind)) return true;
            }
        }
        return false;
    }

    private Intent captureIntent(String action, String name, String extension) {
        File folder = new File(getCacheDir(), "capture");
        folder.mkdirs();
        File file = new File(folder, name + "-" + System.currentTimeMillis() + extension);
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", file);
        mCaptureFiles.add(file);
        mCaptureUris.add(uri);
        Intent capture = new Intent(action)
                .putExtra(MediaStore.EXTRA_OUTPUT, uri)
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        // A chooser starts the camera app itself, so give every camera app the file up front.
        for (ResolveInfo camera
                : getPackageManager().queryIntentActivities(capture, 0)) {
            grantUriPermission(camera.activityInfo.packageName, uri,
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }
        return capture;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_FILE || mFileCallback == null) return;
        List<Uri> files = new ArrayList<>();
        if (resultCode == RESULT_OK) {
            // A photo or video the camera app wrote to our file.
            for (int i = 0; i < mCaptureFiles.size(); i++) {
                if (mCaptureFiles.get(i).length() > 0) files.add(mCaptureUris.get(i));
            }
            if (files.isEmpty() && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null) {
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        Uri uri = clip.getItemAt(i).getUri();
                        if (uri != null) files.add(uri);
                    }
                }
                if (files.isEmpty() && data.getData() != null) files.add(data.getData());
            }
        }
        mFileCallback.onReceiveValue(files.isEmpty() ? null : files.toArray(new Uri[0]));
        mFileCallback = null;
    }

    // The microphone (voice memos) and camera for the page. Android asks the person once per
    // permission; after that the page gets what Android allows.

    private void askPagePermission(PermissionRequest request) {
        List<String> wanted = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                    || PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                wanted.add(resource);
            }
        }
        if (wanted.isEmpty() || !isServerPage(request.getOrigin())) {
            request.deny();
            return;
        }
        List<String> missing = new ArrayList<>();
        for (String resource : wanted) {
            String permission = androidPermission(resource);
            if (!hasPermission(permission)) missing.add(permission);
        }
        if (missing.isEmpty()) {
            grantAllowed(request);
            return;
        }
        if (mPendingPermission != null) mPendingPermission.deny();
        mPendingPermission = request;
        requestPermissions(missing.toArray(new String[0]), REQUEST_PAGE_PERMISSION);
    }

    private static String androidPermission(String resource) {
        return PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                ? Manifest.permission.RECORD_AUDIO
                : Manifest.permission.CAMERA;
    }

    /** Grants the camera and microphone as far as Android allows them; nothing at all denies. */
    private void grantAllowed(PermissionRequest request) {
        List<String> allowed = new ArrayList<>();
        for (String resource : request.getResources()) {
            if ((PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                            || PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource))
                    && hasPermission(androidPermission(resource))) {
                allowed.add(resource);
            }
        }
        if (allowed.isEmpty()) {
            request.deny();
        } else {
            request.grant(allowed.toArray(new String[0]));
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode == REQUEST_PAGE_PERMISSION && mPendingPermission != null) {
            grantAllowed(mPendingPermission);
            mPendingPermission = null;
        } else if (requestCode == REQUEST_CAMERA_FOR_CAPTURE && mFileCallback != null) {
            // Without the camera, the file picker instead.
            chooseFile();
        }
    }

    private void showError(LoadErrorScreen.Kind kind, String url, int status, CharSequence detail) {
        mRefresh.setRefreshing(false);
        boolean network = kind == LoadErrorScreen.Kind.HOST || kind == LoadErrorScreen.Kind.CONNECT
                || kind == LoadErrorScreen.Kind.OTHER;
        if (network && mBlocked) kind = LoadErrorScreen.Kind.BLOCKED;
        mErrorScreen.show(kind, url, status, detail);
        ConnectivityManager connectivity = getSystemService(ConnectivityManager.class);
        if (connectivity != null && connectivity.getActiveNetwork() == null) mOffline = true;
        if (network && !mBlocked && mNetwork != null && mValidated) checkBlocked(url, detail);
    }

    /**
     * Android says the network works, yet the page didn't load. Per-app network switches (in
     * /e/OS and LineageOS) don't always tell the app, so look up a well-known name: if that
     * fails too, this app is cut off.
     */
    private void checkBlocked(String url, CharSequence detail) {
        new Thread(() -> {
            boolean cutOff;
            try {
                InetAddress.getByName(PROBE_HOST);
                cutOff = false;
            } catch (UnknownHostException e) {
                cutOff = true;
            }
            if (!cutOff) return;
            runOnUiThread(() -> {
                if (mErrorScreen.isShowing() && url.equals(mErrorScreen.url())) {
                    mErrorScreen.show(LoadErrorScreen.Kind.BLOCKED, url, 0, detail);
                }
            });
        }, "network-check").start();
    }

    private void retry() {
        String url = mErrorScreen.url();
        mErrorScreen.hide();
        if (url != null) {
            mWebView.loadUrl(url);
        } else {
            mWebView.reload();
        }
    }

    /**
     * Tries again by itself when the device gets a network after being without one, or
     * switches to another network (from mobile data to Wi-Fi, or another Wi-Fi).
     */
    private void watchNetwork() {
        ConnectivityManager network = getSystemService(ConnectivityManager.class);
        if (network == null) return;
        mNetworkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network available) {
                runOnUiThread(() -> {
                    // The first call after registering only reports the network in use.
                    boolean changed = mNetwork != null ? !available.equals(mNetwork) : mOffline;
                    if (!available.equals(mNetwork)) {
                        mValidated = false;
                        mBlocked = false;
                    }
                    mNetwork = available;
                    mOffline = false;
                    if (changed && mErrorScreen.isShowing()) retry();
                });
            }

            @Override
            public void onLost(Network lost) {
                runOnUiThread(() -> {
                    if (lost.equals(mNetwork)) {
                        mNetwork = null;
                        mValidated = false;
                        mBlocked = false;
                        mOffline = true;
                    }
                });
            }

            @Override
            public void onCapabilitiesChanged(Network changed, NetworkCapabilities capabilities) {
                boolean validated =
                        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
                runOnUiThread(() -> {
                    if (changed.equals(mNetwork)) mValidated = validated;
                });
            }

            /** Android 10 and later say when they don't let the app use the network. */
            @Override
            public void onBlockedStatusChanged(Network changed, boolean blocked) {
                runOnUiThread(() -> {
                    if (!changed.equals(mNetwork) || blocked == mBlocked) return;
                    mBlocked = blocked;
                    if (!mErrorScreen.isShowing()) return;
                    if (blocked) {
                        mErrorScreen.show(LoadErrorScreen.Kind.BLOCKED, mErrorScreen.url(), 0,
                                null);
                    } else {
                        retry();
                    }
                });
            }
        };
        network.registerDefaultNetworkCallback(mNetworkCallback);
    }

    private static boolean isSameHost(Uri url, String current) {
        if (current == null) return false;
        String host = Uri.parse(current).getHost();
        return host != null && host.equalsIgnoreCase(url.getHost());
    }

    private void openOutside(Uri url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url)
                    .addCategory(Intent.CATEGORY_BROWSABLE)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.noAppForLink, Toast.LENGTH_SHORT).show();
        }
    }

    // Back goes back in Huizenjacht (it also closes its pop-ups), then leaves the app.

    private void updateBack() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        boolean canGoBack = mWebView.canGoBack();
        OnBackInvokedDispatcher dispatcher = getOnBackInvokedDispatcher();
        if (canGoBack && mBackCallback == null) {
            OnBackInvokedCallback callback = () -> mWebView.goBack();
            dispatcher.registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback);
            mBackCallback = callback;
        } else if (!canGoBack && mBackCallback != null) {
            dispatcher.unregisterOnBackInvokedCallback((OnBackInvokedCallback) mBackCallback);
            mBackCallback = null;
        }
    }

    // Android 13 and later use the callback in updateBack(); this is for older versions.
    @Override
    @SuppressWarnings("deprecation")
    @SuppressLint("GestureBackNavigation")
    public void onBackPressed() {
        if (mWebView != null && mWebView.canGoBack()) {
            mWebView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /** Keeps the page clear of the status bar, navigation bar and keyboard. */
    @SuppressWarnings("deprecation")
    private void fitSystemBars(View root, int themeColor) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            getWindow().setStatusBarColor(themeColor);
            getWindow().setNavigationBarColor(themeColor);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets edges = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(edges.left, edges.top, edges.right, edges.bottom);
                return WindowInsets.CONSUMED;
            });
        } else {
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        }
        root.setBackgroundColor(themeColor);
        mWebView.setBackgroundColor(Color.TRANSPARENT);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (mWebView == null) return;
        mWebView.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (mWebView == null) return;
        mWebView.onResume();
        // Back from the settings, or the app was away for a while: try the failed page again.
        if (mErrorScreen.isShowing()) retry();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (mWebView != null && !mPageEngineGone) mWebView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (mNetworkCallback != null) {
            getSystemService(ConnectivityManager.class).unregisterNetworkCallback(mNetworkCallback);
        }
        if (mWebView != null) mWebView.destroy();
        super.onDestroy();
    }
}
