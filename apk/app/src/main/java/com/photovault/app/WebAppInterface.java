package com.photovault.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.content.ContentUris;
import android.database.Cursor;
import android.provider.MediaStore;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

import org.json.JSONObject;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

public class WebAppInterface {
    private static final OkHttpClient SHARED_CLIENT = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build();

    private static final ExecutorService SHARE_EXECUTOR = Executors.newFixedThreadPool(4);
    private static final ConcurrentHashMap<String, Future<?>> ACTIVE_DOWNLOADS = new ConcurrentHashMap<>();

    private final Context context;
    private final SharedPreferences prefs;
    private final AutoBackupManager backupManager;

    public WebAppInterface(Context context) {
        this.context = context;
        this.prefs = context.getSharedPreferences("photovault_prefs", Context.MODE_PRIVATE);
        this.backupManager = AutoBackupManager.getInstance(context);
    }

    /**
     * Called from Web frontend when user clicks "Sair" (Logout)
     */
    @JavascriptInterface
    public void onLogout() {
        // Clear token but keep server URL pre-filled for convenience
        prefs.edit().remove("auth_token").remove("user_data").apply();

        Intent intent = new Intent(context, ConnectActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        context.startActivity(intent);
    }

    @JavascriptInterface
    public String getServerUrl() {
        return prefs.getString("server_url", "");
    }

    @JavascriptInterface
    public String getToken() {
        return prefs.getString("auth_token", "");
    }

    @JavascriptInterface
    public String getUserData() {
        return prefs.getString("user_data", "{}");
    }

    @JavascriptInterface
    public void showToast(String message) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
    }

    @JavascriptInterface
    public void checkAppUpdate() {
        if (context instanceof Activity) {
            Activity act = (Activity) context;
            String serverUrl = prefs.getString("server_url", "");
            act.runOnUiThread(() -> {
                AppUpdateManager.getInstance().checkForUpdate(act, serverUrl, true);
            });
        }
    }

