package com.prism.musepair;
import android.app.Activity;
import android.os.*;
import android.bluetooth.*;
import android.bluetooth.le.*;
import android.util.Log;
import android.widget.TextView;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;
import java.net.*;
import java.io.*;

public class PairActivity extends Activity {
 static final String TAG="MusePair", BASE="http://127.0.0.1:18788";
 static final UUID SERVICE=UUID.fromString("7fdd3d1c-38ea-46cf-8b46-314ecf5f240c"),RX=UUID.fromString("4d593029-28a2-4a6e-a1f0-3c2d5e8f9b01"),TX=UUID.fromString("d75dc4ca-7b2b-4e9c-8f0a-1d2e3f4a5b6c"),CCC=UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
 BluetoothAdapter adapter; BluetoothLeAdvertiser advertiser; BluetoothGattServer server; BluetoothGattCharacteristic tx;
 volatile BluetoothDevice client; volatile boolean active=true, subscribed=false, pairedDone=false; TextView label;
 final ExecutorService work=Executors.newSingleThreadExecutor(); final Semaphore ack=new Semaphore(0);
 String gadgetName="MuseGadgetA17C09";
 void status(String s){Log.i(TAG,s);runOnUiThread(()->label.setText("MUSE 蓝牙配对\n\n"+gadgetName+"\n\n"+s+"\n\n手机 Muse → Developer mode → Add Device"));}
 JSONObject http(String path,JSONObject data)throws Exception {
  HttpURLConnection c=(HttpURLConnection)new URL(BASE+path).openConnection();c.setConnectTimeout(3000);c.setReadTimeout(3000);
  try{if(data!=null){c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream o=c.getOutputStream()){o.write(data.toString().getBytes("UTF-8"));}}
   try(InputStream i=c.getInputStream()){ByteArrayOutputStream b=new ByteArrayOutputStream();byte[] p=new byte[4096];int n;while((n=i.read(p))!=-1)b.write(p,0,n);return new JSONObject(b.toString("UTF-8"));}
  }finally{c.disconnect();}
 }
 @Override public void onCreate(Bundle b){super.onCreate(b);label=new TextView(this);label.setTextColor(0xff00ff44);label.setBackgroundColor(0xff000000);label.setTextSize(18);label.setPadding(16,16,16,16);setContentView(label);getWindow().addFlags(128);
  try{if(getIntent().getStringExtra("restore_name")==null){CredentialStore credentials=new CredentialStore(this);credentials.importPending();if(credentials.load()!=null){startForegroundService(new android.content.Intent(this,MuseService.class));label.setText("MUSE 眼镜独立服务已启动\n\n无需 Mac 或 USB\n请打开 Muse AIUI 会话页");return;}}
   adapter=((BluetoothManager)getSystemService(BLUETOOTH_SERVICE)).getAdapter();status("广播能力："+adapter.isMultipleAdvertisementSupported()+" · 蓝牙："+adapter.isEnabled());
   advertiser=adapter.getBluetoothLeAdvertiser();if(advertiser==null)throw new Exception("硬件未提供 BLE 广播器");
   String restoreName=getIntent().getStringExtra("restore_name");
   if(restoreName!=null){boolean ok=adapter.setName(restoreName);status("蓝牙名称恢复："+restoreName+" · "+ok);finish();return;}
   // Never overwrite the system Bluetooth name during normal demo startup.

   server=((BluetoothManager)getSystemService(BLUETOOTH_SERVICE)).openGattServer(this,callback);
   BluetoothGattService svc=new BluetoothGattService(SERVICE,BluetoothGattService.SERVICE_TYPE_PRIMARY);
   BluetoothGattCharacteristic rx=new BluetoothGattCharacteristic(RX,12,BluetoothGattCharacteristic.PERMISSION_WRITE);
   tx=new BluetoothGattCharacteristic(TX,18,BluetoothGattCharacteristic.PERMISSION_READ);
   tx.addDescriptor(new BluetoothGattDescriptor(CCC,BluetoothGattDescriptor.PERMISSION_READ|BluetoothGattDescriptor.PERMISSION_WRITE));svc.addCharacteristic(rx);svc.addCharacteristic(tx);server.addService(svc);
   new Thread(this::poll,"MuseNotifications").start();new Handler(Looper.getMainLooper()).postDelayed(()->{if(active&&!subscribed&&!pairedDone){advertiser.stopAdvertising(adv);status("配对窗口已关闭，请重新打开应用");}},600000);
  }catch(Exception e){status("启动失败："+e.getMessage());}
 }
 final AdvertiseCallback adv=new AdvertiseCallback(){public void onStartSuccess(AdvertiseSettings s){status("ADVERTISING · 等待手机连接");}public void onStartFailure(int c){status("广播失败代码："+c);}};
 final BluetoothGattServerCallback callback=new BluetoothGattServerCallback(){
  public void onServiceAdded(int result,BluetoothGattService s){if(result!=0){status("GATT 服务失败："+result);return;}
   try{if(http("/health",null).optBoolean("paired")){pairedDone=true;status("PAIRED · 已通过官方 Muse 配对");return;}}catch(Exception e){status("请先启动 USB 配对桥接");return;}
   AdvertiseData data=new AdvertiseData.Builder().addServiceUuid(new ParcelUuid(SERVICE)).addManufacturerData(65535,new byte[]{0}).build();
   AdvertiseData scan=new AdvertiseData.Builder().setIncludeDeviceName(true).build();
   advertiser.startAdvertising(new AdvertiseSettings.Builder().setAdvertiseMode(2).setConnectable(true).setTimeout(0).build(),data,scan,adv);
  }
  public void onConnectionStateChange(BluetoothDevice d,int result,int state){Log.i(TAG,"GATT_CONNECTION state="+state);if(state!=2&&d.equals(client)){client=null;subscribed=false;if(!pairedDone)status("PHONE_DISCONNECTED");work.execute(()->{try{http("/session",new JSONObject().put("connected",false));}catch(Exception e){status("桥接连接失败");}});}}
  public void onMtuChanged(BluetoothDevice d,int mtu){Log.i(TAG,"MTU="+mtu);work.execute(()->{try{http("/mtu",new JSONObject().put("mtu",mtu));}catch(Exception e){Log.e(TAG,"mtu bridge failed");}});}
  public void onCharacteristicWriteRequest(BluetoothDevice d,int id,BluetoothGattCharacteristic ch,boolean prepared,boolean response,int offset,byte[] value){
   boolean valid=ch.getUuid().equals(RX)&&!prepared&&offset==0;if(response)server.sendResponse(d,id,valid?0:7,offset,null);if(!valid)return;
   client=d;final byte[] copied=value.clone();work.execute(()->{try{JSONArray a=new JSONArray();for(byte v:copied)a.put(v&255);JSONObject r=http("/write",new JSONObject().put("packet",a));if(r.has("status"))status(r.getString("status"));}catch(Exception e){status("协议桥接失败："+e.getClass().getSimpleName());}});
  }
  public void onDescriptorWriteRequest(BluetoothDevice d,int id,BluetoothGattDescriptor desc,boolean prepared,boolean response,int offset,byte[] value){boolean valid=desc.getUuid().equals(CCC)&&!prepared&&offset==0;if(valid)client=d;subscribed=valid&&Arrays.equals(value,BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);if(response)server.sendResponse(d,id,valid?0:7,offset,null);Log.i(TAG,"NOTIFY_SUBSCRIBED="+subscribed);}
  public void onDescriptorReadRequest(BluetoothDevice d,int id,int offset,BluetoothGattDescriptor desc){server.sendResponse(d,id,0,offset,subscribed?BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE:BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE);}
  public void onCharacteristicReadRequest(BluetoothDevice d,int id,int offset,BluetoothGattCharacteristic ch){server.sendResponse(d,id,0,offset,new byte[0]);}
  public void onNotificationSent(BluetoothDevice d,int result){if(result!=0)Log.w(TAG,"notify result="+result);ack.release();}
 };
 void poll(){while(active){try{if(client!=null&&subscribed){JSONObject r=http("/poll",null);JSONArray packets=r.getJSONArray("packets");for(int i=0;i<packets.length();i++){JSONArray a=packets.getJSONArray(i);byte[] p=new byte[a.length()];for(int j=0;j<p.length;j++)p[j]=(byte)a.getInt(j);ack.drainPermits();tx.setValue(p);if(!server.notifyCharacteristicChanged(client,tx,false))throw new Exception("notify rejected");if(!ack.tryAcquire(2,TimeUnit.SECONDS))throw new Exception("notify timeout");Thread.sleep(30);}if(r.optBoolean("disconnect"))server.cancelConnection(client);String s=r.optString("status");if(!s.isEmpty())status(s);if(r.optBoolean("complete")&&!pairedDone){pairedDone=true;advertiser.stopAdvertising(adv);status("PAIRED · Muse 账号配对成功");}}Thread.sleep(100);}catch(Exception e){Log.w(TAG,"poll "+e.getClass().getSimpleName());try{Thread.sleep(500);}catch(Exception ignored){}}}}
 @Override public void onDestroy(){active=false;work.shutdownNow();try{if(advertiser!=null)advertiser.stopAdvertising(adv);if(server!=null)server.close();}catch(Exception ignored){}super.onDestroy();}
}
