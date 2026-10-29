package com.guionflow.tablet;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

public class GuionFlowApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(PrompterService.CHANNEL, "Teleprompter", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Controles del teleprompter flotante");
            ch.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }
}
