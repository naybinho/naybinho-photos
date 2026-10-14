package com.photovault.app;

import android.app.Activity;
import android.app.ProgressDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/**
 * Automatically checks for app updates from PhotoVault server's /atualizacao directory,
 * notifies the user, downloads the APK, and launches the native package installer.
 */
public class AppUpdateManager {

    private static final String TAG = "AppUpdateManager";
    private static final String PREF_NAME = "photovault_prefs";
    private static final String KEY_LAST_UPDATE_TIMESTAMP = "last_installed_update_timestamp";
    private static final String KEY_LAST_UPDATE_VERSION_CODE = "last_installed_version_code";

    private static AppUpdateManager instance;
    private final OkHttpClient httpClient;
    private final Handler mainHandler;
    private long lastDismissedVersionCode = 0;

    public static synchronized AppUpdateManager getInstance() {
        if (instance == null) {
            instance = new AppUpdateManager();
        }
        return instance;
    }

    private AppUpdateManager() {
        this.httpClient = new OkHttpClient();
        this.mainHandler = new Handler(Looper.getMainLooper());
    }

    /**
     * Helper to compare semantic version strings (e.g. "1.0.3" > "1.0.2")
     */
    private boolean isVersionNewer(String remote, String local) {
        try {
            String[] rParts = remote.replaceAll("[^0-9.]", "").split("\\.");
            String[] lParts = local.replaceAll("[^0-9.]", "").split("\\.");
            int maxLen = Math.max(rParts.length, lParts.length);
            for (int i = 0; i < maxLen; i++) {
                int r = i < rParts.length && !rParts[i].isEmpty() ? Integer.parseInt(rParts[i]) : 0;
                int l = i < lParts.length && !lParts[i].isEmpty() ? Integer.parseInt(lParts[i]) : 0;
                if (r > l) return true;
                if (r < l) return false;
            }
        } catch (Exception ignored) {}
        return false;
    }

    /**
     * Checks for updates against serverUrl
     */
    public void checkForUpdate(Activity activity, String serverUrl, boolean manualCheck) {
        if (activity == null || activity.isFinishing() || serverUrl == null || serverUrl.isEmpty()) {
            return;
        }

        SharedPreferences prefs = activity.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        long lastInstalledTimestamp = prefs.getLong(KEY_LAST_UPDATE_TIMESTAMP, 0);

        long currentVersionCode = 1;
        String currentVersionName = "1.0.0";
        try {
            PackageInfo pInfo = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                currentVersionCode = pInfo.getLongVersionCode();
            } else {
                currentVersionCode = pInfo.versionCode;
            }
            if (pInfo.versionName != null && !pInfo.versionName.isEmpty()) {
                currentVersionName = pInfo.versionName;
            }
        } catch (Exception ignored) {}

        final long appVersionCode = currentVersionCode;
        final String appVersionName = currentVersionName;

        String cleanUrl = serverUrl.endsWith("/") ? serverUrl.substring(0, serverUrl.length() - 1) : serverUrl;
        String checkUrl = cleanUrl + "/api/app/update/check?versionCode=" + appVersionCode
                + "&versionName=" + Uri.encode(appVersionName)
                + "&timestamp=" + lastInstalledTimestamp;

        Request request = new Request.Builder()
                .url(checkUrl)
                .get()
                .build();

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                if (manualCheck) {
                    mainHandler.post(() -> Toast.makeText(activity, "Não foi possível verificar atualizações: " + e.getMessage(), Toast.LENGTH_SHORT).show());
                }
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (!response.isSuccessful()) {
                    if (manualCheck) {
                        mainHandler.post(() -> Toast.makeText(activity, "Erro ao verificar atualizações (" + response.code() + ")", Toast.LENGTH_SHORT).show());
                    }
                    return;
                }

