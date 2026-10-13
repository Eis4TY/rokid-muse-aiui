import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudSession,subscriptionSpec} from '../lib/muse-cloud.js';
import {parse} from '../lib/muse-wire.js';
test('official subscription sends an empty JSON body with official application headers after registration',()=>{
 const probes=[],requests=[],frames=[];const cloud={profile:'official',sessionId:()=> 'uncreated-session',probe:(event,data)=>probes.push({event,...data})};
 const s=new CloudSession(cloud,'wss://synthetic','synthetic');s.registerId='register';s.stream=(path,headers)=>{requests.push({path,headers});return 7;};s.encrypted=bytes=>frames.push(bytes);
 s.handle({id:'register',result:{ok:true}});
 assert.equal(requests[0].path,'/chat/subscribe');assert.ok(requests[0].headers.some(([k,v])=>k==='x-app-id'&&v==='hatch-web'));
 const inner=parse(parse(frames[0])[0].data);const body=parse(inner.find(p=>p.f===4).data).find(p=>p.f===1).data;
 assert.equal(new TextDecoder().decode(body),'{}');assert.equal(s.ready,false);
});
test('protocol probes isolate session body and application-header differences',()=>{
 assert.deepEqual(subscriptionSpec('gadget','side').body,{});
 assert.ok(subscriptionSpec('gadget','side').headers.some(([k,v])=>k==='x-app-id'&&v==='musegadget'));
 assert.deepEqual(subscriptionSpec('scoped','side').body,{session_id:'side'});
 assert.ok(!subscriptionSpec('baseline','side').headers.some(([k])=>k==='x-app-id'));
});
test('404 logs only response shape and error code, never response credentials, and never declares online',()=>{
 const probes=[],failures=[];const cloud={profile:'official',probe:(event,data)=>probes.push({event,...data}),disconnected:(session,message)=>failures.push(message)};
 const s=new CloudSession(cloud,'wss://synthetic','synthetic');s.subscribe=7;
 s.receive({id:7,kind:3,status:404,data:new TextEncoder().encode(JSON.stringify({code:'route_not_found',access_token:'SECRET-SYNTHETIC'})),end:true});
 assert.equal(s.ready,false);assert.equal(s.ended,true);assert.equal(failures[0],'Reply subscription HTTP 404');
 assert.ok(probes.some(p=>p.event==='subscription_error'&&p.code==='route_not_found'));
 assert.ok(!JSON.stringify(probes).includes('SECRET-SYNTHETIC'));
});

test('status sequence cannot discard a lower-sequence assistant reply; exact retransmission is logged',()=>{
 const accepted=[],probes=[],s=new CloudSession({replies:{feed:e=>accepted.push(e),snapshot:()=>[]},probe:(event,data)=>probes.push({event,...data})},'wss://synthetic','synthetic');s.subscribe=7;
 const push=e=>s.receive({id:7,kind:4,data:new TextEncoder().encode(JSON.stringify(e)+'\n'),end:false});
 const status={type:'event',event:'tasks.updated',seq:99,payload:{status:'running'}},reply={type:'event',event:'delta.text_append',seq:2,payload:{text:'hello'}};
 push(status);push(reply);push(reply);push({...reply,payload:{text:'different'}});
 push({...reply,seq:undefined});push({...reply,seq:undefined});
 assert.equal(accepted.length,5);assert.equal(accepted[1].payload.text,'hello');assert.equal(probes.filter(p=>p.event==='reply_duplicate').length,1);
 assert.ok(!JSON.stringify(probes).includes('hello'));
});
