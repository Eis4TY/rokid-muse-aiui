package com.prism.musepair;
import java.net.*;
import java.io.*;
import java.util.concurrent.*;
import org.json.*;

final class LocalApi implements AutoCloseable {
 final MuseCloud cloud;final ServerSocket server;volatile boolean active=true;int checks;
 final ExecutorService clients=new ThreadPoolExecutor(2,6,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(12));
 LocalApi(MuseCloud c)throws Exception{cloud=c;server=new ServerSocket();server.setReuseAddress(true);server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"),18787),12);}
 void start(){new Thread(()->{while(active){try{Socket s=server.accept();try{clients.execute(()->handle(s));}catch(RejectedExecutionException e){s.close();}}catch(IOException e){if(active)break;}}},"MuseLocalApi").start();}
 static String line(InputStream in)throws IOException{ByteArrayOutputStream b=new ByteArrayOutputStream();for(int i=0;i<4096;i++){int c=in.read();if(c<0)throw new EOFException();if(c==10)return b.toString("US-ASCII").trim();b.write(c);}throw new IOException("header too long");}
 void handle(Socket socket){try(Socket s=socket){s.setSoTimeout(6000);InputStream in=new BufferedInputStream(s.getInputStream());String[] request=line(in).split(" ");if(request.length!=3)throw new IOException("bad HTTP request");int length=0,total=0;while(true){String h=line(in);total+=h.length();if(total>16384)throw new IOException("headers too large");if(h.isEmpty())break;String lower=h.toLowerCase(java.util.Locale.ROOT);if(lower.startsWith("transfer-encoding:"))throw new IOException("chunked requests unsupported");if(lower.startsWith("content-length:"))length=Integer.parseInt(h.substring(15).trim());}
   if(length<0||length>(request[1].equals("/voice-notes")?650000:16384)){reply(s,413,new JSONObject().put("code","message_too_large"));return;}byte[] body=new byte[length];int n=0;while(n<length){int r=in.read(body,n,length-n);if(r<0)throw new EOFException();n+=r;}
   JSONObject result;int code=200;
   try{if(request[0].equals("OPTIONS")){result=new JSONObject();code=204;}
    else if(request[0].equals("GET")&&request[1].equals("/health")){result=cloud.health().put("checks",checks);}
    else if(request[0].equals("GET")&&request[1].equals("/events")){result=cloud.events();}
    else if(request[0].equals("POST")&&request[1].equals("/voice-notes")){JSONObject obj=new JSONObject(new String(body,"UTF-8"));if(!(obj.opt("pcm_base64") instanceof String))throw new IllegalArgumentException("缺少录音数据");result=cloud.sendVoice(obj.getString("pcm_base64"));}
    else if(request[0].equals("POST")&&(request[1].equals("/messages")||request[1].equals("/transport-check"))){JSONObject obj=new JSONObject(new String(body,"UTF-8"));String text=obj.optString("text");if(!(obj.opt("text") instanceof String)||text.trim().isEmpty()||text.length()>2000){result=new JSONObject().put("message","消息为空或过长");code=400;}
     else if(request[1].equals("/transport-check")){checks++;result=new JSONObject().put("received",true).put("characters",text.length()).put("muse_sent",false);}else result=cloud.send(text);}
    else{code=404;result=new JSONObject().put("code","not_found");}
   }catch(IllegalArgumentException e){code=400;result=new JSONObject().put("message",e.getMessage());}catch(JSONException e){code=400;result=new JSONObject().put("code","invalid_json");}catch(Exception e){code=503;result=new JSONObject().put("message",e instanceof MuseCloud.HttpError?"Muse HTTP "+((MuseCloud.HttpError)e).code:"Muse 消息提交失败，请检查眼镜网络");}
   reply(s,code,result);
  }catch(Exception ignored){}}
 static void reply(Socket socket,int status,JSONObject obj)throws IOException{byte[] b=status==204?new byte[0]:obj.toString().getBytes("UTF-8");String h="HTTP/1.1 "+status+" Response\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: "+b.length+"\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nConnection: close\r\n\r\n";OutputStream out=socket.getOutputStream();out.write(h.getBytes("US-ASCII"));out.write(b);out.flush();}
 public void close(){active=false;try{server.close();}catch(IOException ignored){}clients.shutdownNow();}
}
