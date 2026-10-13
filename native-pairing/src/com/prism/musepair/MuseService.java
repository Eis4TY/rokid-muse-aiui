package com.prism.musepair;
import android.app.*;
import android.os.*;
import android.content.*;
import android.util.Log;

public class MuseService extends Service {
 static volatile HandoffApi handoff;
 @Override public void onCreate(){super.onCreate();String channel="muse-pairing";NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);manager.createNotificationChannel(new NotificationChannel(channel,"Muse 配对授权交接",NotificationManager.IMPORTANCE_LOW));PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,PairActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);startForeground(68,new Notification.Builder(this,channel).setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("Muse 配对组件").setContentText("向 AIUI 交接新授权").setContentIntent(open).build());try{DeviceIdentity.init(this);handoff=new HandoffApi(new CredentialStore(this),loadBinding());handoff.start();Log.i("MusePair","HANDOFF_READY loopback:18791");}catch(Exception e){Log.e("MusePair","HANDOFF_START_FAILED "+e.getClass().getSimpleName());stopSelf();}}
 byte[] loadBinding()throws Exception{CredentialStore encrypted=new CredentialStore(this,"muse-binding.enc");java.io.File pending=new java.io.File(getFilesDir(),"binding-import.json");if(pending.exists()){org.json.JSONObject data;try(java.io.FileInputStream in=new java.io.FileInputStream(pending)){data=new org.json.JSONObject(new String(CredentialStore.read(in),"UTF-8"));}if(!PairProtocol.NODE.equals(data.getString("device_id")))throw new Exception();byte[] key=PairProtocol.decode(data.getString("binding_key"),128);if(key.length!=32)throw new Exception();encrypted.save(data);if(!pending.delete())throw new Exception();}org.json.JSONObject saved=encrypted.load();if(saved==null)return null;if(!PairProtocol.NODE.equals(saved.getString("device_id")))throw new Exception();byte[] key=PairProtocol.decode(saved.getString("binding_key"),128);if(key.length!=32)throw new Exception();return key;}
 @Override public int onStartCommand(Intent i,int flags,int id){return START_NOT_STICKY;}
 @Override public IBinder onBind(Intent i){return null;}
 @Override public void onDestroy(){if(handoff!=null){handoff.close();handoff=null;}super.onDestroy();}
}
