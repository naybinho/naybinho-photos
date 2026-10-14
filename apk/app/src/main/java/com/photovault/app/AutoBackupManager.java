package com.photovault.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;

/**
 * Manages automatic backup of local photos and videos to PhotoVault server,
 * and handles "Free Up Device Space" (deleting device originals after verified upload).
 */
public class AutoBackupManager {

    private static final String TAG = "AutoBackupManager";
    private static final String PREF_NAME = "photovault_backup_prefs";
    private static final String KEY_AUTO_BACKUP = "auto_backup_enabled";
    private static final String KEY_DELETE_AFTER_UPLOAD = "delete_after_upload";
    private static final String KEY_SYNCED_IDS = "synced_media_ids";
    private static final String KEY_LAST_SYNC_TIME = "last_sync_time";
    private static final String KEY_TOTAL_UPLOADED = "total_uploaded_count";
    private static final String KEY_TOTAL_FREED_BYTES = "total_freed_bytes";

    public static final int JOB_ID_PERIODIC = 1001;
    public static final int JOB_ID_CONTENT_TRIGGER = 1002;

    private static AutoBackupManager instance;

    private final Context context;
    private final SharedPreferences prefs;
    private final OkHttpClient httpClient;
    private final ExecutorService executor;

    private final AtomicBoolean isRunning = new AtomicBoolean(false);
    private int currentItemIndex = 0;
    private int totalItemsToSync = 0;
    private String currentFilename = "";
    private String lastErrorMessage = "";

    public interface BackupProgressCallback {
        void onProgress(int current, int total, String filename);
        void onCompleted(int uploaded, int failed, long freedBytes);
        void onError(String error);
    }

    private BackupProgressCallback currentCallback;

    public static synchronized AutoBackupManager getInstance(Context context) {
        if (instance == null) {
            instance = new AutoBackupManager(context.getApplicationContext());
        }
        return instance;
    }

    private AutoBackupManager(Context context) {
        this.context = context;
        this.prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                .writeTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
                .build();
        this.executor = Executors.newSingleThreadExecutor();
    }

    public static void scheduleAllBackgroundJobs(Context context) {
        schedulePeriodicJob(context);
        scheduleContentTriggerJob(context);
    }

    public static void cancelAllBackgroundJobs(Context context) {
        try {
            JobScheduler js = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js != null) {
                js.cancel(JOB_ID_PERIODIC);
                js.cancel(JOB_ID_CONTENT_TRIGGER);
                Log.d(TAG, "Cancelled all background backup jobs");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error cancelling background jobs: " + e.getMessage());
        }
    }

    public static void schedulePeriodicJob(Context context) {
        try {
            JobScheduler js = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return;

            ComponentName serviceComponent = new ComponentName(context, BackupJobService.class);
            JobInfo.Builder builder = new JobInfo.Builder(JOB_ID_PERIODIC, serviceComponent)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPersisted(true)
                    .setPeriodic(15 * 60 * 1000); // Every 15 min periodic check

            js.schedule(builder.build());
            Log.d(TAG, "Scheduled periodic background backup job (every 15 min)");
        } catch (Exception e) {
            Log.e(TAG, "Error scheduling periodic backup job: " + e.getMessage());
        }
    }

    public static void scheduleContentTriggerJob(Context context) {
        try {
            JobScheduler js = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return;

            ComponentName serviceComponent = new ComponentName(context, BackupJobService.class);
            JobInfo.Builder builder = new JobInfo.Builder(JOB_ID_CONTENT_TRIGGER, serviceComponent)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY);

            // On Android 7.0+ (API 24+), wake up immediately when a new camera photo/video is created
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                builder.addTriggerContentUri(new JobInfo.TriggerContentUri(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        JobInfo.TriggerContentUri.FLAG_NOTIFY_FOR_DESCENDANTS
                ));
                builder.addTriggerContentUri(new JobInfo.TriggerContentUri(
                        MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                        JobInfo.TriggerContentUri.FLAG_NOTIFY_FOR_DESCENDANTS
                ));
                builder.setTriggerContentUpdateDelay(5 * 1000); // 5s after photo is saved
                builder.setTriggerContentMaxDelay(15 * 1000);   // Max 15s delay
            }