    @JavascriptInterface
    public String getAppVersion() {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1.0.3";
        }
    }

    @JavascriptInterface
    public long getAppVersionCode() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).getLongVersionCode();
            } else {
                return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionCode;
            }
        } catch (Exception e) {
            return 4;
        }
    }

    // ==================== AUTO BACKUP & FREE UP SPACE BRIDGE ====================

    @JavascriptInterface
    public boolean isNativeAndroid() {
        return true;
    }

    @JavascriptInterface
    public boolean isAutoBackupEnabled() {
        return backupManager.isAutoBackupEnabled();
    }

    @JavascriptInterface
    public void setAutoBackupEnabled(boolean enabled) {
        backupManager.setAutoBackupEnabled(enabled);
        if (enabled && !backupManager.isRunning()) {
            startAutoBackup(backupManager.isDeleteAfterUploadEnabled());
        }
    }

    @JavascriptInterface
    public boolean isDeleteAfterUploadEnabled() {
        return backupManager.isDeleteAfterUploadEnabled();
    }

    @JavascriptInterface
    public void setDeleteAfterUploadEnabled(boolean enabled) {
        backupManager.setDeleteAfterUploadEnabled(enabled);
    }

    @JavascriptInterface
    public boolean isAutoBackupRunning() {
        return backupManager.isRunning();
    }

    @JavascriptInterface
    public void startAutoBackup(boolean deleteAfterUpload) {
        String serverUrl = getServerUrl();
        String token = getToken();
        if (serverUrl.isEmpty() || token.isEmpty()) {
            showToast("Conecte-se para iniciar o backup");
            return;
        }
        backupManager.startBackup(serverUrl, token, deleteAfterUpload);
    }

    @JavascriptInterface
    public void stopAutoBackup() {
        backupManager.stopBackup();
    }

    @JavascriptInterface
    public String getBackupStatusJson() {
        return backupManager.getStatusJson();
    }

    @JavascriptInterface
    public int getPendingMediaCount() {
        try {
            List<AutoBackupManager.LocalMediaItem> items = backupManager.scanLocalMedia(false);
            return items.size();
        } catch (Exception e) {
            return 0;
        }
    }

    @JavascriptInterface
    public boolean hasStorageManagerPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return ContextCompat.checkSelfPermission(
                context, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    @JavascriptInterface
    public void requestStorageManagerPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                intent.setData(Uri.parse("package:" + context.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            } catch (Exception e) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            }
        } else {
            if (context instanceof Activity) {
                ActivityCompat.requestPermissions(
                        (Activity) context,
                        new String[]{ Manifest.permission.WRITE_EXTERNAL_STORAGE },
                        2003
                );
            }
        }
    }

    /**
     * "Liberar Espaço no Dispositivo": Scans and deletes already synced media items from phone.
     */
    @JavascriptInterface
    public String freeUpDeviceSpace() {
        try {
            List<AutoBackupManager.LocalMediaItem> alreadySynced = backupManager.scanLocalMedia(true);
            int deletedCount = 0;
            long freedBytes = 0;

            for (AutoBackupManager.LocalMediaItem item : alreadySynced) {
                boolean deleted = backupManager.deleteLocalMedia(item);
                if (deleted) {
                    deletedCount++;
                    freedBytes += item.size;
                }
            }

            JSONObject res = new JSONObject();
            res.put("deletedCount", deletedCount);
            res.put("freedBytes", freedBytes);
            return res.toString();
        } catch (Exception e) {
            return "{\"deletedCount\":0,\"freedBytes\":0,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    /**
     * Pre-cache photo or video in the background as soon as it is opened in the viewer.
     * When the user taps "Compartilhar", the file is already downloaded and opens in 0ms!
     */
    @JavascriptInterface
    public void preloadMediaForShare(String mediaId, String title, String mediaType) {
        if (mediaId == null || mediaId.trim().isEmpty()) return;
        SHARE_EXECUTOR.execute(() -> {
            try {
                boolean isVideo = "video".equalsIgnoreCase(mediaType);
                String ext = isVideo ? ".mp4" : ".jpg";

                // Step 1: Check if already in device's MediaStore
                if (findLocalMediaStoreUri(title, isVideo) != null) return;

                // Step 2: Check if already in cache
                File cacheDir = new File(context.getCacheDir(), "shared_media");
                if (!cacheDir.exists()) cacheDir.mkdirs();

                final String safeName = sanitizeFilename(title, ext);
                File sharedFile = new File(cacheDir, mediaId + "_" + safeName);
                if (sharedFile.exists() && sharedFile.length() > 0) return;

                // Step 3: Trigger background download if not already running
                if (ACTIVE_DOWNLOADS.containsKey(mediaId)) return;

                Future<?> future = SHARE_EXECUTOR.submit(() -> {
                    try {
                        downloadMediaToServerCache(mediaId, safeName, ext, cacheDir, sharedFile);
                    } catch (Throwable t) {
                        Log.w("WebAppInterface", "Preload failed for " + mediaId + ": " + t.getMessage());
                    } finally {
                        ACTIVE_DOWNLOADS.remove(mediaId);
                    }
                });
                ACTIVE_DOWNLOADS.put(mediaId, future);

            } catch (Throwable ignored) {}
        });
    }

    /**
     * Share photo or video with external apps (WhatsApp, Instagram, Telegram, etc.)
     * Ultra-fast implementation:
     * 1. Checks if file already exists locally in MediaStore (0 ms).
     * 2. Checks if file already cached in shared_media (0 ms).
     * 3. If preloading is currently in progress, waits on active future to avoid duplicate work.
     * 4. Downloads directly via /api/media/{id}/file using high-speed OkHttpClient buffer.
     * 5. Launches Chooser on Main Thread using FileProvider and FLAG_GRANT_READ_URI_PERMISSION.
     */
    @JavascriptInterface
    public void shareMedia(String mediaId, String title, String mediaType) {
        SHARE_EXECUTOR.execute(() -> {
            try {
                boolean isVideo = "video".equalsIgnoreCase(mediaType);
                String ext = isVideo ? ".mp4" : ".jpg";
                String mimeType = isVideo ? "video/mp4" : "image/jpeg";

                // Step 1: Check if photo/video already exists on this device in MediaStore (0 ms)
                Uri localUri = findLocalMediaStoreUri(title, isVideo);
                if (localUri != null) {
                    launchShareIntent(localUri, mimeType);
                    return;
                }

                // Step 2: Check if already cached in app cache (0 ms)
                File cacheDir = new File(context.getCacheDir(), "shared_media");
                if (!cacheDir.exists()) cacheDir.mkdirs();

                final String safeName = sanitizeFilename(title, ext);
                File sharedFile = new File(cacheDir, mediaId + "_" + safeName);

                if (sharedFile.exists() && sharedFile.length() > 0) {
                    Uri contentUri = FileProvider.getUriForFile(context, context.getPackageName() + ".provider", sharedFile);
                    launchShareIntent(contentUri, mimeType);
                    return;
                }

                // Step 3: Check if already being downloaded by preload
                Future<?> activeFuture = ACTIVE_DOWNLOADS.get(mediaId);
                if (activeFuture != null) {
                    try {
                        activeFuture.get(15, TimeUnit.SECONDS);
                    } catch (Exception ignored) {}
                }

                if (sharedFile.exists() && sharedFile.length() > 0) {
                    Uri contentUri = FileProvider.getUriForFile(context, context.getPackageName() + ".provider", sharedFile);
                    launchShareIntent(contentUri, mimeType);
                    return;
                }

                // Step 4: Download from server
                new Handler(Looper.getMainLooper()).post(() -> {
                    Toast.makeText(context, "Preparando foto para compartilhar...", Toast.LENGTH_SHORT).show();
                });

                downloadMediaToServerCache(mediaId, safeName, ext, cacheDir, sharedFile);

                if (sharedFile.exists() && sharedFile.length() > 0) {
                    Uri contentUri = FileProvider.getUriForFile(context, context.getPackageName() + ".provider", sharedFile);
                    launchShareIntent(contentUri, mimeType);

                    // Clean old cache in background without blocking UI
                    SHARE_EXECUTOR.execute(() -> cleanOldSharedFiles(cacheDir));
                } else {
                    throw new IOException("Arquivo baixado está vazio ou indisponível.");
                }

            } catch (Exception e) {
                Log.e("WebAppInterface", "Erro ao compartilhar", e);
                new Handler(Looper.getMainLooper()).post(() ->
                    Toast.makeText(context, "Erro ao compartilhar: " + e.getMessage(), Toast.LENGTH_LONG).show()
                );
            }
        });
    }

    private void downloadMediaToServerCache(String mediaId, String safeName, String ext, File cacheDir, File sharedFile) throws IOException {
        String serverUrl = getServerUrl();
        String token = getToken();
        if (serverUrl.isEmpty() || token.isEmpty()) {
            throw new IOException("Sessão expirada. Conecte-se novamente.");
        }

        String cleanServerUrl = serverUrl.replaceAll("/+$", "");
        String streamUrl = cleanServerUrl + "/api/media/" + mediaId + "/file?token=" + Uri.encode(token);

        Request req = new Request.Builder()
                .url(streamUrl)
                .header("Authorization", "Bearer " + token)
                .build();

        File tempFile = new File(cacheDir, "temp_" + mediaId + "_" + System.currentTimeMillis() + ext);

        try (Response res = SHARED_CLIENT.newCall(req).execute()) {
            if (!res.isSuccessful() || res.body() == null) {
                // Fallback to /download endpoint if needed
                String dlUrl = cleanServerUrl + "/api/media/" + mediaId + "/download?token=" + Uri.encode(token);
                Request reqDl = new Request.Builder()
                        .url(dlUrl)
                        .header("Authorization", "Bearer " + token)
                        .build();
                try (Response resDl = SHARED_CLIENT.newCall(reqDl).execute()) {
                    if (!resDl.isSuccessful() || resDl.body() == null) {
                        throw new IOException("Falha no download da foto: " + resDl.code());
                    }
                    writeStreamToFile(resDl.body().byteStream(), tempFile);
                }
            } else {
                writeStreamToFile(res.body().byteStream(), tempFile);
            }
        }

        if (tempFile.exists() && tempFile.length() > 0) {
            if (sharedFile.exists()) sharedFile.delete();
            if (!tempFile.renameTo(sharedFile)) {
                // Fallback copy if rename fails
                try (InputStream in = new BufferedInputStream(new FileInputStream(tempFile));
                     OutputStream out = new BufferedOutputStream(new FileOutputStream(sharedFile))) {
                    byte[] buf = new byte[65536];
                    int len;
                    while ((len = in.read(buf)) != -1) {
                        out.write(buf, 0, len);
                    }
                    out.flush();
                }
                tempFile.delete();
            }
        }
    }

    private void writeStreamToFile(InputStream inStream, File targetFile) throws IOException {
        try (InputStream in = new BufferedInputStream(inStream, 131072);
             OutputStream out = new BufferedOutputStream(new FileOutputStream(targetFile), 131072)) {
            byte[] buffer = new byte[131072];
            int bytesRead;
            while ((bytesRead = in.read(buffer)) != -1) {
                out.write(buffer, 0, bytesRead);
            }
            out.flush();
        }
    }

    private void launchShareIntent(Uri contentUri, String mimeType) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType(mimeType);
                shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                shareIntent.setClipData(android.content.ClipData.newRawUri("", contentUri));
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(shareIntent, "Compartilhar com");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                context.startActivity(chooser);
            } catch (Exception e) {
                Log.e("WebAppInterface", "Falha ao abrir diálogo de compartilhamento", e);
                Toast.makeText(context, "Não foi possível abrir o compartilhamento: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }

    private Uri findLocalMediaStoreUri(String filename, boolean isVideo) {
        if (filename == null || filename.trim().isEmpty()) return null;
        try {
            Uri baseUri = isVideo ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            String[] proj = { MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME };
            String sel = MediaStore.MediaColumns.DISPLAY_NAME + " = ? COLLATE NOCASE";
            String[] args = { filename };
            try (Cursor cursor = context.getContentResolver().query(baseUri, proj, sel, args, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    long id = cursor.getLong(0);
                    return ContentUris.withAppendedId(baseUri, id);
                }
            }
        } catch (Throwable ignored) {}
        return null;
    }

    private void cleanOldSharedFiles(File cacheDir) {
        try {
            File[] files = cacheDir.listFiles();
            if (files != null && files.length > 50) {
                long now = System.currentTimeMillis();
                for (File f : files) {
                    if (now - f.lastModified() > 3 * 24 * 60 * 60 * 1000L) {
                        f.delete();
                    }
                }
            }
        } catch (Throwable ignored) {}
    }

    private String sanitizeFilename(String title, String ext) {
        if (title == null || title.trim().isEmpty()) {
            return "photo" + ext;
        }
        String clean = title.replaceAll("[^a-zA-Z0-9.-]", "_");
        return clean.toLowerCase().endsWith(ext) ? clean : (clean + ext);
    }
}
