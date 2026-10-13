// Copyright (c) Meta Platforms, Inc. and affiliates.
// Apache-2.0. Java port of musegadget/pairing.py, BLE v5 community mode.
package com.prism.musepair;
import org.json.*;
import java.util.*;
import java.security.*;
import java.nio.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.bouncycastle.crypto.generators.ECKeyPairGenerator;
import org.bouncycastle.crypto.params.*;
import org.bouncycastle.crypto.AsymmetricCipherKeyPair;
import org.bouncycastle.crypto.agreement.ECDHBasicAgreement;
import org.bouncycastle.asn1.sec.SECNamedCurves;
import org.bouncycastle.asn1.x9.X9ECParameters;

final class PairProtocol {
 static String NODE="homelink-a17c09",MAC="02:00:00:a1:7c:09",DEVICE="hatch-link:"+MAC;
 static final String VERSION="0.2.0",LABEL="hatch-link ble setup v1";
 static final X9ECParameters CURVE=SECNamedCurves.getByName("secp256r1");
 static final ECDomainParameters DOMAIN=new ECDomainParameters(CURVE.getCurve(),CURVE.getG(),CURVE.getN(),CURVE.getH());
 String session;byte[] rx,tx;long received,sent,deadline,generation;int state;
 synchronized void reset(){if(rx!=null)Arrays.fill(rx,(byte)0);if(tx!=null)Arrays.fill(tx,(byte)0);rx=tx=null;session=null;received=sent=0;state=0;generation++;}
 static String b64(byte[] b){return Base64.getUrlEncoder().withoutPadding().encodeToString(b);}
 static byte[] decode(String s,int max)throws Exception{if(s.length()==0||s.length()>max||s.length()%4==1||!s.matches("[A-Za-z0-9_-]+"))throw new Exception("invalid base64");return Base64.getUrlDecoder().decode(s);}
 static byte[] bytes(String s)throws Exception{return s.getBytes("UTF-8");}
 static byte[] expand(byte[] key,String info)throws Exception{return Arrays.copyOf(Noise.hmac(key,Noise.concat(bytes(info),new byte[]{1})),32);}
 boolean alive(){if(state!=0&&System.nanoTime()>deadline){reset();return false;}return state!=0;}
 synchronized JSONObject info(boolean online)throws Exception{return new JSONObject().put("type","device_info").put("node_id",NODE).put("version",VERSION).put("device_id",DEVICE).put("mac",MAC).put("model","hatch_link").put("pairing_protocol",5).put("pairing_auth","none").put("pairing_auth_epoch",0).put("pairing_policy","confirm_app").put("build_sha","").put("network_ready",online);}
 synchronized JSONObject hello(JSONObject message)throws Exception{
  reset();try{
   if(!(message.opt("version") instanceof Number)||message.getDouble("version")!=5||!message.optString("pairing_auth").equals("none")||!message.optString("pairing_policy").equals("confirm_app"))throw new Exception();
   byte[] mobile=decode(message.getString("mobile_pub"),4096),mn=decode(message.getString("mobile_nonce"),4096);if(mobile.length!=65||mobile[0]!=4||mn.length!=16)throw new Exception();
   ECPublicKeyParameters peer=new ECPublicKeyParameters(CURVE.getCurve().decodePoint(mobile),DOMAIN);
   ECKeyPairGenerator generator=new ECKeyPairGenerator();generator.init(new ECKeyGenerationParameters(DOMAIN,new SecureRandom()));AsymmetricCipherKeyPair kp=generator.generateKeyPair();
   byte[] dp=((ECPublicKeyParameters)kp.getPublic()).getQ().getEncoded(false),dn=new byte[16];new SecureRandom().nextBytes(dn);
   String transcript="hatch-link-pairing-v5\nversion=5\ninitiator_role=mobile\nresponder_role=link\ndevice_id="+DEVICE+"\nnode_id="+NODE+"\nmac="+MAC+"\nmodel=hatch_link\nfirmware_version="+VERSION+"\nselected_cipher_suite=p256-hkdf-sha256-aes-gcm-v1\npairing_auth=none\npairing_auth_epoch=0\npairing_policy=confirm_app\nconfirm_timeout_seconds=0\nmobile_pub="+b64(mobile)+"\ndevice_pub="+b64(dp)+"\nmobile_nonce="+b64(mn)+"\ndevice_nonce="+b64(dn);
   byte[] th=Noise.hash(bytes(transcript));ECDHBasicAgreement agreement=new ECDHBasicAgreement();agreement.init(kp.getPrivate());byte[] raw=agreement.calculateAgreement(peer).toByteArray(),shared=new byte[32];System.arraycopy(raw,Math.max(0,raw.length-32),shared,Math.max(0,32-raw.length),Math.min(32,raw.length));
   byte[] salt=Noise.hash(Noise.concat(mn,dn,th)),secret=expand(Noise.hmac(salt,shared),LABEL);rx=expand(secret,"mobile->device");tx=expand(secret,"device->mobile");session=b64(Arrays.copyOf(Noise.hash(Noise.concat(bytes("hatch-link session id v1"),th,shared)),16));Arrays.fill(shared,(byte)0);Arrays.fill(secret,(byte)0);
   state=1;deadline=System.nanoTime()+60000000000L;
   return ready(dp,dn,th);
  }catch(Exception e){reset();throw new Exception("error_pairing_invalid_hello");}
 }
 JSONObject ready(byte[] dp,byte[] dn,byte[] th)throws Exception{return new JSONObject().put("type","pairing_ready").put("version",5).put("device_id",DEVICE).put("node_id",NODE).put("mac",MAC).put("model","hatch_link").put("firmware_version",VERSION).put("pairing_auth","none").put("pairing_auth_epoch",0).put("pairing_policy","confirm_app").put("device_pub",b64(dp)).put("device_nonce",b64(dn)).put("transcript_hash",b64(th)).put("session_id",session);}
 static byte[] nonce(int direction,long counter){return ByteBuffer.allocate(12).put(new byte[]{(byte)direction,0,0,0}).putLong(counter).array();}
 static byte[] crypt(boolean enc,byte[] key,int direction,String session,long counter,byte[] data)throws Exception{Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(enc?Cipher.ENCRYPT_MODE:Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,nonce(direction,counter)));c.updateAAD(bytes(LABEL+"|"+session+"|"+(direction==0?"m2d":"d2m")+"|"+Long.toUnsignedString(counter)));return c.doFinal(data);}
 synchronized JSONObject decrypt(JSONObject envelope)throws Exception{try{if(!alive()||!envelope.getString("session_id").equals(session))throw new Exception();Object counter=envelope.opt("counter");if(!(counter instanceof String)||!((String)counter).matches("[0-9]+"))throw new Exception();long n=Long.parseUnsignedLong((String)counter);if(n!=received||received==-1)throw new Exception();byte[] tag=decode(envelope.getString("tag"),4096);if(tag.length!=16)throw new Exception();byte[] data=crypt(false,rx,0,session,n,Noise.concat(decode(envelope.getString("ciphertext"),16384),tag));JSONObject command=new JSONObject(new String(data,"UTF-8"));received++;return command;}catch(Exception e){reset();throw new Exception("error_pairing_decrypt");}}
 synchronized void finished(JSONObject command)throws Exception{if(!alive()||state!=1||received!=1||command.length()!=1||!command.optString("action").equals("pairing_client_finished")){reset();throw new Exception("error_pairing_decrypt");}state=2;generation++;deadline=System.nanoTime()+120000000000L;}
 synchronized long provisioning()throws Exception{if(!alive()||state!=2)throw new Exception("error_pairing_confirm_required");state=3;generation++;deadline=System.nanoTime()+120000000000L;return generation;}
 synchronized boolean current(long g){return alive()&&state==3&&generation==g;}
 synchronized JSONObject encrypt(JSONObject value)throws Exception{if(!alive()||sent==-1)throw new Exception("error_pairing_expired");byte[] encrypted=crypt(true,tx,1,session,sent,bytes(value.toString()));return new JSONObject().put("type","pairing_encrypted").put("session_id",session).put("counter",Long.toUnsignedString(sent++)).put("ciphertext",b64(Arrays.copyOf(encrypted,encrypted.length-16))).put("tag",b64(Arrays.copyOfRange(encrypted,encrypted.length-16,encrypted.length)));}
}
