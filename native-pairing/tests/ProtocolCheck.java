package com.prism.musepair;
import java.io.*;import java.net.*;import java.util.*;
public class ProtocolCheck {
 static void write(DataOutputStream o,byte[] b)throws Exception{o.writeInt(b.length);o.write(b);o.flush();}
 static byte[] read(DataInputStream i)throws Exception{int n=i.readInt();if(n<0||n>1000000)throw new IOException("test frame too large");byte[] b=new byte[n];i.readFully(b);return b;}
 public static void main(String[] args)throws Exception{
  try(Socket s=new Socket("127.0.0.1",Integer.parseInt(args[0]))){s.setSoTimeout(10000);DataOutputStream out=new DataOutputStream(s.getOutputStream());DataInputStream in=new DataInputStream(s.getInputStream());Noise n=new Noise();write(out,n.message1());n.message2(read(in));write(out,n.message3());Noise.CipherState[] c=n.split();byte[] req=Wire.request(1,"/chat/subscribe","{\"session_id\":\"test\"}".getBytes("UTF-8"),true,new String[][]{{"Content-Type","application/json"}});for(byte[] b:Wire.chunks(req))write(out,c[0].apply(true,Noise.EMPTY,b));Wire.Decoder decoder=new Wire.Decoder();Wire.Frame f=null;while(f==null)f=decoder.decode(c[1].apply(false,Noise.EMPTY,read(in)));if(f.id!=1||f.kind!=3||f.status!=200||!f.end||f.data.length!=70002||!new String(f.data,"UTF-8").startsWith("成功"))throw new AssertionError("incorrect response frame");
   try{c[1].apply(false,Noise.EMPTY,new byte[16]);throw new AssertionError("bad tag accepted");}catch(javax.crypto.AEADBadTagException expected){}
   try{Noise.dh(Noise.key(),new byte[32]);throw new AssertionError("low order point accepted");}catch(IOException expected){}
   try{decoder.decode(Noise.concat(Wire.v(1,1),Wire.v(3,257)));throw new AssertionError("unbounded chunks accepted");}catch(IOException expected){}
   System.out.println("PASS Noise handshake + SDK envelope + multi-chunk UTF-8 + bad-tag rejection + low-order rejection + bounds");
  }
 }
}
