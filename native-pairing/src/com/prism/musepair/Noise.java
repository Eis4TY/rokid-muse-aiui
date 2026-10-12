// Copyright (c) Meta Platforms, Inc. and affiliates.
// Adapted to Java for Android, 2026. Licensed under Apache-2.0; see MUSE-SDK-LICENSE.
package com.prism.musepair;
// Protocol port of Meta's Apache-2.0 Muse Gadget SDK Noise XX initiator.
import java.io.*;
import java.nio.*;
import java.security.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.bouncycastle.math.ec.rfc7748.X25519;

final class Noise {
 static final byte[] EMPTY=new byte[0];
 static byte[] concat(byte[]...parts){ByteArrayOutputStream o=new ByteArrayOutputStream();for(byte[] p:parts)o.write(p,0,p.length);return o.toByteArray();}
 static byte[] hash(byte[] b)throws Exception{return MessageDigest.getInstance("SHA-256").digest(b);}
 static byte[] hmac(byte[] k,byte[] b)throws Exception{Mac m=Mac.getInstance("HmacSHA256");m.init(new SecretKeySpec(k,"HmacSHA256"));return m.doFinal(b);}
 static byte[][] hkdf(byte[] k,byte[] b)throws Exception{byte[] t=hmac(k,b),a=hmac(t,new byte[]{1});return new byte[][]{a,hmac(t,concat(a,new byte[]{2}))};}
 static final class CipherState {
  byte[] key;long nonce;boolean dead;
  CipherState(){} CipherState(byte[] k){key=k;}
  synchronized byte[] apply(boolean encrypt,byte[] ad,byte[] data)throws Exception {
   if(dead)throw new IOException("cipher poisoned");if(key==null)return data;
   if(nonce>=9007199254740991L){dead=true;throw new IOException("nonce exhausted");}
   byte[] iv=ByteBuffer.allocate(12).putInt(0).putLong(nonce++).array();
   try{Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(encrypt?Cipher.ENCRYPT_MODE:Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));c.updateAAD(ad);return c.doFinal(data);}catch(Exception e){dead=true;throw e;}
  }
 }
 byte[] ck,h,e,re;CipherState cipher=new CipherState();int phase;
 Noise()throws Exception{h=Arrays.copyOf("Noise_XX_25519_AESGCM_SHA256".getBytes("UTF-8"),32);ck=h.clone();mixHash(EMPTY);}
 void mixHash(byte[] b)throws Exception{h=hash(concat(h,b));}
 void mixKey(byte[] b)throws Exception{byte[][] k=hkdf(ck,b);ck=k[0];cipher=new CipherState(k[1]);}
 byte[] enc(byte[] b)throws Exception{byte[] c=cipher.apply(true,h,b);mixHash(c);return c;}
 byte[] dec(byte[] b)throws Exception{byte[] p=cipher.apply(false,h,b);mixHash(b);return p;}
 static byte[] key(){byte[] k=new byte[32];new SecureRandom().nextBytes(k);return k;}
 static byte[] pub(byte[] k){byte[] p=new byte[32];X25519.scalarMultBase(k,0,p,0);return p;}
 static byte[] dh(byte[] k,byte[] p)throws Exception{if(p.length!=32)throw new IOException("invalid X25519 key");byte[] out=new byte[32];if(!X25519.calculateAgreement(k,0,p,0,out,0))throw new IOException("low order X25519 key");return out;}
 byte[] message1()throws Exception{if(phase!=0)throw new IOException("handshake phase");e=key();byte[] p=pub(e);mixHash(p);enc(EMPTY);phase=1;return p;}
 byte[] message2(byte[] b)throws Exception{if(phase!=1||b.length<96)throw new IOException("invalid handshake message2");re=Arrays.copyOfRange(b,0,32);mixHash(re);mixKey(dh(e,re));byte[] rs=dec(Arrays.copyOfRange(b,32,80));mixKey(dh(e,rs));byte[] payload=dec(Arrays.copyOfRange(b,80,b.length));phase=2;return payload;}
 byte[] message3()throws Exception{if(phase!=2)throw new IOException("handshake phase");byte[] s=key(),a=enc(pub(s));mixKey(dh(s,re));byte[] b=enc(EMPTY);phase=3;Arrays.fill(s,(byte)0);return concat(a,b);}
 CipherState[] split()throws Exception{if(phase!=3)throw new IOException("handshake phase");byte[][] k=hkdf(ck,EMPTY);phase=4;Arrays.fill(e,(byte)0);Arrays.fill(ck,(byte)0);return new CipherState[]{new CipherState(k[0]),new CipherState(k[1])};}
}