                String respBody = response.body() != null ? response.body().string() : "{}";
                try {
                    JSONObject json = new JSONObject(respBody);
                    boolean serverHasUpdate = json.optBoolean("hasUpdate", false);
                    long serverVersionCode = json.optLong("versionCode", 0);
                    String serverVersionName = json.optString("versionName", "");
                    String downloadUrl = json.optString("downloadUrl", "");
                    long fileSize = json.optLong("fileSize", 0);
                    long timestamp = json.optLong("timestamp", 0);
                    String notes = json.optString("notes", "");
                    String filename = json.optString("filename", "NayBinho-Photos-Update.apk");

                    // Verificação estrita e inteligente se há realmente atualização disponível
                    boolean hasUpdate = serverHasUpdate;
                    if (serverVersionCode > 0 && appVersionCode > 0) {
                        // Se o app já tem versionCode >= do servidor, NUNCA é atualização!
                        hasUpdate = serverVersionCode > appVersionCode;
                    } else if (!serverVersionName.isEmpty() && !appVersionName.isEmpty()) {
                        hasUpdate = isVersionNewer(serverVersionName, appVersionName);
                    }

                    // Se não foi verificação manual e o usuário já clicou "Depois" nesta versão durante esta sessão
                    if (!manualCheck && serverVersionCode > 0 && serverVersionCode <= lastDismissedVersionCode) {
                        hasUpdate = false;
                    }

                    final boolean finalHasUpdate = hasUpdate;
                    mainHandler.post(() -> {
                        if (activity.isFinishing()) return;

                        if (finalHasUpdate && !downloadUrl.isEmpty()) {
                            showUpdateDialog(activity, cleanUrl, downloadUrl, serverVersionCode, serverVersionName, appVersionName, fileSize, timestamp, notes, filename);
                        } else if (manualCheck) {
                            Toast.makeText(activity, "NayBinho Photos já está na versão mais recente (" + appVersionName + ")! ✨", Toast.LENGTH_SHORT).show();
                        }
                    });

                } catch (Exception e) {
                    Log.e(TAG, "Error parsing update json: " + e.getMessage());
                }
            }
        });
    }

    private void showUpdateDialog(Activity activity, String serverBaseUrl, String downloadUrl,
                                  long targetVersionCode, String targetVersionName, String currentVersionName,
                                  long fileSize, long timestamp, String notes, String filename) {
        String sizeFormatted = formatFileSize(fileSize);
        String message = "Uma nova versão do NayBinho Photos está disponível!\n\n" +
                "• Versão instalada: " + currentVersionName + "\n" +
                "• Nova versão: " + (targetVersionName.isEmpty() ? ("v" + targetVersionCode) : targetVersionName) + "\n" +
                (sizeFormatted.isEmpty() ? "" : "• Tamanho: " + sizeFormatted + "\n") +
                (notes.isEmpty() ? "" : "• Novidades: " + notes + "\n\n") +
                "Deseja baixar e atualizar agora?";

        new AlertDialog.Builder(activity)
                .setTitle("Atualização Disponível 🚀")
                .setMessage(message)
                .setCancelable(false)
                .setPositiveButton("Atualizar Agora", (dialog, which) -> {
                    String fullDownloadUrl = downloadUrl.startsWith("http") ? downloadUrl : (serverBaseUrl + downloadUrl);
                    downloadAndInstall(activity, fullDownloadUrl, filename, targetVersionCode, timestamp);
                })
                .setNegativeButton("Depois", (dialog, which) -> {
                    lastDismissedVersionCode = targetVersionCode;
                    dialog.dismiss();
                })
                .show();
    }

    private void downloadAndInstall(Activity activity, String downloadUrl, String filename, long newVersionCode, long newTimestamp) {
        ProgressDialog progressDialog = new ProgressDialog(activity);
        progressDialog.setTitle("Baixando Atualização");
        progressDialog.setMessage("Baixando nova versão do NayBinho Photos... Por favor, aguarde.");
        progressDialog.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);
        progressDialog.setMax(100);
        progressDialog.setProgress(0);
        progressDialog.setCancelable(false);
        progressDialog.show();

        Request request = new Request.Builder()
                .url(downloadUrl)
                .get()
                .build();

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                mainHandler.post(() -> {
                    if (progressDialog.isShowing()) progressDialog.dismiss();
                    Toast.makeText(activity, "Falha no download da atualização: " + e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (!response.isSuccessful() || response.body() == null) {
                    mainHandler.post(() -> {
                        if (progressDialog.isShowing()) progressDialog.dismiss();
                        Toast.makeText(activity, "Erro no servidor ao baixar APK (" + response.code() + ")", Toast.LENGTH_LONG).show();
                    });
                    return;
                }

                File destinationDir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (destinationDir == null) {
                    destinationDir = activity.getCacheDir();
                }
                File apkFile = new File(destinationDir, "NayBinho_Photos_Update.apk");
                if (apkFile.exists()) {
                    apkFile.delete();
                }

                long totalBytes = response.body().contentLength();
                long downloadedBytes = 0;

                try (InputStream is = response.body().byteStream();
                     FileOutputStream fos = new FileOutputStream(apkFile)) {

                    byte[] buffer = new byte[8192];
                    int read;

                    while ((read = is.read(buffer)) != -1) {
                        fos.write(buffer, 0, read);
                        downloadedBytes += read;

                        if (totalBytes > 0) {
                            final int percent = (int) ((downloadedBytes * 100) / totalBytes);
                            mainHandler.post(() -> progressDialog.setProgress(percent));
                        }
                    }
                    fos.flush();

                    mainHandler.post(() -> {
                        if (progressDialog.isShowing()) progressDialog.dismiss();

                        // Save update info
                        SharedPreferences prefs = activity.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                        prefs.edit()
                                .putLong(KEY_LAST_UPDATE_TIMESTAMP, newTimestamp)
                                .putLong(KEY_LAST_UPDATE_VERSION_CODE, newVersionCode)
                                .apply();

                        // Launch package installer
                        launchInstaller(activity, apkFile);
                    });

                } catch (Exception e) {
                    mainHandler.post(() -> {
                        if (progressDialog.isShowing()) progressDialog.dismiss();
                        Toast.makeText(activity, "Erro ao salvar arquivo APK: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    });
                }
            }
        });
    }

    private void launchInstaller(Activity activity, File apkFile) {
        if (!apkFile.exists()) {
            Toast.makeText(activity, "Arquivo de atualização não encontrado.", Toast.LENGTH_SHORT).show();
            return;
        }

        // On Android 8.0+ (Oreo+), check if unknown sources permission is granted
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                new AlertDialog.Builder(activity)
                        .setTitle("Permissão Necessária")
                        .setMessage("Para atualizar o NayBinho Photos, permita a instalação de aplicativos desta fonte.")
                        .setPositiveButton("Configurações", (dialog, which) -> {
                            Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                            settingsIntent.setData(Uri.parse("package:" + activity.getPackageName()));
                            activity.startActivity(settingsIntent);
                        })
                        .setNegativeButton("Cancelar", null)
                        .show();
                return;
            }
        }

        try {
            Uri apkUri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".provider", apkFile);

            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            activity.startActivity(installIntent);
        } catch (Exception e) {
            Log.e(TAG, "Error launching package installer: " + e.getMessage(), e);
            Toast.makeText(activity, "Erro ao abrir instalador do APK: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private String formatFileSize(long bytes) {
        if (bytes <= 0) return "";
        double mb = bytes / (1024.0 * 1024.0);
        return String.format("%.1f MB", mb);
    }
}