            js.schedule(builder.build());
            Log.d(TAG, "Scheduled content trigger backup job for new camera photos/videos");
        } catch (Exception e) {
            Log.e(TAG, "Error scheduling content trigger job: " + e.getMessage());
        }
    }

    public boolean isAutoBackupEnabled() {
        return prefs.getBoolean(KEY_AUTO_BACKUP, true);
    }

    public void setAutoBackupEnabled(boolean enabled) {
        prefs.edit().putBoolean(KEY_AUTO_BACKUP, enabled).apply();
        if (enabled) {
            scheduleAllBackgroundJobs(context);
        } else {
            cancelAllBackgroundJobs(context);
        }
    }

    public boolean isDeleteAfterUploadEnabled() {
        return prefs.getBoolean(KEY_DELETE_AFTER_UPLOAD, true);
    }

    public void setDeleteAfterUploadEnabled(boolean enabled) {
        prefs.edit().putBoolean(KEY_DELETE_AFTER_UPLOAD, enabled).apply();
    }

    public boolean isRunning() {
        return isRunning.get();
    }

    public void setProgressCallback(BackupProgressCallback callback) {
        this.currentCallback = callback;
    }

    public String getStatusJson() {
        try {
            JSONObject json = new JSONObject();
            json.put("isRunning", isRunning.get());
            json.put("current", currentItemIndex);
            json.put("total", totalItemsToSync);
            json.put("currentFilename", currentFilename);
            json.put("autoBackup", isAutoBackupEnabled());
            json.put("deleteAfterUpload", isDeleteAfterUploadEnabled());
            json.put("lastSyncTime", prefs.getLong(KEY_LAST_SYNC_TIME, 0));
            json.put("totalUploaded", prefs.getInt(KEY_TOTAL_UPLOADED, 0));
            json.put("totalFreedBytes", prefs.getLong(KEY_TOTAL_FREED_BYTES, 0));
            json.put("lastError", lastErrorMessage);
            return json.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    public static class LocalMediaItem {
        public long id;
        public Uri uri;
        public String displayName;
        public String mimeType;
        public long size;
        public boolean isVideo;
        public String filePath;

        public LocalMediaItem(long id, Uri uri, String displayName, String mimeType, long size, boolean isVideo, String filePath) {
            this.id = id;
            this.uri = uri;
            this.displayName = displayName;
            this.mimeType = mimeType;
            this.size = size;
            this.isVideo = isVideo;
            this.filePath = filePath;
        }

        public LocalMediaItem(long id, Uri uri, String displayName, String mimeType, long size, boolean isVideo) {
            this(id, uri, displayName, mimeType, size, isVideo, null);
        }
    }

    /**
     * Scans MediaStore for local photos and videos on device.
     */
    public List<LocalMediaItem> scanLocalMedia(boolean includeAlreadySynced) {
        List<LocalMediaItem> items = new ArrayList<>();
        Set<String> syncedIds = prefs.getStringSet(KEY_SYNCED_IDS, new HashSet<>());

        // 1. Scan Images
        Uri imageUri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        String[] imageProj = {
                MediaStore.Images.Media._ID,
                MediaStore.Images.Media.DISPLAY_NAME,
                MediaStore.Images.Media.MIME_TYPE,
                MediaStore.Images.Media.SIZE,
                MediaStore.Images.Media.DATA
        };
        try (Cursor cursor = context.getContentResolver().query(imageUri, imageProj, null, null, MediaStore.Images.Media.DATE_ADDED + " DESC")) {
            if (cursor != null) {
                int idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                int nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME);
                int mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE);
                int sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE);
                int dataCol = cursor.getColumnIndex(MediaStore.Images.Media.DATA);

                while (cursor.moveToNext()) {
                    long id = cursor.getLong(idCol);
                    String idStr = "img_" + id;
                    if (!includeAlreadySynced && syncedIds.contains(idStr)) {
                        continue;
                    }
                    String name = cursor.getString(nameCol);
                    String mime = cursor.getString(mimeCol);
                    long size = cursor.getLong(sizeCol);
                    String filePath = (dataCol != -1) ? cursor.getString(dataCol) : null;
                    Uri itemUri = ContentUris.withAppendedId(imageUri, id);

                    items.add(new LocalMediaItem(id, itemUri, name, mime, size, false, filePath));
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error scanning local images: " + e.getMessage());
        }

        // 2. Scan Videos
        Uri videoUri = MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
        String[] videoProj = {
                MediaStore.Video.Media._ID,
                MediaStore.Video.Media.DISPLAY_NAME,
                MediaStore.Video.Media.MIME_TYPE,
                MediaStore.Video.Media.SIZE,
                MediaStore.Video.Media.DATA
        };
        try (Cursor cursor = context.getContentResolver().query(videoUri, videoProj, null, null, MediaStore.Video.Media.DATE_ADDED + " DESC")) {
            if (cursor != null) {
                int idCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID);
                int nameCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME);
                int mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.MIME_TYPE);
                int sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE);
                int dataCol = cursor.getColumnIndex(MediaStore.Video.Media.DATA);

                while (cursor.moveToNext()) {
                    long id = cursor.getLong(idCol);
                    String idStr = "vid_" + id;
                    if (!includeAlreadySynced && syncedIds.contains(idStr)) {
                        continue;
                    }
                    String name = cursor.getString(nameCol);
                    String mime = cursor.getString(mimeCol);
                    long size = cursor.getLong(sizeCol);
                    String filePath = (dataCol != -1) ? cursor.getString(dataCol) : null;
                    Uri itemUri = ContentUris.withAppendedId(videoUri, id);

                    items.add(new LocalMediaItem(id, itemUri, name, mime, size, true, filePath));
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error scanning local videos: " + e.getMessage());
        }

        return items;
    }

    /**
     * Starts the auto backup process in a background thread.
     */
    public synchronized void startBackup(String serverUrl, String token, boolean deleteAfterUpload) {
        if (isRunning.get()) {
            Log.d(TAG, "Backup already running");
            return;
        }

        if (serverUrl == null || serverUrl.isEmpty() || token == null || token.isEmpty()) {
            Log.e(TAG, "Server URL or token is empty. Cannot start backup.");
            return;
        }

        executor.execute(() -> {
            performBackupSync(serverUrl, token, deleteAfterUpload);
        });
    }

    /**
     * Synchronous backup execution loop. Can be called directly by BackupJobService
     * on its background thread or by startBackup on executor.
     */
    public void performBackupSync(String serverUrl, String token, boolean deleteAfterUpload) {
        if (!isRunning.compareAndSet(false, true)) {
            Log.d(TAG, "Backup already running, skipping sync");
            return;
        }

        lastErrorMessage = "";
        int uploadedCount = 0;
        int failedCount = 0;
        long freedBytes = 0;

        try {
            List<LocalMediaItem> pendingItems = scanLocalMedia(false);
            totalItemsToSync = pendingItems.size();
            currentItemIndex = 0;

            Log.d(TAG, "Found " + totalItemsToSync + " pending media items to backup.");

            Set<String> syncedIds = new HashSet<>(prefs.getStringSet(KEY_SYNCED_IDS, new HashSet<>()));

            for (int i = 0; i < pendingItems.size(); i++) {
                if (!isRunning.get()) {
                    Log.d(TAG, "Backup cancelled by user");
                    break;
                }

                LocalMediaItem item = pendingItems.get(i);
                currentItemIndex = i + 1;
                currentFilename = item.displayName != null ? item.displayName : "Item " + item.id;

                if (currentCallback != null) {
                    currentCallback.onProgress(currentItemIndex, totalItemsToSync, currentFilename);
                }

                boolean uploadOk = uploadSingleMedia(serverUrl, token, item);

                if (uploadOk) {
                    uploadedCount++;
                    String idTag = (item.isVideo ? "vid_" : "img_") + item.id;
                    syncedIds.add(idTag);

                    // If delete after upload is enabled: remove original file from phone
                    if (deleteAfterUpload) {
                        boolean deleted = deleteLocalMedia(item);
                        if (deleted) {
                            freedBytes += item.size;
                            Log.d(TAG, "Freed device space: deleted " + item.displayName + " (" + item.size + " bytes)");
                        } else {
                            Log.w(TAG, "Could not delete local file: " + item.displayName + " (path=" + item.filePath + ")");
                        }
                    }
                } else {
                    failedCount++;
                }

                // Save progress periodically
                if (uploadedCount % 5 == 0) {
                    prefs.edit().putStringSet(KEY_SYNCED_IDS, syncedIds).apply();
                }
            }

            // Finalize batch
            long totalFreed = prefs.getLong(KEY_TOTAL_FREED_BYTES, 0) + freedBytes;
            int totalUploaded = prefs.getInt(KEY_TOTAL_UPLOADED, 0) + uploadedCount;

            prefs.edit()
                    .putStringSet(KEY_SYNCED_IDS, syncedIds)
                    .putLong(KEY_LAST_SYNC_TIME, System.currentTimeMillis())
                    .putInt(KEY_TOTAL_UPLOADED, totalUploaded)
                    .putLong(KEY_TOTAL_FREED_BYTES, totalFreed)
                    .apply();

            if (currentCallback != null) {
                currentCallback.onCompleted(uploadedCount, failedCount, freedBytes);
            }

        } catch (Exception e) {
            lastErrorMessage = e.getMessage();
            Log.e(TAG, "Backup error: " + e.getMessage(), e);
            if (currentCallback != null) {
                currentCallback.onError(e.getMessage());
            }
        } finally {
            isRunning.set(false);
        }
    }

    public void stopBackup() {
        isRunning.set(false);
    }

    private boolean uploadSingleMedia(String serverUrl, String token, LocalMediaItem item) {
        try {
            ContentResolver resolver = context.getContentResolver();
            byte[] fileBytes = null;
            float[] latLong = new float[2];
            boolean hasGps = false;

            // 1. Try reading directly from filesystem if path is available (bypasses Scoped Storage EXIF stripping)
            if (item.filePath != null && !item.filePath.isEmpty()) {
                try {
                    java.io.File localFile = new java.io.File(item.filePath);
                    if (localFile.exists() && localFile.canRead()) {
                        try (java.io.FileInputStream fis = new java.io.FileInputStream(localFile)) {
                            fileBytes = toByteArray(fis);
                        }
                        try {
                            android.media.ExifInterface exif = new android.media.ExifInterface(item.filePath);
                            if (exif.getLatLong(latLong)) {
                                hasGps = true;
                                Log.d(TAG, "Extracted GPS from file (" + item.displayName + "): " + latLong[0] + ", " + latLong[1]);
                            }
                        } catch (Exception ignored) {}
                    }
                } catch (Exception ignored) {}
            }

            // 2. Fallback to ContentResolver with setRequireOriginal (retains original unredacted EXIF)
            if (fileBytes == null) {
                Uri readUri = item.uri;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try {
                        readUri = MediaStore.setRequireOriginal(item.uri);
                    } catch (Exception ignored) {}
                }

                try (InputStream in = resolver.openInputStream(readUri)) {
                    if (in == null) return false;
                    fileBytes = toByteArray(in);
                }

                if (!hasGps && fileBytes != null) {
                    try (java.io.ByteArrayInputStream bais = new java.io.ByteArrayInputStream(fileBytes)) {
                        android.media.ExifInterface exif = new android.media.ExifInterface(bais);
                        if (exif.getLatLong(latLong)) {
                            hasGps = true;
                            Log.d(TAG, "Extracted GPS from stream (" + item.displayName + "): " + latLong[0] + ", " + latLong[1]);
                        }
                    } catch (Exception ignored) {}
                }
            }

            // 3. Fallback to device's current location if photo does not have embedded GPS metadata
            if (!hasGps) {
                android.location.Location deviceLoc = getLastKnownLocation();
                if (deviceLoc != null) {
                    latLong[0] = (float) deviceLoc.getLatitude();
                    latLong[1] = (float) deviceLoc.getLongitude();
                    hasGps = true;
                    Log.d(TAG, "Applied device fallback GPS (" + latLong[0] + ", " + latLong[1] + ") to " + item.displayName);
                }
            }

            if (fileBytes == null || fileBytes.length == 0) return false;

            String mime = item.mimeType != null ? item.mimeType : (item.isVideo ? "video/mp4" : "image/jpeg");
            RequestBody fileBody = RequestBody.create(fileBytes, MediaType.parse(mime));

            MultipartBody.Builder builder = new MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart("files", item.displayName != null ? item.displayName : "media.jpg", fileBody);

            if (hasGps) {
                builder.addFormDataPart("latitude", String.valueOf(latLong[0]));
                builder.addFormDataPart("longitude", String.valueOf(latLong[1]));
            }

            MultipartBody requestBody = builder.build();

            String uploadEndpoint = serverUrl.replaceAll("/+$", "") + "/api/media/upload";

            Request request = new Request.Builder()
                    .url(uploadEndpoint)
                    .addHeader("Authorization", "Bearer " + token)
                    .post(requestBody)
                    .build();

            try (Response response = httpClient.newCall(request).execute()) {
                if (response.isSuccessful()) {
                    return true;
                } else {
                    String body = response.body() != null ? response.body().string() : "";
                    Log.w(TAG, "Server upload returned error " + response.code() + ": " + body);
                    return false;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to upload " + item.displayName + ": " + e.getMessage());
            return false;
        }
    }

    /**
     * Deletes media file from device storage via direct filesystem deletion,
     * ContentResolver MediaStore deletion, and MediaScanner update.
     */
    public boolean deleteLocalMedia(LocalMediaItem item) {
        if (item == null) return false;
        boolean deleted = false;

        // 1. Direct filesystem deletion if path is known
        if (item.filePath != null && !item.filePath.isEmpty()) {
            try {
                java.io.File file = new java.io.File(item.filePath);
                if (file.exists()) {
                    deleted = file.delete();
                    if (deleted) {
                        Log.d(TAG, "Deleted local file via File.delete: " + item.filePath);
                    }
                } else {
                    deleted = true; // File already deleted
                }
            } catch (Exception e) {
                Log.w(TAG, "File.delete error: " + e.getMessage());
            }
        }

        // 2. ContentResolver delete
        if (item.uri != null) {
            try {
                int rows = context.getContentResolver().delete(item.uri, null, null);
                if (rows > 0) {
                    deleted = true;
                    Log.d(TAG, "Deleted local file via ContentResolver: " + item.uri);
                }
            } catch (Exception e) {
                Log.w(TAG, "ContentResolver.delete error: " + e.getMessage());
            }
        }

        // 3. Trigger MediaScanner to update system gallery
        if (item.filePath != null && !item.filePath.isEmpty()) {
            try {
                android.media.MediaScannerConnection.scanFile(
                        context,
                        new String[]{ item.filePath },
                        null,
                        null
                );
            } catch (Exception ignored) {}
        }

        return deleted;
    }

    public boolean deleteLocalMedia(Uri uri) {
        try {
            int rows = context.getContentResolver().delete(uri, null, null);
            return rows > 0;
        } catch (Exception e) {
            Log.w(TAG, "Cannot delete local file directly: " + e.getMessage());
            return false;
        }
    }

    private byte[] toByteArray(InputStream in) throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        int nRead;
        byte[] data = new byte[16384];
        while ((nRead = in.read(data, 0, data.length)) != -1) {
            buffer.write(data, 0, nRead);
        }
        buffer.flush();
        return buffer.toByteArray();
    }

    public android.location.Location getLastKnownLocation() {
        try {
            android.location.LocationManager lm = (android.location.LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return null;

            if (androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED
                    && androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_COARSE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                return null;
            }

            android.location.Location bestLoc = null;
            java.util.List<String> providers = lm.getProviders(true);
            for (String provider : providers) {
                android.location.Location loc = lm.getLastKnownLocation(provider);
                if (loc == null) continue;
                if (bestLoc == null || loc.getAccuracy() < bestLoc.getAccuracy()) {
                    bestLoc = loc;
                }
            }
            return bestLoc;
        } catch (Exception e) {
            Log.w(TAG, "Could not get device location: " + e.getMessage());
            return null;
        }
    }
}
