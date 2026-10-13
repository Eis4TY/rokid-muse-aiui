import test from 'node:test';import assert from 'node:assert/strict';
import {MuseCloud,Replies,SESSION} from '../lib/muse-cloud.js';
const event=(kind,text='',sid=SESSION,id='m1')=>({type:'event',event:kind,payload:{session_id:sid,message_id:id,text}});
test('reply accumulation scopes the session, holds early replies and preserves text on empty done',()=>{const r=new Replies();r.begin();r.feed(event('delta.text_append','你好'));assert.deepEqual(r.snapshot(),[]);r.acknowledge({message_id:'u1'});r.feed(event('delta.text_append',' Muse'));r.feed(event('delta.message_done'));r.feed(event('delta.text_append','other','different-session'));assert.deepEqual(r.snapshot(),[{id:'m1',role:'assistant',text:'你好 Muse',done:true}]);});
test('unpaired / offline never claim delivery',async()=>{const c=new MuseCloud({store:{load:()=>undefined},socket:()=>{throw new Error('must not open socket');}});c.start();assert.equal(c.health().muse,'unpaired');await assert.rejects(c.send('你好'));c.stop();});
test('token rotation uses refresh prefix once and persists before reconnect',async()=>{let saved,auth;const c=new MuseCloud({store:{save:v=>{saved=v;}},socket:()=>{},fetcher:async(url,options)=>{auth=options.headers.Authorization;return {ok:true,json:async()=>({payload:{access_token:'next-access',refresh_token:'next-refresh'}})};}});const record=await c.refresh({refresh_token:'hatch_refresh:opaque',api_url_v2:'https://api.example'},'https://api.example');assert.equal(auth,'Bearer hatch_refresh:opaque');assert.equal(record,saved);assert.equal(saved.access_token,'next-access');assert.ok(saved.access_token_saved_at>0);});

test('each glasses uses stable independent session and device identity',async()=>{
 const {deviceSession}=await import('../lib/muse-cloud.js');
 const a='homelink-abcdef123456',b='homelink-fedcba654321';
 assert.notEqual(deviceSession(a),deviceSession(b));assert.equal(deviceSession(a),deviceSession(a));
 const record={device_id:a,access_token:'synthetic',refresh_token:'synthetic'};
 const cloud=new MuseCloud({store:{load:()=>record},socket:()=>{}});cloud.record=record;
 assert.equal(cloud.authorization().device_id,a);
 const replies=new Replies(deviceSession(a));
 replies.feed({type:'event',event:'message.assistant',payload:{session_id:deviceSession(b),message_id:'other',text:'wrong device'}});
 assert.deepEqual(replies.snapshot(),[]);
});

test('server canonical session from send ack accepts queued reply but unrelated sessions remain excluded',()=>{
 const r=new Replies('requested');r.begin();r.feed(event('delta.text_append','hello','canonical','reply'));
 const ack=r.acknowledge({result:{message_id:'user',session_id:'canonical'}});assert.equal(ack.ack_session_matches_request,false);
 assert.equal(r.snapshot()[0].text,'hello');r.feed(event('delta.text_append','wrong','unrelated','foreign'));assert.equal(r.snapshot().length,1);
});
test('explicit reply parent anchors a differently named session without accepting other messages in that session',()=>{
 const r=new Replies('requested');r.acknowledge({message_id:'user'});
 assert.equal(r.feed({type:'event',event:'message.assistant',payload:{session_id:'other',message_id:'reply',reply_to_message_id:'user',display_text:'expected'}}),'accepted');
 assert.equal(r.feed({type:'event',event:'message.assistant',payload:{session_id:'other',message_id:'foreign',reply_to_message_id:'someone-else',text:'wrong'}}),'session_mismatch');
 assert.equal(r.snapshot().length,1);
});
test('reply diagnostics distinguish unsupported events and dropped text without logging text or raw IDs',()=>{
 const decisions=[],r=new Replies('private-session',data=>decisions.push(data));
 r.feed({type:'event',event:'status',payload:{text:'PRIVATE-TEXT'}});
 r.feed({type:'event',event:'message.assistant',payload:{session_id:'unknown-session',message_id:'private-message',text:'PRIVATE-TEXT'}});
 assert.equal(decisions[0].decision,'unsupported_event_kind');assert.equal(decisions[1].decision,'session_mismatch');
 assert.ok(!JSON.stringify(decisions).includes('PRIVATE-TEXT'));assert.ok(!JSON.stringify(decisions).includes('private-message'));
});

