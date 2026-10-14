package com.photovault.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.graphics.Bitmap;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;

public class MainActivity extends AppCompatActivity {

    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private static final int PERMISSION_REQUEST_CODE = 2002;

    private WebView webView;
    private SwipeRefreshLayout swipeRefreshLayout;
    private ProgressBar loadingProgress;
    private SharedPreferences prefs;

    private View layoutError;
    private TextView tvErrorServerUrl;
    private Button btnRetry;
    private Button btnLogout;
    private boolean hasLoadError = false;
    private String currentServerUrl = "";

    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences("photovault_prefs", Context.MODE_PRIVATE);

        String serverUrl = getIntent().getStringExtra("SERVER_URL");
        if (serverUrl == null || serverUrl.isEmpty()) {
            serverUrl = prefs.getString("server_url", "");
        }

        if (serverUrl.isEmpty()) {
            redirectToConnect();
            return;
        }

        currentServerUrl = serverUrl;

        webView = findViewById(R.id.webView);
        swipeRefreshLayout = findViewById(R.id.swipeRefreshLayout);
        loadingProgress = findViewById(R.id.loadingProgress);

        layoutError = findViewById(R.id.layoutError);
        tvErrorServerUrl = findViewById(R.id.tvErrorServerUrl);
        btnRetry = findViewById(R.id.btnRetry);
        btnLogout = findViewById(R.id.btnLogout);

        if (tvErrorServerUrl != null) {
            tvErrorServerUrl.setText(currentServerUrl);
        }

        if (btnRetry != null) {
            btnRetry.setOnClickListener(v -> {
                btnRetry.setEnabled(false);
                btnRetry.setText("Conectando ao Servidor...");
                showErrorView(false);
                loadServerUrl();
                btnRetry.postDelayed(() -> {
                    btnRetry.setEnabled(true);
                    btnRetry.setText("Atualizar e Tentar Novamente");
                }, 2000);
            });
        }

        if (btnLogout != null) {
            btnLogout.setOnClickListener(v -> {
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle("Deslogar do Servidor")
                        .setMessage("Deseja desconectar sua conta deste servidor e voltar para a tela inicial?")
                        .setPositiveButton("Sim, Deslogar", (dialog, which) -> {
                            prefs.edit().remove("auth_token").remove("user_data").apply();
                            redirectToConnect();
                        })
                        .setNegativeButton("Cancelar", null)
                        .show();
            });
        }

        setupWebView();
        checkAndRequestPermissions();

        swipeRefreshLayout.setColorSchemeColors(ContextCompat.getColor(this, R.color.accent));
        // Disable swipeRefreshLayout pulling to prevent hijacking upward gallery scroll
        swipeRefreshLayout.setEnabled(false);
        swipeRefreshLayout.setOnChildScrollUpCallback((parent, child) -> true);

        // Setup Auto Backup listener to notify WebView
        AutoBackupManager.getInstance(this).setProgressCallback(new AutoBackupManager.BackupProgressCallback() {
            @Override
            public void onProgress(int current, int total, String filename) {
                runOnUiThread(() -> {
                    String json = AutoBackupManager.getInstance(MainActivity.this).getStatusJson();
                    if (webView != null) {
                        webView.evaluateJavascript("if (typeof window.onBackupProgress === 'function') window.onBackupProgress(" + json + ");", null);
                    }
                });
            }

            @Override
            public void onCompleted(int uploaded, int failed, long freedBytes) {
                runOnUiThread(() -> {
                    String json = AutoBackupManager.getInstance(MainActivity.this).getStatusJson();
                    if (webView != null) {
                        webView.evaluateJavascript("if (typeof window.onBackupProgress === 'function') window.onBackupProgress(" + json + ");", null);
                    }
                });
            }

            @Override
            public void onError(String error) {
                runOnUiThread(() -> {
                    String json = AutoBackupManager.getInstance(MainActivity.this).getStatusJson();
                    if (webView != null) {
                        webView.evaluateJavascript("if (typeof window.onBackupProgress === 'function') window.onBackupProgress(" + json + ");", null);
                    }
                });
            }
        });

        // Ensure background jobs are scheduled to run even when app is closed
        if (AutoBackupManager.getInstance(this).isAutoBackupEnabled()) {
            AutoBackupManager.scheduleAllBackgroundJobs(this);
        }

        // Load NayBinho Photos Server App
        loadServerUrl();

