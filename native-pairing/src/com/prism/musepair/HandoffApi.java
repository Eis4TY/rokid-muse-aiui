package com.prism.musepair;
import java.net.*;
import java.io.*;
import java.security.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import java.util.concurrent.*;
import org.json.*;

final class HandoffApi implements AutoCloseable {
 final CredentialStore store;final byte[] binding;final java.util.Map<String,Long> challenges=new java.util.HashMap<>();final ServerSocket server;final ExecutorService clients=Executors.newFixedThreadPool(2);volatile boolean active=true;String code,id;long expires;int failures;boolean acknowledged;
 HandoffApi(CredentialStore store,byte[] binding)throws Exception{this.store=store;this.binding=binding;JSONObject existing=store.load();if(existing!=null){id=existing.optString("handoff_id");acknowledged=existing.optBoolean("handoff_delivered");}server=new ServerSocket();server.setReuseAddress(true);server.bind(new InetSocketAddress("127.0.0.1",18791),8);}
 synchronized String offer(JSONObject record)throws Exception{code=String.format(java.util.Locale.ROOT,"%06d",new SecureRandom().nextInt(1000000));id=PairProtocol.b64(Noise.key());record.put("handoff_id",id).put("handoff_delivered",false);store.save(record);expires=System.nanoTime()+300000000000L;failures=0;acknowledged=false;return code;}
 synchronized boolean ready(){return code!=null&&!acknowledged&&System.nanoTime()<expires&&failures<5;}
 synchronized JSONObject claim(String supplied)throws Exception{if(!ready())throw new Exception();if(!MessageDigest.isEqual(code.getBytes("UTF-8"),supplied.getBytes("UTF-8"))){failures++;throw new Exception();}return store.load();}
 synchronized boolean ack(String supplied)throws Exception{if(id==null||!id.equals(supplied))return false;store.save(new JSONObject().put("device_id",PairProtocol.NODE).put("handoff_id",id).put("handoff_delivered",true));acknowledged=true;code=null;return true;}
 synchronized boolean boundReady(){try{return binding!=null&&id!=null&&!id.isEmpty()&&!acknowledged&&store.load().has("access_token");}catch(Exception e){return false;}}
 synchronized JSONObject challenge()throws Exception{long now=System.nanoTime();challenges.entrySet().removeIf(e->e.getValue()<now);if(challenges.size()>=16)throw new Exception();String nonce=PairProtocol.b64(Noise.key());challenges.put(nonce,now+15000000000L);return new JSONObject().put("nonce",nonce);}
 synchronized void authenticate(JSONObject data,String action)throws Exception{if(binding==null)throw new Exception();String nonce=data.getString("nonce");Long expiry=challenges.remove(nonce);if(expiry==null||expiry<System.nanoTime())throw new Exception();String text="muse-aiui-"+action+"-v1|"+(action.equals("complete")?data.getString("handoff_id")+"|":"")+nonce;byte[] expected=Noise.hmac(binding,PairProtocol.bytes(text)),proof=PairProtocol.decode(data.getString("proof"),128);if(!MessageDigest.isEqual(expected,proof))throw new Exception();}
 synchronized JSONObject claimBound(JSONObject data)throws Exception{authenticate(data,"claim");if(!boundReady())throw new Exception();byte[] iv=new byte[12];new SecureRandom().nextBytes(iv);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(binding,"AES"),new GCMParameterSpec(128,iv));cipher.updateAAD(PairProtocol.bytes(data.getString("nonce")));byte[] encrypted=cipher.doFinal(PairProtocol.bytes(store.load().toString()));return new JSONObject().put("nonce",data.getString("nonce")).put("iv",PairProtocol.b64(iv)).put("ciphertext",PairProtocol.b64(encrypted));}
 void start(){new Thread(()->{while(active){try{Socket s=server.accept();clients.execute(()->handle(s));}catch(Exception e){if(active)break;}}},"MuseHandoff").start();}
 void handle(Socket socket){try(Socket s=socket){s.setSoTimeout(4000);InputStream in=new BufferedInputStream(s.getInputStream());String[] request=LocalApi.line(in).split(" ");if(request.length!=3)return;int length=0,total=0;while(true){String h=LocalApi.line(in);if(h.isEmpty())break;total+=h.length();if(total>8192)return;String lower=h.toLowerCase(java.util.Locale.ROOT);if(lower.startsWith("transfer-encoding:"))return;if(lower.startsWith("content-length:"))length=Integer.parseInt(h.substring(15).trim());}if(length<0||length>1024)return;byte[] body=new byte[length];int n=0;while(n<length){int r=in.read(body,n,length-n);if(r<0)return;n+=r;}
  int status=200;JSONObject result;
  if(request[0].equals("OPTIONS")){status=204;result=new JSONObject();}
  else if(request[0].equals("GET")&&request[1].equals("/status")){result=new JSONObject().put("device_id",PairProtocol.NODE).put("ble_name",DeviceIdentity.bleName).put("original_name",DeviceIdentity.originalName).put("native_pairing",true).put("handoff_ready",binding!=null?boundReady():ready()).put("binding_ready",binding!=null).put("delivered",acknowledged);}
  else if(request[0].equals("GET")&&request[1].equals("/challenge")){try{result=challenge();}catch(Exception e){status=429;result=new JSONObject();}}
  else if(request[0].equals("POST")&&request[1].equals("/claim-bound")){try{result=claimBound(new JSONObject(new String(body,"UTF-8")));}catch(Exception e){status=403;result=new JSONObject();}}
  else if(request[0].equals("POST")&&request[1].equals("/complete-bound")){try{JSONObject data=new JSONObject(new String(body,"UTF-8"));authenticate(data,"complete");boolean ok=ack(data.getString("handoff_id"));status=ok?200:403;result=new JSONObject().put("saved",ok);}catch(Exception e){status=403;result=new JSONObject();}}
  else if(request[0].equals("POST")&&request[1].equals("/claim")){try{if(binding!=null)throw new Exception();result=claim(new JSONObject(new String(body,"UTF-8")).optString("code"));}catch(Exception e){status=403;result=new JSONObject().put("error","交接码无效、已过期或尝试次数过多");}}
  else if(request[0].equals("POST")&&request[1].equals("/complete")){boolean ok=binding==null&&ack(new JSONObject(new String(body,"UTF-8")).optString("handoff_id"));status=ok?200:403;result=new JSONObject().put("saved",ok);}
  else{status=404;result=new JSONObject();}LocalApi.reply(s,status,result);
 }catch(Exception ignored){}}
 public void close(){active=false;code=null;try{server.close();}catch(Exception ignored){}clients.shutdownNow();}
}