test('main comparison omits requested side session and accepts only linked replies',async()=>{
 const {messageBody}=await import('../lib/muse-cloud.js');assert.ok(!('session_id' in messageBody('main','hi','node','side')));assert.equal(messageBody('official','hi','node','side').session_id,'side');
 const r=new Replies('side',()=>{},true);const ack=r.acknowledge({message_id:'mine',session_id:'main',channel:'chat',is_thread:false});assert.equal(ack.channel,'chat');assert.equal(ack.is_thread,false);
 assert.equal(r.feed({type:'event',event:'message.assistant',payload:{session_id:'main',message_id:'foreign',text:'other'}}),'unlinked_main_message');
 assert.equal(r.feed({type:'event',event:'message.assistant',payload:{session_id:'main',message_id:'reply',reply_to_message_id:'mine',text:'mine'}}),'accepted');
});
test('task diagnostics preserve safe state but hash job and run identities',()=>{
 const logs=[],r=new Replies('side',e=>logs.push(e));r.feed({type:'event',event:'tasks.updated',payload:{status:'failed',kind:'chat',job_id:'private-job',run_id:'private-run'}});
 assert.equal(logs[0].task_status,'failed');assert.equal(logs[0].task_kind,'chat');assert.ok(logs[0].job_fp);assert.ok(!JSON.stringify(logs).includes('private-job'));
});

test('unparented main stream requires own user echo, canonical main session and active turn',()=>{
 const r=new Replies('side',()=>{},true);r.begin();r.acknowledge({message_id:'mine',session_id:'main'});
 const start={type:'event',event:'delta.message_start',payload:{session_id:'main',is_thread:false,message_id:'reply',reply_to_message_id:null}};
 assert.equal(r.feed(start),'unlinked_main_message');
 r.feed({type:'event',event:'message.user',payload:{session_id:'main',message_id:'mine'}});
 assert.equal(r.feed({...start,payload:{...start.payload,session_id:'other'}}),'unlinked_main_message');
 assert.equal(r.feed({...start,payload:{...start.payload,is_thread:true}}),'unlinked_main_message');
 assert.equal(r.feed(start),'accepted');
 r.feed({type:'event',event:'delta.text_append',payload:{session_id:'main',message_id:'reply',parent_message_id:'reply',text:'expected'}});
 r.feed({type:'event',event:'delta.message_done',payload:{session_id:'main',message_id:'reply'}});
 assert.equal(r.snapshot()[0].text,'expected');assert.equal(r.snapshot()[0].done,true);
 assert.equal(r.feed({...start,payload:{...start.payload,message_id:'later'}}),'unlinked_main_message');
});
test('foreign main user turn cancels unparented fallback; stale turn cannot capture later reply',()=>{
 const r=new Replies('side',()=>{},true),echo=id=>({type:'event',event:'message.user',payload:{session_id:'main',message_id:id}}),start={type:'event',event:'delta.message_start',payload:{session_id:'main',is_thread:false,message_id:'reply'}};
 r.begin();r.acknowledge({message_id:'mine',session_id:'main'});r.feed(echo('mine'));r.feed(echo('someone-else'));assert.equal(r.feed(start),'unlinked_main_message');
 r.begin();r.acknowledge({message_id:'mine',session_id:'main'});r.feed(echo('mine'));r.turn.started-=90001;assert.equal(r.feed(start),'unlinked_main_message');
});
test('queued own user echo and unparented start survive ack ordering; default targets main',()=>{
 const r=new Replies('side',()=>{},true);r.begin();
 r.feed({type:'event',event:'message.user',payload:{session_id:'main',message_id:'mine'}});
 r.feed({type:'event',event:'delta.message_start',payload:{session_id:'main',is_thread:false,message_id:'reply'}});
 r.acknowledge({message_id:'mine',session_id:'main'});
 assert.ok(r.ids.has('reply'));const cloud=new MuseCloud({store:{},socket:()=>{}});assert.equal(cloud.profile,'main');assert.equal(cloud.replies.requireLinked,true);
});

