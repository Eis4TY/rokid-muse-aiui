package com.prism.musepair;
import java.net.*;
import java.io.*;
import org.json.*;
final class LocalApi {
 static String line(InputStream in)throws IOException{ByteArrayOutputStream b=new ByteArrayOutputStream();for(int i=0;i<4096;i++){int c=in.read();if(c<0)throw new EOFException();if(c==10)return b.toString("US-ASCII").trim();b.write(c);}throw new IOException("header too long");}
 static void reply(Socket socket,int status,JSONObject obj)throws IOException{byte[] b=status==204?new byte[0]:obj.toString().getBytes("UTF-8");String h="HTTP/1.1 "+status+" Response\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: "+b.length+"\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nConnection: close\r\n\r\n";OutputStream out=socket.getOutputStream();out.write(h.getBytes("US-ASCII"));out.write(b);out.flush();}
}