        // Check for app updates from server's /atualizacao directory
        AppUpdateManager.getInstance().checkForUpdate(this, serverUrl, false);
    }

    private void showErrorView(boolean show) {
        hasLoadError = show;
        if (show) {
            loadingProgress.setVisibility(View.GONE);
            swipeRefreshLayout.setRefreshing(false);
            webView.setVisibility(View.GONE);
            if (layoutError != null) {
                layoutError.setVisibility(View.VISIBLE);
            }
        } else {
            if (layoutError != null) {
                layoutError.setVisibility(View.GONE);
            }
            webView.setVisibility(View.VISIBLE);
        }
    }

    private void loadServerUrl() {
        hasLoadError = false;
        String token = prefs.getString("auth_token", "");
        String urlToLoad = currentServerUrl;
        if (token != null && !token.isEmpty()) {
            if (urlToLoad.contains("?")) {
                urlToLoad += "&native_token=" + Uri.encode(token);
            } else {
                urlToLoad += "?native_token=" + Uri.encode(token);
            }
        }
        webView.loadUrl(urlToLoad);
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " NayBinho-Photos-Android/1.0");

        // Native JS Bridge
        webView.addJavascriptInterface(new WebAppInterface(this), "Android");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Keep inside webview for server domain
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                hasLoadError = false;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request != null && request.isForMainFrame()) {
                    showErrorView(true);
                }
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                showErrorView(true);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                super.onReceivedHttpError(view, request, errorResponse);
                if (request != null && request.isForMainFrame() && errorResponse != null && errorResponse.getStatusCode() >= 500) {
                    showErrorView(true);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                swipeRefreshLayout.setRefreshing(false);
                loadingProgress.setVisibility(View.GONE);

                if (hasLoadError) {
                    showErrorView(true);
                } else {
                    showErrorView(false);
                    // Inject token automatically so user is logged in
                    injectAuthToken();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress < 100) {
                    loadingProgress.setVisibility(View.VISIBLE);
                    loadingProgress.setProgress(newProgress);
                } else {
                    loadingProgress.setVisibility(View.GONE);
                }
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }

            // HTML5 File Chooser / Camera Upload handling
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;

                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE);
                } catch (Exception e) {
                    MainActivity.this.filePathCallback = null;
                    Toast.makeText(MainActivity.this, "Erro ao abrir seletor de arquivos", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });
    }

    private void injectAuthToken() {
        String token = prefs.getString("auth_token", "");
        String user = prefs.getString("user_data", "{}");

        if (!token.isEmpty()) {
            // Escapes JSON single quotes for script
            String safeUser = user.replace("\\", "\\\\").replace("'", "\\'");

            String js = "(function() {" +
                    "  try {" +
                    "    localStorage.setItem('pv_token', '" + token + "');" +
                    "    localStorage.setItem('pv_user', '" + safeUser + "');" +
                    "    if (window.State) {" +
                    "      window.State.token = '" + token + "';" +
                    "      try { window.State.user = JSON.parse('" + safeUser + "'); } catch(e){}" +
                    "    }" +
                    "    var authOverlay = document.getElementById('authOverlay');" +
                    "    if (authOverlay) authOverlay.style.display = 'none';" +
                    "    var appMain = document.getElementById('appMain');" +
                    "    if (appMain) appMain.style.display = 'flex';" +
                    "    if (typeof showApp === 'function') showApp();" +
                    "    else if (typeof window.showApp === 'function') window.showApp();" +
                    "  } catch(e) { console.error('Auto login failed', e); }" +
                    "})()";

            webView.evaluateJavascript(js, null);

            // Automatically start background backup if enabled
            String serverUrl = prefs.getString("server_url", "");
            AutoBackupManager manager = AutoBackupManager.getInstance(this);
            if (manager.isAutoBackupEnabled() && !manager.isRunning() && !serverUrl.isEmpty()) {
                manager.startBackup(serverUrl, token, manager.isDeleteAfterUploadEnabled());
            }
        }
    }

    private void checkAndRequestPermissions() {
        java.util.List<String> permList = new java.util.ArrayList<>();
        permList.add(Manifest.permission.CAMERA);
        permList.add(Manifest.permission.ACCESS_FINE_LOCATION);
        permList.add(Manifest.permission.ACCESS_COARSE_LOCATION);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permList.add(Manifest.permission.READ_MEDIA_IMAGES);
            permList.add(Manifest.permission.READ_MEDIA_VIDEO);
            permList.add(Manifest.permission.POST_NOTIFICATIONS);
        } else {
            permList.add(Manifest.permission.READ_EXTERNAL_STORAGE);
            permList.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            permList.add(Manifest.permission.ACCESS_MEDIA_LOCATION);
        }

        String[] permissions = permList.toArray(new String[0]);
        ActivityCompat.requestPermissions(this, permissions, PERMISSION_REQUEST_CODE);

        // On Android 11+ (API 30+), request All Files Access so backed-up camera originals can be deleted automatically
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (!android.os.Environment.isExternalStorageManager()) {
                AutoBackupManager manager = AutoBackupManager.getInstance(this);
                if (manager.isDeleteAfterUploadEnabled()) {
                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                        if (!android.os.Environment.isExternalStorageManager()) {
                            Toast.makeText(this, "Permita o gerenciamento de arquivos para apagar fotos do celular após o backup", Toast.LENGTH_LONG).show();
                            try {
                                Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                                intent.setData(Uri.parse("package:" + getPackageName()));
                                startActivity(intent);
                            } catch (Exception e) {
                                Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                                startActivity(intent);
                            }
                        }
                    }, 2000);
                }
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (filePathCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getData() != null) {
                        results = new Uri[]{ data.getData() };
                    } else if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        results = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            results[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    }
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
        }
    }

    private void redirectToConnect() {
        Intent intent = new Intent(this, ConnectActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }

    @Override
    public void onBackPressed() {
        if (layoutError != null && layoutError.getVisibility() == View.VISIBLE) {
            super.onBackPressed();
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
