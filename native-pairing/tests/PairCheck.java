package com.prism.musepair;
import java.io.*;
import org.json.*;
public class PairCheck {
 public static void main(String[] args)throws Exception{PairProtocol p=new PairProtocol();BufferedReader in=new BufferedReader(new InputStreamReader(System.in,"UTF-8"));String line;while((line=in.readLine())!=null){JSONObject m=new JSONObject(line);try{switch(m.getString("op")){case "hello":System.out.println(p.hello(m.getJSONObject("value")));break;case "finished":p.finished(p.decrypt(m.getJSONObject("value")));System.out.println(p.encrypt(new JSONObject().put("type","status").put("status","pairing_confirmed")));break;case "receive":System.out.println(p.decrypt(m.getJSONObject("value")));break;case "send":System.out.println(p.encrypt(m.getJSONObject("value")));break;}}catch(Exception e){System.out.println(new JSONObject().put("error",e.getMessage()).put("state",p.state));}System.out.flush();}}
}
