package com.prism.musepair;
import android.content.Context;
import android.security.keystore.*;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.*;
import java.security.*;
import javax.crypto.*;
import javax.crypto.spec.*;

final class CredentialStore implements MuseCloud.Store {
 final Context context;final AtomicFile file;
 CredentialStore(Context c){context=c;file=new AtomicFile(new File(c.getFilesDir(),"muse-pairing.enc"));}
 SecretKey key()throws Exception{KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);String alias="muse-pairing-v1";if(ks.containsAlias(alias))return (SecretKey)ks.getKey(alias,null);KeyGenerator gen=KeyGenerator.getInstance("AES","AndroidKeyStore");gen.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());return gen.generateKey();}
 static byte[] read(InputStream in)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[2048];int n;while((n=in.read(b))!=-1){out.write(b,0,n);if(out.size()>65536)throw new IOException("credential record too large");}return out.toByteArray();}
 synchronized void importPending()throws Exception{File source=new File(context.getFilesDir(),"pairing-import.json");if(!source.exists())return;JSONObject record;try(InputStream in=new FileInputStream(source)){record=new JSONObject(new String(read(in),"UTF-8"));}if(record.optString("access_token").isEmpty()||record.optString("refresh_token").isEmpty())throw new IOException("invalid pairing import");save(record);if(!source.delete())throw new IOException("failed to erase plaintext import");}
 public synchronized JSONObject load()throws Exception{if(!file.getBaseFile().exists())return null;byte[] b=file.readFully();if(b.length<29)throw new IOException("invalid credential record");int n=b[0]&255;if(n!=12)throw new IOException("invalid credential IV");Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,b,1,n));return new JSONObject(new String(cipher.doFinal(b,1+n,b.length-1-n),"UTF-8"));}
 public synchronized void save(JSONObject obj)throws Exception{Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());byte[] iv=cipher.getIV(),encrypted=cipher.doFinal(obj.toString().getBytes("UTF-8"));FileOutputStream out=null;try{out=file.startWrite();out.write(iv.length);out.write(iv);out.write(encrypted);file.finishWrite(out);}catch(Exception e){if(out!=null)file.failWrite(out);throw e;}}
}
