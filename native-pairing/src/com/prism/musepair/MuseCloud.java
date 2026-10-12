package com.prism.musepair;
import org.json.*;
import okhttp3.*;
import okio.ByteString;
import java.io.*;
import java.nio.*;
import java.util.*;
import java.util.concurrent.*;

final class MuseCloud implements AutoCloseable {
 static final String NODE="homelink-a17c09", SESSION="9dd94307-4981-51d7-ba17-df49719ad04b";
 interface Store {JSONObject load()throws Exception;void save(JSONObject obj)throws Exception;}
 final Store store;final OkHttpClient client;final Replies replies=new Replies();
 volatile boolean running=true,revoked;volatile String state="connecting",error="";volatile Session current;
 MuseCloud(Store store,OkHttpClient client){this.store=store;this.client=client;}
 JSONObject health()throws JSONException{return new JSONObject().put("bridge","online").put("muse",state.equals("unpaired")?"unpaired":"paired").put("message_channel",current!=null&&current.ready?"connected":state).put("error",error).put("transport","glasses-direct").put("checks",0);}
 JSONObject events()throws JSONException{return new JSONObject().put("messages",replies.snapshot()).put("revision",replies.revision).put("transcript",replies.transcript);}
 void start(){new Thread(()->{while(running){Session session=null;try{if(revoked){Thread.sleep(5000);continue;}JSONObject record=store.load();if(record==null){state="unpaired";Thread.sleep(5000);continue;}state="connecting";error="";
    String root=record.optString("api_url_v2","https://api.muse.ai");if(root.isEmpty())root="https://api.muse.ai";while(root.endsWith("/"))root=root.substring(0,root.length()-1);
    if(System.currentTimeMillis()/1000-record.optLong("access_token_saved_at",0)>1800)refresh(record,root);
    JSONObject vmData;try{vmData=api(root+"/fetch_vms",record.getString("access_token"),null);}catch(HttpError e){if(e.code!=401)throw e;refresh(record,root);vmData=api(root+"/fetch_vms",record.getString("access_token"),null);}
    JSONArray list=vmData.getJSONArray("vm_list");JSONObject vm=null;for(int i=0;i<list.length();i++){JSONObject v=list.getJSONObject(i);if(v.optString("vm_auth_token").isEmpty()||(v.optString("vm_ws_url").isEmpty()&&v.optString("vm_url").isEmpty()))continue;if(vm==null||v.optBoolean("default"))vm=v;if(v.optBoolean("default"))break;}if(vm==null)throw new IOException("no Muse VM");
    String host=record.optString("noise_host","hatch.metaaivm.com");if(host.isEmpty())host="hatch.metaaivm.com";String vmid=vm.optString("vm_id");if(vmid.isEmpty())vmid=vm.getString("vm_name");
    session=new Session();current=session;String url=new HttpUrl.Builder().scheme("https").host(host).addPathSegments("v1/noise").addQueryParameter("vm_id",vmid).build().toString().replaceFirst("^https:","wss:");
    session.ws=client.newWebSocket(new Request.Builder().url(url).header("Authorization","Bearer "+vm.getString("vm_auth_token")).header("User-Agent","rokid-muse/0.3 Android").build(),session);
    long deadline=System.nanoTime()+45000000000L;while(running&&!session.closed.await(1,TimeUnit.SECONDS)){if(!session.ready&&System.nanoTime()>deadline){session.fail("Muse 云端连接超时");break;}}
   }catch(InterruptedException e){Thread.currentThread().interrupt();break;}catch(Exception e){error=e instanceof HttpError?"Muse HTTP "+((HttpError)e).code:"眼镜无法连接 Muse（"+e.getClass().getSimpleName()+"）";}
   finally{if(session!=null)session.shutdown();current=null;if(!revoked&&!state.equals("unpaired"))state="reconnecting";}
   if(running)try{Thread.sleep(5000);}catch(InterruptedException e){break;}
  }},"MuseCloud").start();}
 void refresh(JSONObject record,String root)throws Exception{String raw=record.getString("refresh_token");raw=raw.substring(raw.lastIndexOf(':')+1);JSONObject tokens;
  try{tokens=api(root+"/device_token/refresh","hatch_refresh:"+raw,new JSONObject().put("device_id",NODE));}catch(HttpError e){if(e.code==401){revoked=true;state="unpaired";error="Muse 配对授权已失效，请重新配对";}throw e;}
  if(tokens.optJSONObject("payload")!=null)tokens=tokens.getJSONObject("payload");if(tokens.optString("access_token").isEmpty()||tokens.optString("refresh_token").isEmpty())throw new IOException("invalid token rotation");Iterator<String> keys=tokens.keys();while(keys.hasNext()){String k=keys.next();record.put(k,tokens.get(k));}record.put("access_token_saved_at",System.currentTimeMillis()/1000);store.save(record);
 }
 static final class HttpError extends IOException{final int code;HttpError(int code){super("HTTP "+code);this.code=code;}}
 JSONObject api(String url,String bearer,JSONObject data)throws Exception{Request.Builder b=new Request.Builder().url(url).header("Authorization","Bearer "+bearer).header("X-API-Version","1.0.0").header("User-Agent","rokid-muse/0.3 Android");if(data!=null)b.post(RequestBody.create(MediaType.parse("application/json"),data.toString()));try(Response r=client.newCall(b.build()).execute()){if(!r.isSuccessful())throw new HttpError(r.code());if(r.body()==null)throw new IOException("missing response");if(r.body().contentLength()>1048576)throw new IOException("API response too large");return new JSONObject(r.body().string());}}
 synchronized JSONObject send(String text)throws Exception{return sendBody(new JSONObject().put("message",text).put("output_modality","text"));}
 synchronized JSONObject sendVoice(String pcm)throws Exception{return sendBody(VoiceNote.body(pcm));}
 synchronized JSONObject sendBody(JSONObject body)throws Exception{Session s=current;if(s==null||!s.ready)throw new IOException("Muse 云端通道尚未连接");replies.begin();try{body.put("device_id",NODE).put("session_id",SESSION);Pending p=s.request("/chat/stream",body.toString().getBytes("UTF-8"),new String[][]{{"Content-Type","application/json"},{"x-request-id",UUID.randomUUID().toString()},{"x-app-id","musegadget"}});try{JSONObject response=p.done.get(65,TimeUnit.SECONDS);if(p.status<200||p.status>=300)throw new HttpError(p.status);replies.acknowledge(response);return new JSONObject().put("accepted",true).put("muse_sent",true).put("session_id",SESSION);}finally{s.pending.remove(p.id);}}finally{replies.cancelWaiting();}}
 public void close(){running=false;Session s=current;if(s!=null)s.shutdown();client.dispatcher().cancelAll();}
 static final class Pending{int id,status;ByteArrayOutputStream data=new ByteArrayOutputStream();CompletableFuture<JSONObject> done=new CompletableFuture<>();}
 final class Session extends WebSocketListener {
  WebSocket ws;Noise noise;Noise.CipherState send,recv;final Wire.Decoder decoder=new Wire.Decoder();int phase,next=1,control,subscribe;String registerId;volatile boolean ready;final CountDownLatch closed=new CountDownLatch(1);final Map<Integer,Pending> pending=new ConcurrentHashMap<>();byte[] controlBuffer=Noise.EMPTY,eventBuffer=Noise.EMPTY;long lastSeq;
  @Override public void onOpen(WebSocket socket,Response response){try{ws=socket;noise=new Noise();socket.send(ByteString.of(noise.message1()));phase=1;}catch(Exception e){fail("Muse 加密握手失败");}}
  @Override public void onMessage(WebSocket socket,ByteString bytes){try{if(phase==1){noise.message2(bytes.toByteArray());socket.send(ByteString.of(noise.message3()));Noise.CipherState[] c=noise.split();send=c[0];recv=c[1];noise=null;phase=2;control=openStream("/link-control",new String[0][]);registerId=UUID.randomUUID().toString();sendControl(new JSONObject().put("type","req").put("id",registerId).put("method","link.register").put("params",new JSONObject().put("node_id",NODE).put("display_name","Glasses_0068 · Muse").put("platform","android").put("version","0.3.0").put("device_family","homehub").put("model_id","rokid-glasses").put("is_wakeup_supported",false).put("commands_v2",new JSONObject())));return;}
    if(phase!=2)throw new IOException("unexpected Noise phase");if(bytes.size()>65535)throw new IOException("oversize encrypted frame");Wire.Frame f=decoder.decode(recv.apply(false,Noise.EMPTY,bytes.toByteArray()));if(f!=null)receive(f);
   }catch(Exception e){fail("Muse 协议连接中断（"+e.getClass().getSimpleName()+"）");}}
  @Override public void onMessage(WebSocket socket,String text){fail("Muse 返回了错误的协议帧");}
  @Override public void onFailure(WebSocket socket,Throwable t,Response response){fail(response!=null?"Muse WebSocket HTTP "+response.code():"眼镜网络连接失败（"+t.getClass().getSimpleName()+"）");}
  @Override public void onClosing(WebSocket socket,int code,String reason){socket.close(code,null);fail("Muse 云端连接已关闭");}
  @Override public void onClosed(WebSocket socket,int code,String reason){ready=false;closed.countDown();}
  synchronized void encrypted(byte[] envelope)throws Exception{if(closed.getCount()==0)throw new IOException("session closed");try{for(byte[] chunk:Wire.chunks(envelope))if(!ws.send(ByteString.of(send.apply(true,Noise.EMPTY,chunk))))throw new IOException("WebSocket send rejected");}catch(Exception e){fail("Muse 加密发送失败");throw e;}}
  synchronized int openStream(String path,String[][] headers)throws Exception{int id=next++;encrypted(Wire.request(id,path,Noise.EMPTY,false,headers));return id;}
  synchronized Pending request(String path,byte[] body,String[][] headers)throws Exception{Pending p=new Pending();p.id=next++;pending.put(p.id,p);try{
   if(body.length<=16384)encrypted(Wire.request(p.id,path,body,true,headers));
   else{encrypted(Wire.request(p.id,path,Noise.EMPTY,false,headers));for(int offset=0;offset<body.length;offset+=16384){int end=Math.min(body.length,offset+16384);encrypted(Wire.body(p.id,Arrays.copyOfRange(body,offset,end),end==body.length));}}
  }catch(Exception e){pending.remove(p.id);throw e;}return p;}
  synchronized void sendControl(JSONObject object)throws Exception{byte[] b=object.toString().getBytes("UTF-8");encrypted(Wire.body(control,Noise.concat(ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(b.length).array(),b),false));}
  void receive(Wire.Frame f)throws Exception{
   if(f.kind==5){if(f.id==control||f.id==subscribe)throw new IOException("stream reset");Pending p=pending.get(f.id);if(p!=null)p.done.completeExceptionally(new IOException("Muse stream reset"));return;}
   if(f.id==control){if(f.kind==3&&f.status>=400)throw new HttpError(f.status);controlBuffer=Noise.concat(controlBuffer,f.data);if(controlBuffer.length>4194304)throw new IOException("control buffer exceeded");while(controlBuffer.length>=4){int n=ByteBuffer.wrap(controlBuffer,0,4).order(ByteOrder.LITTLE_ENDIAN).getInt();if(n<0||n>4194304)throw new IOException("control message exceeded");if(controlBuffer.length<n+4)break;byte[] raw=Arrays.copyOfRange(controlBuffer,4,4+n);controlBuffer=Arrays.copyOfRange(controlBuffer,4+n,controlBuffer.length);if(n>0)handle(new JSONObject(new String(raw,"UTF-8")));}if(f.end)throw new IOException("control ended");}
   else if(f.id==subscribe){if(f.kind==3){if(f.status!=200)throw new HttpError(f.status);ready=true;state="connected";error="";}eventBuffer=Noise.concat(eventBuffer,f.data);if(eventBuffer.length>1048576)throw new IOException("event buffer exceeded");int start=0;for(int i=0;i<eventBuffer.length;i++)if(eventBuffer[i]==10){byte[] line=Arrays.copyOfRange(eventBuffer,start,i);start=i+1;if(line.length>0){JSONObject event=new JSONObject(new String(line,"UTF-8"));long seq=event.optLong("seq",0);if(seq!=0&&seq<=lastSeq)continue;lastSeq=Math.max(lastSeq,seq);replies.feed(event);}}if(start>0)eventBuffer=Arrays.copyOfRange(eventBuffer,start,eventBuffer.length);if(f.end)throw new IOException("subscription ended");}
   else{Pending p=pending.get(f.id);if(p==null)return;if(f.kind==3)p.status=f.status;p.data.write(f.data);if(p.data.size()>1048576)throw new IOException("response too large");if(f.end){String text=p.data.toString("UTF-8");JSONObject obj;try{obj=text.isEmpty()?new JSONObject():new JSONObject(text);}catch(JSONException e){obj=new JSONObject();}p.done.complete(obj);}}
  }
  void handle(JSONObject message)throws Exception{
   if(registerId.equals(message.optString("id"))&&!message.has("method")){if(message.has("error"))throw new IOException("register rejected");subscribe=openStream("/chat/subscribe",new String[][]{{"Content-Type","application/json"},{"Accept","application/x-ndjson"}});encrypted(Wire.body(subscribe,new JSONObject().put("session_id",SESSION).toString().getBytes("UTF-8"),true));}
   String event=message.optString("event");if(event.equals("link.unpaired")||event.equals("node.unpaired")){revoked=true;state="unpaired";throw new IOException("Muse unpaired");}
   if(message.optString("method").equals("link.invoke"))sendControl(new JSONObject().put("method","link.result").put("id",message.optString("id")).put("ok",false).put("error",new JSONObject().put("code","unsupported").put("message","Demo has no remote execution capabilities")));
  }
  void fail(String detail){ready=false;error=detail;closed.countDown();if(ws!=null)ws.cancel();for(Pending p:pending.values())p.done.completeExceptionally(new IOException(detail));}
  void shutdown(){ready=false;closed.countDown();if(ws!=null)ws.cancel();for(Pending p:pending.values())p.done.completeExceptionally(new IOException("Muse session ended"));pending.clear();}
 }
 static final class Replies {
  LinkedHashMap<String,JSONObject> items=new LinkedHashMap<>();Set<String> ids=new HashSet<>(),parents=new HashSet<>();List<JSONObject> early=new ArrayList<>();boolean waiting;long revision;volatile String transcript="";
  synchronized void begin(){waiting=true;early.clear();parents.clear();transcript="";revision++;}
  synchronized void acknowledge(JSONObject response)throws JSONException{JSONObject o=response.optJSONObject("result");if(o==null)o=response;for(String k:new String[]{"message_id","reply_to_message_id"})if(o.opt(k) instanceof String)parents.add(o.getString(k));waiting=false;List<JSONObject> copy=new ArrayList<>(early);early.clear();for(JSONObject e:copy)feed(e);}
  synchronized void cancelWaiting(){waiting=false;early.clear();}
  synchronized void feed(JSONObject event)throws JSONException{if(waiting){if(early.size()>=200)early.remove(0);early.add(event);return;}if(!event.optString("type").equals("event"))return;JSONObject p=event.optJSONObject("payload");if(p==null)return;String sid=p.optString("session_id",event.optString("session_id"));if(!sid.isEmpty()&&!sid.equals(SESSION))return;String mid=p.optString("message_id",event.optString("message_id",p.optString("id"))),parent=p.optString("reply_to_message_id",p.optString("parent_message_id"));if(mid.isEmpty()||(!ids.contains(mid)&&!sid.equals(SESSION)&&!parents.contains(mid)&&!parents.contains(parent)&&!ids.contains(parent)))return;String kind=event.optString("event");if(kind.equals("message.user")){if(!parents.contains(mid))return;String heard=p.optString("display_text",p.optString("text",p.optString("content")));int attachment=heard.indexOf("\n[file:");if(attachment>=0)heard=heard.substring(0,attachment);if(!heard.isEmpty()&&!heard.equals("[Voice note]")&&!heard.equals(transcript)){transcript=heard;revision++;}return;}if(!Arrays.asList("delta.message_start","delta.text_append","delta.message_done","message.assistant").contains(kind))return;ids.add(mid);JSONObject item=items.get(mid);if(item==null){item=new JSONObject().put("id",mid).put("role","assistant").put("text","").put("done",false);items.put(mid,item);}String text=item.optString("text");if(kind.equals("delta.text_append")&&p.opt("text") instanceof String)text+=p.getString("text");if(kind.equals("delta.message_done")||kind.equals("message.assistant")){for(String k:new String[]{"text","display_text","content"})if(p.opt(k) instanceof String&&!p.getString(k).isEmpty()){text=p.getString(k);break;}item.put("done",true);}if(text.length()>12000)text=text.substring(text.length()-12000);item.put("text",text);revision++;while(items.size()>30)items.remove(items.keySet().iterator().next());if(ids.size()>500)ids.retainAll(items.keySet());if(parents.size()>500)parents.clear();}
  synchronized JSONArray snapshot()throws JSONException{JSONArray a=new JSONArray();for(JSONObject o:items.values())if(!o.optString("text").isEmpty())a.put(new JSONObject(o.toString()));return a;}
 }
}
