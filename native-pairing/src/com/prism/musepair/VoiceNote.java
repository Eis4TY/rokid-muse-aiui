package com.prism.musepair;
import java.nio.*;
import java.util.Base64;
import org.json.*;

final class VoiceNote {
 static final int RATE=16000,MAX_PCM=RATE*2*15,MAX_BASE64=MAX_PCM/3*4;
 static JSONObject body(String encoded)throws JSONException{
  if(encoded==null||encoded.length()<12800||encoded.length()>MAX_BASE64||encoded.length()%4!=0||!encoded.matches("[A-Za-z0-9+/]*={0,2}"))throw new IllegalArgumentException("录音格式或长度无效（支持 0.3–15 秒）");
  byte[] pcm;
  try{pcm=Base64.getDecoder().decode(encoded);}catch(IllegalArgumentException e){throw new IllegalArgumentException("录音编码无效");}
  if(pcm.length<9600||pcm.length>MAX_PCM||pcm.length%2!=0)throw new IllegalArgumentException("录音格式或长度无效（支持 0.3–15 秒）");
  ByteBuffer wav=ByteBuffer.allocate(44+pcm.length).order(ByteOrder.LITTLE_ENDIAN);
  wav.put(new byte[]{'R','I','F','F'}).putInt(36+pcm.length).put(new byte[]{'W','A','V','E','f','m','t',' '}).putInt(16).putShort((short)1).putShort((short)1).putInt(RATE).putInt(RATE*2).putShort((short)2).putShort((short)16).put(new byte[]{'d','a','t','a'}).putInt(pcm.length).put(pcm);
  JSONObject item=new JSONObject().put("type","file").put("mime_type","audio/wav").put("filename","voice_note.wav").put("data_base64",Base64.getEncoder().encodeToString(wav.array()));
  return new JSONObject().put("message","").put("output_modality","text").put("items",new JSONArray().put(item));
 }
}
