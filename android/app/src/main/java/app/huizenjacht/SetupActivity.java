package app.huizenjacht;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Asks for the address of your Huizenjacht server, checks that Huizenjacht answers there
 * (/api/health), and saves it. Shown the first time, and from the app icon's Server wijzigen.
 */
public class SetupActivity extends Activity {
    private EditText mUrl;
    private TextView mStatus;
    private Button mConnect;
    private Button mUseAnyway;
    private String mChecked;
    private int mAttempt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.setup);
        mUrl = findViewById(R.id.setupUrl);
        mStatus = findViewById(R.id.setupStatus);
        mConnect = findViewById(R.id.setupConnect);
        mUseAnyway = findViewById(R.id.setupUseAnyway);

        String current = Server.url(this);
        if (current == null) current = getString(R.string.defaultServer);
        if (savedInstanceState == null && current != null && !current.isEmpty()) {
            mUrl.setText(current.replaceFirst("^https://", ""));
        }
        mConnect.setOnClickListener(button -> check());
        mUseAnyway.setOnClickListener(button -> {
            if (mChecked != null) use(mChecked);
        });
        mUrl.setOnEditorActionListener((view, action, event) -> {
            if (action != EditorInfo.IME_ACTION_GO) return false;
            check();
            return true;
        });
        fitSystemBars(findViewById(R.id.setupRoot));
    }

    private void check() {
        String url = Server.normalize(mUrl.getText().toString());
        mUseAnyway.setVisibility(View.GONE);
        if (url == null) {
            showStatus(getString(R.string.setupInvalid));
            return;
        }
        mChecked = url;
        int attempt = ++mAttempt;
        mConnect.setEnabled(false);
        showStatus(getString(R.string.setupChecking));
        new Thread(() -> {
            String version = null;
            String problem = null;
            try {
                version = huizenjachtVersion(url);
            } catch (Exception e) {
                problem = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            }
            String found = version;
            String failed = problem;
            runOnUiThread(() -> {
                if (attempt != mAttempt || isFinishing()) return;
                mConnect.setEnabled(true);
                String host = url.replaceFirst("^https://", "");
                if (found != null) {
                    showStatus(getString(R.string.setupFound, found));
                    use(url);
                } else {
                    showStatus(failed != null
                            ? getString(R.string.setupUnreachable, host, failed)
                            : getString(R.string.setupNotHuizenjacht, host));
                    mUseAnyway.setVisibility(View.VISIBLE);
                }
            });
        }, "server-check").start();
    }

    /** Huizenjacht's version on that server, or null when something else answers there. */
    private static String huizenjachtVersion(String url) throws Exception {
        HttpURLConnection connection =
                (HttpURLConnection) new URL(url + "/api/health").openConnection();
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(10_000);
        connection.setRequestProperty("Accept", "application/json");
        try {
            int status = connection.getResponseCode();
            if (status != 200) return null;
            try (InputStream in = connection.getInputStream()) {
                ByteArrayOutputStream body = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                int read;
                while ((read = in.read(buffer)) != -1 && body.size() < 65536) {
                    body.write(buffer, 0, read);
                }
                JSONObject health = new JSONObject(body.toString(StandardCharsets.UTF_8.name()));
                if (!"ok".equals(health.optString("status"))) return null;
                return health.optString("version", "?");
            }
        } catch (org.json.JSONException e) {
            return null;
        } finally {
            connection.disconnect();
        }
    }

    private void use(String url) {
        Server.save(this, url);
        startActivity(new Intent(this, LauncherActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        finish();
    }

    private void showStatus(String text) {
        mStatus.setText(text);
        mStatus.setVisibility(View.VISIBLE);
    }

    /** Keeps the form clear of the status bar, navigation bar and keyboard. */
    @SuppressWarnings("deprecation")
    private void fitSystemBars(View root) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            getWindow().setStatusBarColor(getColor(R.color.themeColor));
            getWindow().setNavigationBarColor(getColor(R.color.themeColor));
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets edges = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(edges.left, edges.top, edges.right, edges.bottom);
                return WindowInsets.CONSUMED;
            });
        }
    }
}
