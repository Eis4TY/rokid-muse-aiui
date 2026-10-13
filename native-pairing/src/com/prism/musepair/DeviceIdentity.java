package com.prism.musepair;
import android.content.Context;
import android.bluetooth.*;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.*;
import java.security.SecureRandom;
import java.util.Locale;

/** Device-local public identity. Never contains account credentials. */
final class DeviceIdentity {
 static String originalName,bleName;
 static boolean initialized;
 static synchronized void init(Context context)throws Exception {
  // Activity and foreground Service share one process. Only the first init
  // may restore a name left by a previous process; later init must not
  // undo the Activity's in-progress named advertising.
  if(initialized)return;
  AtomicFile file=new AtomicFile(new File(context.getFilesDir(),"identity.json"));JSONObject data;
  if(file.getBaseFile().exists())data=new JSONObject(new String(file.readFully(),"UTF-8"));
  else {
   BluetoothAdapter adapter=((BluetoothManager)context.getSystemService(Context.BLUETOOTH_SERVICE)).getAdapter();
   String original=adapter.getName();if(original==null||original.isEmpty()||original.startsWith("MuseGadget"))throw new IOException("original Bluetooth name unavailable");
   JSONObject previous=new CredentialStore(context).load();String node=previous==null?"":previous.optString("device_id");
   String mac;
   if(node.equals("homelink-a17c09"))mac="02:00:00:a1:7c:09";
   else if(!node.isEmpty())throw new IOException("unknown legacy identity; preserve before migration");
   else {byte[] bytes=new byte[6];new SecureRandom().nextBytes(bytes);bytes[0]=(byte)((bytes[0]|2)&254);StringBuilder value=new StringBuilder();for(byte b:bytes){if(value.length()>0)value.append(':');value.append(String.format(Locale.ROOT,"%02x",b&255));}mac=value.toString();node="homelink-"+mac.replace(":","");}
   data=new JSONObject().put("device_id",node).put("mac",mac).put("original_name",original);
   FileOutputStream out=null;try{out=file.startWrite();out.write(data.toString().getBytes("UTF-8"));file.finishWrite(out);}catch(Exception e){if(out!=null)file.failWrite(out);throw e;}
  }
  if(!data.getString("device_id").matches("homelink-[0-9a-f]{6,12}")||!data.getString("mac").matches("([0-9a-f]{2}:){5}[0-9a-f]{2}"))throw new IOException("invalid identity");
  PairProtocol.NODE=data.getString("device_id");PairProtocol.MAC=data.getString("mac");PairProtocol.DEVICE="hatch-link:"+PairProtocol.MAC;
  originalName=data.getString("original_name");BluetoothAdapter current=((BluetoothManager)context.getSystemService(Context.BLUETOOTH_SERVICE)).getAdapter();if(current.getName()!=null&&current.getName().startsWith("MuseGadget"))current.setName(originalName);bleName="MuseGadget"+PairProtocol.MAC.replace(":","").substring(6).toUpperCase(Locale.ROOT);
  initialized=true;
 }
}