test('late refresh cannot overwrite a newly handed-off authorization',async()=>{
 let finish,saved=false;
 const cloud=new MuseCloud({store:{save(){saved=true;}},socket:()=>{},fetcher:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=cloud.refresh({refresh_token:'synthetic-old'},'https://api.example');
 cloud.stop();finish({ok:true,status:200,json:async()=>({access_token:'synthetic-late',refresh_token:'synthetic-late-refresh'})});
 await assert.rejects(pending,/Connection state has changed/);assert.equal(saved,false);
});
test('an obsolete refresh 401 cannot revoke the replacement session',async()=>{
 let finish;
 const cloud=new MuseCloud({store:{save(){}},socket:()=>{},fetcher:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=cloud.refresh({refresh_token:'synthetic-old'},'https://api.example');
 cloud.stop();finish({ok:false,status:401});await assert.rejects(pending,/Connection state has changed/);assert.equal(cloud.revoked,false);
});

test('old saved access token is validated before attempting a refresh',async()=>{
 const paths=[];const record={access_token:'synthetic-access',refresh_token:'synthetic-refresh',access_token_saved_at:1};
 const cloud=new MuseCloud({store:{load:()=>record},socket:()=>{},fetcher:async url=>{paths.push(new URL(url).pathname);return {ok:true,status:200,json:async()=>({vm_list:[]})};}});
 cloud.active=true;await cloud.connect();cloud.stop();assert.deepEqual(paths,['/fetch_vms']);assert.equal(cloud.revoked,false);
});
test('access rejection refreshes then validates the rotated token',async()=>{
 const paths=[];let record={access_token:'synthetic-access',refresh_token:'synthetic-refresh',access_token_saved_at:1};
 const cloud=new MuseCloud({store:{load:()=>record,save:v=>{record=v;}},socket:()=>{},fetcher:async url=>{paths.push(new URL(url).pathname);if(paths.length===1)return {ok:false,status:401};return {ok:true,status:200,json:async()=>paths.length===2?{access_token:'rotated',refresh_token:'rotated-refresh'}:{vm_list:[]}};}});
 cloud.active=true;await cloud.connect();cloud.stop();assert.deepEqual(paths,['/fetch_vms','/device_token/refresh','/fetch_vms']);assert.equal(record.access_token,'rotated');
});

test('leaving the page retains a completed rotation when authorization was not replaced',async()=>{
 let finish;let saved={access_token:'old-access',refresh_token:'old-refresh'};
 const cloud=new MuseCloud({store:{load:()=>saved,save:v=>{saved=v;}},socket:()=>{},fetcher:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=cloud.refresh(saved,'https://api.example');cloud.stop();finish({ok:true,status:200,json:async()=>({access_token:'new-access',refresh_token:'new-refresh'})});
 await assert.rejects(pending,/Connection state has changed/);assert.equal(saved.refresh_token,'new-refresh');
});
test('a completed old rotation never overwrites replacement credentials',async()=>{
 let finish;let saved={access_token:'old-access',refresh_token:'old-refresh'};
 const cloud=new MuseCloud({store:{load:()=>saved,save:v=>{saved=v;}},socket:()=>{},fetcher:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=cloud.refresh(saved,'https://api.example');cloud.stop();saved={access_token:'replacement',refresh_token:'replacement-refresh'};finish({ok:true,status:200,json:async()=>({access_token:'late',refresh_token:'late-refresh'})});
 await assert.rejects(pending,/Connection state has changed/);assert.equal(saved.refresh_token,'replacement-refresh');
});

test('streamed Markdown preserves paragraph breaks, lists and code indentation',()=>{
 const r=new Replies();const markdown='# 新闻\n\n- **第一条**\n- 第二条\n\n```js\n  hello();\n```';
 r.feed({type:'event',event:'delta.message_start',payload:{session_id:SESSION,message_id:'markdown'}});
 for(const chunk of [markdown.slice(0,8),markdown.slice(8,24),markdown.slice(24)])r.feed({type:'event',event:'delta.text_append',payload:{session_id:SESSION,message_id:'markdown',text:chunk}});
 assert.equal(r.snapshot()[0].text,markdown);
 r.feed({type:'event',event:'delta.message_done',payload:{session_id:SESSION,message_id:'markdown',text:markdown}});
 assert.equal(r.snapshot()[0].text,markdown);assert.equal(r.snapshot()[0].done,true);
});
