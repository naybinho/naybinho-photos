package com.photovault.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Automatically re-schedules background backup tasks whenever the device restarts
 * or when the app is updated.
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            if (intent == null) return;
            String action = intent.getAction();
            Log.d(TAG, "onReceive action: " + action);

            if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
                Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
                AutoBackupManager manager = AutoBackupManager.getInstance(context);
                if (manager.isAutoBackupEnabled()) {
                    AutoBackupManager.scheduleAllBackgroundJobs(context);
                }
            }
        } catch (Throwable t) {
            Log.e(TAG, "Error in BootReceiver: " + t.getMessage(), t);
        }
    }
}
