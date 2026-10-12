// Copyright (c) Meta Platforms, Inc. and affiliates.
// Adapted to Java for Android, 2026. Licensed under Apache-2.0; see MUSE-SDK-LICENSE.
package com.prism.musepair;
import java.io.*;
import java.util.*;

final class Wire {
 static byte[] v(int f,long n){ByteArrayOutputStream o=new ByteArrayOutputStream();var(o,f<<3);var(o,n);return o.toByteArray();}
 static void var(ByteArrayOutputStream o,long n){while((n&~127L)!=0){o.write(((int)n&127)|128);n>>>=7;}o.write((int)n);}
 static byte[] b(int f,byte[] b){ByteArrayOutputStream o=new ByteArrayOutputStream();var(o,(f<<3)|2);var(o,b.length);o.write(b,0,b.length);return o.toByteArray();}
 static byte[] s(int f,String s){return b(f,s.getBytes(java.nio.charset.StandardCharsets.UTF_8));}
 static final class Field {int num;long n;byte[] b;Field(int f,long n,byte[] b){num=f;this.n=n;this.b=b;}}
 static List<Field> parse(byte[] raw)throws IOException{
  List<Field> out=new ArrayList<>();int[] p={0};while(p[0]<raw.length){long k=read(raw,p);int f=(int)(k>>>3),type=(int)(k&7);if(f==0)throw new IOException("invalid protobuf key");
   if(type==0)out.add(new Field(f,read(raw,p),null));
   else if(type==2){long n=read(raw,p);if(n<0||n>raw.length-p[0])throw new IOException("invalid protobuf length");int end=p[0]+(int)n;out.add(new Field(f,0,Arrays.copyOfRange(raw,p[0],end)));p[0]=end;}
   else if(type==1||type==5){p[0]+=type==1?8:4;if(p[0]>raw.length)throw new IOException("truncated protobuf");}
   else throw new IOException("unsupported protobuf wire type");
  }return out;
 }
 static long read(byte[] a,int[] p)throws IOException{long n=0;for(int i=0;i<10;i++){if(p[0]>=a.length)throw new IOException("truncated varint");int b=a[p[0]++]&255;if(i==9&&(b&254)!=0)throw new IOException("varint overflow");n|=(long)(b&127)<<(7*i);if((b&128)==0)return n;}throw new IOException("varint overflow");}
 static long number(List<Field> fs,int f,long def){for(Field p:fs)if(p.num==f&&p.b==null)def=p.n;return def;}
 static byte[] bytes(List<Field> fs,int f){byte[] b=Noise.EMPTY;for(Field p:fs)if(p.num==f&&p.b!=null)b=p.b;return b;}
 static byte[] request(int id,String path,byte[] body,boolean end,String[][] headers){ByteArrayOutputStream o=new ByteArrayOutputStream();byte[] r=Noise.concat(s(1,"POST"),s(2,path));o.write(r,0,r.length);for(String[] h:headers){r=b(3,Noise.concat(s(1,h[0]),s(2,h[1])));o.write(r,0,r.length);}r=Noise.concat(body.length==0?Noise.EMPTY:b(4,body),end?v(5,1):Noise.EMPTY);o.write(r,0,r.length);return envelope(id,2,o.toByteArray());}
 static byte[] body(int id,byte[] b,boolean end){return envelope(id,4,Noise.concat(b.length==0?Noise.EMPTY:b(1,b),end?v(2,1):Noise.EMPTY));}
 static byte[] envelope(int id,int type,byte[] data){return b(2,Noise.concat(v(1,id),b(type,data)));}
 static List<byte[]> chunks(byte[] bytes){List<byte[]> out=new ArrayList<>();long id=new java.security.SecureRandom().nextLong();int total=Math.max(1,(bytes.length+65488)/65489);if(total>256)throw new IllegalArgumentException("outbound frame too large");for(int i=0;i<total;i++)out.add(Noise.concat(v(1,id),i==0?Noise.EMPTY:v(2,i),v(3,total),b(4,Arrays.copyOfRange(bytes,i*65489,Math.min(bytes.length,(i+1)*65489)))));return out;}
 static final class Frame {int id,kind,status;byte[] data;boolean end;}
 static final class Assembly{byte[][] chunks;int count,size;long created=System.nanoTime();Assembly(int total){chunks=new byte[total][];}}
 static final class Decoder {
  Map<Long,Assembly> pending=new HashMap<>();
  Frame decode(byte[] plain)throws IOException{
   List<Field> p=parse(plain);long id=number(p,1,0),ti=number(p,3,1),ix=number(p,2,0);if(ti<1||ti>256||ix<0||ix>=ti)throw new IOException("invalid chunk index");int total=(int)ti,index=(int)ix;byte[] chunk=bytes(p,4);if(chunk.length>65489)throw new IOException("oversize chunk");pending.entrySet().removeIf(e->System.nanoTime()-e.getValue().created>60000000000L);
   Assembly a=pending.get(id);if(a==null){if(pending.size()>=16)throw new IOException("chunk budget exceeded");a=new Assembly(total);pending.put(id,a);}if(a.chunks.length!=total||a.chunks[index]!=null)throw new IOException("inconsistent chunks");a.chunks[index]=chunk;a.size+=chunk.length;a.count++;if(a.size>16777216)throw new IOException("assembly too large");if(a.count<total)return null;pending.remove(id);
   ByteArrayOutputStream o=new ByteArrayOutputStream();for(byte[] c:a.chunks)o.write(c,0,c.length);p=parse(bytes(parse(o.toByteArray()),1));Frame f=new Frame();f.id=(int)number(p,1,0);for(Field field:p)if(field.num>=2&&field.num<=5&&field.b!=null){f.kind=field.num;List<Field> app=parse(field.b);if(f.kind==3){f.status=(int)number(app,1,0);f.data=bytes(app,3);f.end=number(app,4,0)!=0;}else if(f.kind==4){f.data=bytes(app,1);f.end=number(app,2,0)!=0;}else if(f.kind==5){f.data=bytes(app,2);f.end=true;}else throw new IOException("unexpected server request");}if(f.kind==0)throw new IOException("empty service frame");return f;
  }
 }
}
