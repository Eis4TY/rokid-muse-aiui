package com.prism.musepair;
import android.app.*;
import android.content.*;
import android.os.*;
import android.util.Log;
import okhttp3.OkHttpClient;
import java.util.concurrent.TimeUnit;

public class MuseService extends Service {
 MuseCloud cloud;LocalApi api;PowerManager.WakeLock wake;
 @Override public void onCreate(){super.onCreate();String channel="muse-cloud";NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);manager.createNotificationChannel(new NotificationChannel(channel,"Muse 云端连接",NotificationManager.IMPORTANCE_LOW));PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,PairActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);startForeground(68,new Notification.Builder(this,channel).setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("Muse 眼镜服务").setContentText("眼镜独立连接 Muse").setContentIntent(open).build());
  try{CredentialStore store=new CredentialStore(this);store.importPending();cloud=new MuseCloud(store,new OkHttpClient.Builder().connectTimeout(15,TimeUnit.SECONDS).readTimeout(20,TimeUnit.SECONDS).writeTimeout(20,TimeUnit.SECONDS).pingInterval(20,TimeUnit.SECONDS).build());api=new LocalApi(cloud);api.start();wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Muse:Cloud");wake.acquire();cloud.start();Log.i("MuseCloud","Standalone service started on loopback:18787");}catch(Exception e){Log.e("MuseCloud","Service startup failed: "+e.getClass().getSimpleName());stopSelf();}
 }
 @Override public int onStartCommand(Intent intent,int flags,int startId){return START_STICKY;}
 @Override public IBinder onBind(Intent intent){return null;}
 @Override public void onDestroy(){if(api!=null)api.close();if(cloud!=null)cloud.close();if(wake!=null&&wake.isHeld())wake.release();super.onDestroy();}
}
