package com.photovault.app;

import android.app.Application;
import android.util.Log;

public class PhotoVaultApp extends Application {
    private static final String TAG = "PhotoVaultApp";

    @Override
    public void onCreate() {
        super.onCreate();

        // Global uncaught exception handler to prevent OS crash loops on Android 15
        final Thread.UncaughtExceptionHandler defaultHandler = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            Log.e(TAG, "Uncaught exception in thread [" + thread.getName() + "]: " + throwable.getMessage(), throwable);
            try {
                getSharedPreferences("photovault_crash", MODE_PRIVATE)
                        .edit()
                        .putString("last_crash_msg", String.valueOf(throwable.getMessage()))
                        .putString("last_crash_trace", Log.getStackTraceString(throwable))
                        .putLong("crash_time", System.currentTimeMillis())
                        .commit();
            } catch (Exception ignored) {}

            // Gracefully terminate this process cleanly
            android.os.Process.killProcess(android.os.Process.myPid());
            System.exit(1);
        });
    }
}
