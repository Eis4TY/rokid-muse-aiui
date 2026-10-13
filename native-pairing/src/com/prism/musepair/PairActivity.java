package com.prism.musepair;
import android.app.Activity;
import android.content.Intent;
import android.os.*;
import android.bluetooth.*;
import android.bluetooth.le.*;
import android.util.Log;
import android.widget.*;
import android.view.KeyEvent;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;
import java.io.*;

public class PairActivity extends Activity {
 static final String TAG="MusePair";
 static final UUID SERVICE=UUID.fromString("7fdd3d1c-38ea-46cf-8b46-314ecf5f240c"),RX=UUID.fromString("4d593029-28a2-4a6e-a1f0-3c2d5e8f9b01"),TX=UUID.fromString("d75dc4ca-7b2b-4e9c-8f0a-1d2e3f4a5b6c"),CCC=UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
 BluetoothAdapter adapter;BluetoothLeAdvertiser advertiser;BluetoothGattServer server;BluetoothGattCharacteristic tx;
 volatile BluetoothDevice client;volatile boolean active=true,subscribed=false,pairedDone=false;TextView label;
 final ExecutorService work=Executors.newSingleThreadExecutor();final Semaphore ack=new Semaphore(0);final PairProtocol pairing=new PairProtocol();
 boolean namePending;final Handler naming=new Handler(Looper.getMainLooper());
 ByteArrayOutputStream buffer=new ByteArrayOutputStream();int total,next,mtu=23;boolean blocked;String sdkToken;
 void status(String s){Log.i(TAG,"UI_STATUS "+(pairedDone?"credentials_received":s));runOnUiThread(()->label.setText("MUSE 本机蓝牙配对\n\n"+s));}
 @Override public void onCreate(Bundle b){super.onCreate(b);label=new TextView(this);label.setTextColor(0xff00ff44);label.setBackgroundColor(0xff000000);label.setTextSize(18);label.setPadding(16,16,16,16);setContentView(label);getWindow().addFlags(128);
  try{DeviceIdentity.init(this);File file=new File(getFilesDir(),"sdk-token");try(FileInputStream in=new FileInputStream(file)){sdkToken=new String(CredentialStore.read(in),"UTF-8").trim();}if(sdkToken.isEmpty())throw new Exception("缺少 SDK token");
   startForegroundService(new Intent(this,MuseService.class));if(getIntent().getBooleanExtra("binding_only",false)){label.setText("MUSE 自动授权交接\n\n正在绑定 AIUI\n已保存的手机配对授权会自动交接");return;}adapter=((BluetoothManager)getSystemService(BLUETOOTH_SERVICE)).getAdapter();advertiser=adapter.getBluetoothLeAdvertiser();if(advertiser==null)throw new Exception("BLE 广播器不可用");
   server=((BluetoothManager)getSystemService(BLUETOOTH_SERVICE)).openGattServer(this,callback);if(server==null)throw new Exception("GATT server 不可用");BluetoothGattService svc=new BluetoothGattService(SERVICE,0);BluetoothGattCharacteristic rx=new BluetoothGattCharacteristic(RX,12,BluetoothGattCharacteristic.PERMISSION_WRITE);tx=new BluetoothGattCharacteristic(TX,18,BluetoothGattCharacteristic.PERMISSION_READ);tx.addDescriptor(new BluetoothGattDescriptor(CCC,17));svc.addCharacteristic(rx);svc.addCharacteristic(tx);server.addService(svc);
   new Handler(Looper.getMainLooper()).postDelayed(()->{if(active&&!pairedDone){advertiser.stopAdvertising(adv);status("配对窗口已关闭，请重新打开组件");}},600000);
  }catch(Exception e){status("启动失败："+e.getClass().getSimpleName());}
 }
 void restoreName(){if(adapter==null)return;adapter.setName(DeviceIdentity.originalName);namePending=false;naming.postDelayed(()->{Log.i(TAG,"SYSTEM_NAME_AFTER_RESTORE="+adapter.getName());if(!DeviceIdentity.originalName.equals(adapter.getName()))adapter.setName(DeviceIdentity.originalName);},300);}
 void startNamedBroadcast(int attempt){if(!active){restoreName();return;}if(!DeviceIdentity.bleName.equals(adapter.getName())){if(attempt<20){naming.postDelayed(()->startNamedBroadcast(attempt+1),100);return;}restoreName();status("Muse 广播名称准备失败");return;}AdvertiseData data=new AdvertiseData.Builder().addServiceUuid(new ParcelUuid(SERVICE)).addManufacturerData(65535,new byte[]{0}).build();AdvertiseData scan=new AdvertiseData.Builder().setIncludeDeviceName(true).build();advertiser.startAdvertising(new AdvertiseSettings.Builder().setAdvertiseMode(2).setConnectable(true).setTimeout(0).build(),data,scan,adv);}
 final AdvertiseCallback adv=new AdvertiseCallback(){public void onStartSuccess(AdvertiseSettings s){restoreName();status("等待手机 Muse 连接\n配对广播："+DeviceIdentity.bleName+"\n系统名恢复为 "+DeviceIdentity.originalName+"\n\nDeveloper mode → Add Device\n可暂时断开 Rokid 蓝牙后扫描");Log.i(TAG,"ADVERTISING_LOCAL_PROTOCOL");}public void onStartFailure(int c){restoreName();status("广播失败："+c);}};
 final BluetoothGattServerCallback callback=new BluetoothGattServerCallback(){
  public void onServiceAdded(int r,BluetoothGattService s){if(r!=0){status("GATT 失败："+r);return;}namePending=true;if(!adapter.setName(DeviceIdentity.bleName)){restoreName();status("无法生成 Muse 名称广播");return;}naming.postDelayed(()->startNamedBroadcast(0),100);naming.postDelayed(()->{if(namePending){advertiser.stopAdvertising(adv);restoreName();status("广播初始化超时，系统名已恢复");}},4000);}

  public void onConnectionStateChange(BluetoothDevice d,int r,int state){Log.i(TAG,"GATT_CONNECTION state="+state);if(state!=2&&d.equals(client)){client=null;subscribed=false;work.execute(()->{pairing.reset();buffer.reset();total=next=0;blocked=false;});}}
  public void onMtuChanged(BluetoothDevice d,int value){mtu=Math.max(23,Math.min(517,value));Log.i(TAG,"MTU="+mtu);}
  public void onCharacteristicWriteRequest(BluetoothDevice d,int id,BluetoothGattCharacteristic ch,boolean prep,boolean response,int offset,byte[] value){boolean valid=ch.getUuid().equals(RX)&&!prep&&offset==0&&(client==null||d.equals(client));if(response)server.sendResponse(d,id,valid?0:7,offset,null);if(!valid)return;client=d;byte[] packet=value.clone();work.execute(()->{try{receive(packet);}catch(Exception e){String error=e.getMessage();if(!"error_pairing_invalid_hello".equals(error))error="error_pairing_decrypt";try{sendRaw(error.getBytes("UTF-8"));}catch(Exception ignored){}pairing.reset();if(client!=null)server.cancelConnection(client);Log.w(TAG,"PAIRING_REJECTED "+error);}});}
  public void onDescriptorWriteRequest(BluetoothDevice d,int id,BluetoothGattDescriptor desc,boolean prep,boolean response,int offset,byte[] value){boolean valid=desc.getUuid().equals(CCC)&&!prep&&offset==0&&(client==null||d.equals(client));if(valid){client=d;subscribed=Arrays.equals(value,BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);}if(response)server.sendResponse(d,id,valid?0:7,offset,null);Log.i(TAG,"NOTIFY_SUBSCRIBED="+subscribed);}
  public void onDescriptorReadRequest(BluetoothDevice d,int id,int offset,BluetoothGattDescriptor desc){server.sendResponse(d,id,0,offset,subscribed?BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE:BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE);}
  public void onCharacteristicReadRequest(BluetoothDevice d,int id,int offset,BluetoothGattCharacteristic ch){server.sendResponse(d,id,0,offset,new byte[0]);}
  public void onNotificationSent(BluetoothDevice d,int result){if(result==0)ack.release();else Log.w(TAG,"NOTIFY_FAILED "+result);}
 };
 void receive(byte[] p)throws Exception{if(p.length>=3&&(p[0]&255)==254){int index=p[1]&255,count=p[2]&255;if(count==0){buffer.reset();total=next=0;return;}if(index==0||count!=total){buffer.reset();total=count;next=0;}if(index!=next||index>=total||buffer.size()+p.length-3>8192){buffer.reset();total=next=0;return;}buffer.write(p,3,p.length-3);next++;if(next<total)return;p=buffer.toByteArray();buffer.reset();total=next=0;}if(p.length>8192)throw new Exception();dispatch(new JSONObject(new String(p,"UTF-8")),false);}
 void dispatch(JSONObject c,boolean encrypted)throws Exception{String action=c.optString("action");Log.i(TAG,"RX_ACTION "+(Arrays.asList("get_device_info","pairing_client_hello","pairing_encrypted","pairing_client_finished","wifi_scan","provision_v2").contains(action)?action:"unknown"));
  if(!encrypted&&action.equals("pairing_client_hello")){send(pairing.hello(c));blocked=true;}
  else if(!encrypted&&action.equals("pairing_encrypted"))dispatch(pairing.decrypt(c),true);
  else if(action.equals("get_device_info"))send(pairing.info(true));
  else if(!encrypted){if(!blocked)sendRaw("error_encryption_required".getBytes("UTF-8"));}
  else if(action.equals("pairing_client_finished")){pairing.finished(c);sendStatus("pairing_confirmed");}
  else if(pairing.state!=2){sendStatus("error_pairing_confirm_required");}
  else if(action.equals("wifi_scan")){send(pairing.encrypt(new JSONObject().put("type","wifi_scan_result").put("networks",new JSONArray().put(new JSONObject().put("ssid","Use current connection").put("rssi",-40).put("secure",false)))));}
  else if(action.equals("provision_v2"))provision(c);
  else sendStatus("error_unknown_action");
 }
 void provision(JSONObject c)throws Exception{
  if(!(c.opt("ssid") instanceof String)||!(c.opt("password") instanceof String)||c.optString("access_token").isEmpty()||c.optString("refresh_token").isEmpty()||!c.optString("token_type").equals("device")){sendStatus("error_missing_credentials");return;}
  long g=pairing.provisioning();sendStatus("wifi_connecting");sendStatus("wifi_connected");
  JSONObject record=new JSONObject();for(String k:new String[]{"access_token","refresh_token","username","api_url_v2","noise_host"})record.put(k,c.optString(k));record.put("device_id",PairProtocol.NODE).put("display_name",DeviceIdentity.originalName).put("token_type","device").put("access_token_saved_at",System.currentTimeMillis()/1000).put("expires_in",14400);
  String code; synchronized(pairing){if(!pairing.current(g))return;if(MuseService.handoff==null)throw new Exception();code=MuseService.handoff.offer(record);}
  // Received from the authenticated-encryption setup session. AIUI performs
  // the cloud /fetch_vms validation before saving its copy; no native VM loop.
  sendStatus("auth_ok");pairedDone=true;advertiser.stopAdvertising(adv);status(MuseService.handoff.binding!=null?"手机授权已收到\n\n已绑定 AIUI 自动接收\n请打开 Muse AIUI 独立版\n授权将自动验证并保存":"手机授权已收到\n\n尚未建立 AIUI 自动交接绑定\n请连接电脑运行 setup --rebind\n无需输入交接码");Log.i(TAG,"PAIRING_CREDENTIALS_RECEIVED");
 }
 void sendStatus(String status)throws Exception{JSONObject obj=new JSONObject().put("type","status").put("status",status);if(status.equals("pairing_confirmed"))obj.put("sdk_token",sdkToken);send(pairing.encrypt(obj));}
 void send(JSONObject obj)throws Exception{byte[] bytes=obj.toString().getBytes("UTF-8");int size=Math.min(mtu-3,160)-3,count=Math.max(1,(bytes.length+size-1)/size);if(count>255)throw new Exception();for(int i=0;i<count;i++){int n=Math.min(size,bytes.length-i*size);byte[] p=new byte[n+3];p[0]=(byte)254;p[1]=(byte)i;p[2]=(byte)count;System.arraycopy(bytes,i*size,p,3,n);sendRaw(p);Thread.sleep(30);}}
 void sendRaw(byte[] packet)throws Exception{if(client==null||!subscribed)throw new Exception();ack.drainPermits();tx.setValue(packet);if(!server.notifyCharacteristicChanged(client,tx,false)||!ack.tryAcquire(2,TimeUnit.SECONDS))throw new Exception();}
 @Override public void onDestroy(){active=false;if(namePending)restoreName();work.shutdownNow();pairing.reset();try{if(advertiser!=null)advertiser.stopAdvertising(adv);if(server!=null)server.close();}catch(Exception ignored){}super.onDestroy();}
}
