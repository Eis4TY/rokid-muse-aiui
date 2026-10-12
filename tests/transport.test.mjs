import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridge} from '../dev/bridge.mjs';
import {createFrameAssembler} from '../lib/muse-transport.js';
test('Bluetooth JSON is reassembled across ATT frames, including split UTF-8',()=>{
 const actual=[];const push=createFrameAssembler(value=>actual.push(value));
 const expected={type:'device_info',name:'测试设备'};const bytes=new TextEncoder().encode(JSON.stringify(expected));
 const count=Math.ceil(bytes.length/17);
 for(let i=0;i<count;i++)push([254,i,count,...bytes.slice(i*17,(i+1)*17)]);
 assert.deepEqual(actual,[expected]);
});
test('Missing Bluetooth chunk is discarded; next message recovers',()=>{
 const actual=[];const push=createFrameAssembler(value=>actual.push(value));
 push([254,0,3,123]);push([254,2,3,125]);assert.deepEqual(actual,[]);
 push([254,0,1,...new TextEncoder().encode('{"ok":true}')]);assert.deepEqual(actual,[{ok:true}]);
});
test('Local transport receipt never claims Muse delivery, and unpaired messages fail',async()=>{
 const server=createBridge();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/messages',{method:'POST',body:JSON.stringify({text:'测试'})});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'muse_unpaired');
  const check=await fetch(base+'/transport-check',{method:'POST',body:JSON.stringify({text:'测试'})});
  assert.deepEqual(await check.json(),{received:true,characters:2,muse_sent:false});
 }finally{await new Promise(r=>server.close(r));}
});

test('Paired status does not imply a working Muse message channel',async()=>{
 const server=createBridge({pairingStatus:async()=>true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const health=await(await fetch(base+'/health')).json();assert.equal(health.muse,'paired');assert.equal(health.message_channel,'not_connected');
  const response=await fetch(base+'/messages',{method:'POST',body:JSON.stringify({text:'测试'})});assert.equal(response.status,409);assert.equal((await response.json()).code,'muse_channel_unavailable');
 }finally{await new Promise(r=>server.close(r));}
});

test('Cloud replies and delivery failures are forwarded without inventing success',async()=>{
 const calls=[];const server=createBridge({cloudRequest:async(path,body)=>{calls.push([path,body]);if(path==='/events')return {status:200,body:{messages:[{id:'a1',text:'real reply'}],revision:1}};return {status:503,body:{message:'cloud offline'}};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const base='http://127.0.0.1:'+server.address().port;
  const events=await(await fetch(base+'/events')).json();assert.equal(events.messages[0].text,'real reply');
  const response=await fetch(base+'/messages',{method:'POST',body:JSON.stringify({text:'test'})});assert.equal(response.status,503);assert.equal((await response.json()).message,'cloud offline');assert.deepEqual(calls[1],['/messages',{text:'test'}]);
 }finally{await new Promise(r=>server.close(r));}
});
