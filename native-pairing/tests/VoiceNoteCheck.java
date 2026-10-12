package com.prism.musepair;
import java.nio.*;import java.util.*;import org.json.*;
public class VoiceNoteCheck {
 public static void main(String[] args)throws Exception{
  byte[] pcm=new byte[32000];pcm[0]=12;JSONObject body=VoiceNote.body(Base64.getEncoder().encodeToString(pcm));JSONObject item=body.getJSONArray("items").getJSONObject(0);
  if(!body.getString("message").isEmpty()||!item.getString("mime_type").equals("audio/wav"))throw new AssertionError();
  byte[] wav=Base64.getDecoder().decode(item.getString("data_base64"));ByteBuffer b=ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);
  if(wav.length!=32044||b.getInt(4)!=32036||b.getInt(24)!=16000||b.getShort(22)!=1||b.getShort(34)!=16||b.getInt(40)!=32000||wav[44]!=12)throw new AssertionError("invalid WAV");
  for(String invalid:new String[]{"",Base64.getEncoder().encodeToString(new byte[9601]),Base64.getEncoder().encodeToString(new byte[480002]),Base64.getEncoder().encodeToString(new byte[9600]).replace('A','!')}){try{VoiceNote.body(invalid);throw new AssertionError("invalid audio accepted");}catch(IllegalArgumentException expected){}}
  MuseCloud.Replies replies=new MuseCloud.Replies();replies.begin();replies.acknowledge(new JSONObject().put("message_id","note1"));
  replies.feed(new JSONObject().put("type","event").put("event","message.user").put("payload",new JSONObject().put("session_id",MuseCloud.SESSION).put("message_id","other").put("text","别人的消息")));
  if(!replies.transcript.isEmpty())throw new AssertionError("unrelated transcript");
  replies.feed(new JSONObject().put("type","event").put("event","message.user").put("payload",new JSONObject().put("session_id",MuseCloud.SESSION).put("message_id","note1").put("text","测试中文\n[file:audio/wav voice_note.wav]")));
  if(!replies.transcript.equals("测试中文")||replies.snapshot().length()!=0)throw new AssertionError("transcript treated as reply");
  System.out.println("PASS WAV format, invalid audio limits, and related user transcript isolation");
 }
}
