package com.photovault.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.util.List;

/**
 * Native Android JobService that runs automatically in the background
 * even when the NayBinho Photos app is closed.
 * It is invoked periodically (every 15 min) or immediately when new photos/videos
 * are detected in the device's MediaStore.
 */
public class BackupJobService extends JobService {

    private static final String TAG = "BackupJobService";
    private static final String CHANNEL_ID = "naybinho_backup_channel";
    private static final int NOTIFICATION_ID = 4040;

    private Thread workerThread;

    @Override
    public boolean onStartJob(JobParameters params) {
        Log.d(TAG, "onStartJob triggered (jobId=" + params.getJobId() + ")");

        SharedPreferences mainPrefs = getSharedPreferences("photovault_prefs", Context.MODE_PRIVATE);
        String serverUrl = mainPrefs.getString("server_url", "");
        String token = mainPrefs.getString("auth_token", "");

        AutoBackupManager manager = AutoBackupManager.getInstance(this);

        if (!manager.isAutoBackupEnabled() || serverUrl.isEmpty() || token.isEmpty()) {
            Log.d(TAG, "Auto backup disabled or no server credentials. Stopping job.");
            jobFinished(params, false);
            return false;
        }

        if (manager.isRunning()) {
            Log.d(TAG, "AutoBackupManager already running. Skipping job run.");
            jobFinished(params, false);
            return false;
        }

        workerThread = new Thread(() -> {
            try {
                List<AutoBackupManager.LocalMediaItem> pending = manager.scanLocalMedia(false);
                if (pending != null && !pending.isEmpty()) {
                    Log.d(TAG, "Background backup starting for " + pending.size() + " items while app is closed.");
                    showNotification(pending.size(), 0);

                    manager.setProgressCallback(new AutoBackupManager.BackupProgressCallback() {
                        @Override
                        public void onProgress(int current, int total, String filename) {
                            showNotification(total, current);
                        }

                        @Override
                        public void onCompleted(int uploaded, int failed, long freedBytes) {
                            hideNotification();
                        }

                        @Override
                        public void onError(String error) {
                            hideNotification();
                        }
                    });

                    boolean deleteAfter = manager.isDeleteAfterUploadEnabled();
                    manager.performBackupSync(serverUrl, token, deleteAfter);
                } else {
                    Log.d(TAG, "No pending items to backup.");
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in background backup job: " + e.getMessage(), e);
            } finally {
                hideNotification();
                // If content trigger job fired, re-register it for the next photo capture
                if (params.getJobId() == AutoBackupManager.JOB_ID_CONTENT_TRIGGER) {
                    AutoBackupManager.scheduleContentTriggerJob(getApplicationContext());
                }
                jobFinished(params, false);
            }
        });
        workerThread.start();
        return true; // Asynchronous work running
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        Log.d(TAG, "onStopJob called. Cancelling background backup.");
        AutoBackupManager.getInstance(this).stopBackup();
        if (workerThread != null) {
            workerThread.interrupt();
        }
        hideNotification();
        return true; // Reschedule if aborted
    }

    private void showNotification(int total, int current) {
        try {
            createNotificationChannel();

            Intent launchIntent = new Intent(this, MainActivity.class);
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                    this, 0, launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );

            String title = "NayBinho Photos — Backup";
            String content = (total > 0 && current > 0)
                    ? "Enviando fotos para o servidor (" + current + " de " + total + ")..."
                    : "Sincronizando novas fotos do dispositivo...";

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle(title)
                    .setContentText(content)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .setOngoing(true)
                    .setAutoCancel(false)
                    .setContentIntent(pendingIntent);

            if (total > 0) {
                builder.setProgress(total, current, false);
            } else {
                builder.setProgress(0, 0, true);
            }

            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(NOTIFICATION_ID, builder.build());
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not show notification: " + e.getMessage());
        }
    }

    private void hideNotification() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(NOTIFICATION_ID);
            }
        } catch (Exception ignored) {}
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "Backup em Segundo Plano",
                        NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("Notificações de sincronização de fotos em segundo plano");
                channel.setShowBadge(false);
                nm.createNotificationChannel(channel);
            }
        }
    }
}
