import {mt} from './muse-i18n.js';
import {voiceCryptoHeaders} from './muse-native-binding.js';
import {MuseVoiceCall} from './muse-voice-call.js';
import {NoiseXX,concat,EMPTY,utf8} from './muse-noise.js';
import {sha256} from './muse-crypto.js';
import {Decoder,request,bodyChunk,chunks} from './muse-wire.js';
export const NODE='homelink-a17c09', SESSION='9dd94307-4981-51d7-ba17-df49719ad04b';
export function deviceSession(node){if(node===NODE)return SESSION;const h=sha256(utf8(node));h[6]=(h[6]&15)|80;h[8]=(h[8]&63)|128;const v=[...h.slice(0,16)].map(n=>n.toString(16).padStart(2,'0')).join('');return v.slice(0,8)+'-'+v.slice(8,12)+'-'+v.slice(12,16)+'-'+v.slice(16,20)+'-'+v.slice(20);}
const text=bytes=>new TextDecoder().decode(bytes);
export const PROFILES=['official','gadget','scoped','baseline','main'];
export function subscriptionSpec(profile,sessionId){const headers=[['Content-Type','application/json'],['Accept','application/x-ndjson'],['x-request-id',crypto.randomUUID()]];if(profile!=='baseline')headers.push(['x-app-id',profile==='gadget'?'musegadget':'hatch-web']);return {headers,body:profile==='scoped'||profile==='baseline'?{session_id:sessionId}:{}};}
function responseSummary(data){const summary={bytes:data.length};try{const value=JSON.parse(text(data));summary.format='json';summary.keys=Object.keys(value||{}).filter(k=>/^[a-z_]{1,40}$/i.test(k)).slice(0,15);for(const key of ['code','error_code','type'])if(typeof value?.[key]==='string'&&/^[a-z0-9_.-]{1,80}$/i.test(value[key]))summary[key]=value[key];}catch(_){summary.format=/^\s*</.test(text(data))?'html':'other';}return summary;}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function cancel(id){if(id!==undefined&&id!==null)clearTimeout(id);}
const fingerprint=value=>typeof value==='string'?[...sha256(utf8(value)).slice(0,6)].map(n=>n.toString(16).padStart(2,'0')).join(''):null;
const safeEnum=value=>typeof value==='string'&&/^[a-z0-9_.-]{1,60}$/i.test(value)?value:null;
export function messageBody(profile,message,node,sessionId){const body={message,output_modality:'text',device_id:node};if(profile!=='main')body.session_id=sessionId;return body;}
export class EventDeduplicator {
 constructor(){this.seen=new Set();}
 duplicate(event,line){if(!Number.isSafeInteger(event.seq)||event.seq<=0)return false;const key=[...sha256(line)].map(n=>n.toString(16).padStart(2,'0')).join('');if(this.seen.has(key))return true;this.seen.add(key);if(this.seen.size>1000)this.seen.delete(this.seen.values().next().value);return false;}
}
// Widget references identify cards that the glasses cannot render.
function displayMessage(text, streaming=false){
 const prefix='[[hatch_widget:';
 if(streaming){
  const start=text.lastIndexOf('[[');
  const tail=start<0?'':text.slice(start);
  if(tail&&(prefix.startsWith(tail)||/^\[\[hatch_widget:[^\]\r\n]*\]?$/.test(tail)))text=text.slice(0,start);
  else if(text.endsWith('['))text=text.slice(0,-1);
 }
 return text.replace(/\[\[hatch_widget:[^\]\r\n]+\]\]/g,mt('unsupportedWidget'));
}
export class Replies {
 constructor(sessionId=SESSION,onDecision=()=>{},requireLinked=false){this.requireLinked=requireLinked;this.sessionId=sessionId;this.sessions=new Set([sessionId]);this.itemSessions=new Map();this.onDecision=onDecision;this.items=new Map();this.ids=new Set();this.parents=new Set();this.pending=[];this.waiting=false;this.revision=0;}
 begin(){this.transcript='';this.waiting=true;this.pending=[];this.turn={started:Date.now(),session:null,userIds:new Set(),userSeen:false,open:true};}
 acknowledge(response){const p=response?.result||response?.payload||response||{};for(const k of ['message_id','reply_to_message_id'])if(typeof p[k]==='string')this.parents.add(p[k]);const sid=p.session_id||response?.session_id;if(this.turn){this.turn.session=sid;this.turn.userIds=new Set(['message_id','reply_to_message_id'].map(k=>p[k]).filter(v=>typeof v==='string'));}if(typeof sid==='string'&&sid.length<=128)this.sessions.add(sid);while(this.sessions.size>20)this.sessions.delete([...this.sessions][1]);this.waiting=false;const pending=this.pending;this.pending=[];for(const event of pending)this.feed(event);return {ack_session_present:typeof sid==='string',ack_session_matches_request:sid===this.sessionId,ack_message_id_present:typeof p.message_id==='string',requested_session_fp:fingerprint(this.sessionId),ack_session_fp:fingerprint(sid),channel:safeEnum(p.channel),is_thread:typeof p.is_thread==='boolean'?p.is_thread:null};}
 feed(event){const decision=this.consume(event);const p=event.payload;this.onDecision({decision,kind:typeof event.event==='string'?event.event.slice(0,60):'unknown',event_type:typeof event.type==='string'?event.type.slice(0,40):'missing',event_keys:Object.keys(event).slice(0,15),payload_keys:p&&typeof p==='object'?Object.keys(p).slice(0,15):[],session_fp:fingerprint(p?.session_id||event.session_id),message_fp:fingerprint(p?.message_id||event.message_id||p?.id),parent_fp:fingerprint(p?.reply_to_message_id||p?.parent_message_id),seq:Number.isSafeInteger(event.seq)?event.seq:null,task_status:['tasks.updated','task.status'].includes(event.event)?safeEnum(p?.status):null,task_kind:event.event==='tasks.updated'?safeEnum(p?.kind):null,job_fp:fingerprint(p?.job_id),run_fp:fingerprint(p?.run_id),text_characters:typeof p?.text==='string'?p.text.length:typeof p?.display_text==='string'?p.display_text.length:typeof p?.content==='string'?p.content.length:0,accepted_messages:this.snapshot().length});return decision;}
 consume(event){
  if(this.waiting){this.pending.push(event);if(this.pending.length>200)this.pending.shift();return 'buffered_before_ack';}
  if(event.type!=='event')return 'not_message_event';const p=event.payload;if(!p||typeof p!=='object')return 'missing_payload';
  const kind=event.event;if(kind==='message.user'&&this.requireLinked&&this.turn?.open&&p.session_id===this.turn.session){const mid=p.message_id||p.id;if(this.turn.userIds.has(mid)){this.turn.userSeen=true;if(typeof p.display_text==='string'){this.transcript=p.display_text.split('\n[file:')[0];this.revision++;}}else this.turn.open=false;return this.turn.open?'own_user_echo':'foreign_user_turn';}if(!['delta.message_start','delta.text_append','delta.message_done','message.assistant'].includes(kind))return 'unsupported_event_kind';
  const sid=p.session_id||event.session_id,mid=p.message_id||event.message_id||p.id,parent=p.reply_to_message_id||p.parent_message_id;
  if(typeof mid!=='string')return 'missing_message_id';
  const unparentedStart=this.requireLinked&&kind==='delta.message_start'&&!parent&&this.turn?.open&&this.turn.userSeen&&Date.now()-this.turn.started<=90000&&sid===this.turn.session&&p.is_thread===false;
  const linked=unparentedStart||this.parents.has(parent)||this.ids.has(parent)||(this.ids.has(mid)&&(!sid||this.itemSessions.get(mid)===sid));
  if(this.requireLinked&&!linked)return 'unlinked_main_message';
  if(sid&&!this.sessions.has(sid)&&!linked)return 'session_mismatch';
  if(!this.sessions.has(sid)&&!linked)return 'unlinked_message';
  if(kind==='message.assistant'&&p.display_text_ready===false)return 'text_not_ready';
  this.ids.add(mid);if(!this.itemSessions.has(mid))this.itemSessions.set(mid,sid);let item=this.items.get(mid);if(!item){item={id:mid,role:'assistant',text:'',done:false};this.items.set(mid,item);}
  if(kind==='delta.text_append'&&typeof p.text==='string')item.text+=p.text;
  if(kind==='delta.message_done'||kind==='message.assistant'){const final=p.text||p.display_text||p.content;if(typeof final==='string')item.text=final;item.done=true;if(this.turn)this.turn.open=false;}
  item.text=item.text.slice(-12000);this.revision++;while(this.items.size>30)this.items.delete(this.items.keys().next().value);if(this.ids.size>500){this.ids=new Set(this.items.keys());for(const key of this.itemSessions.keys())if(!this.ids.has(key))this.itemSessions.delete(key);}if(this.parents.size>500)this.parents.clear();return 'accepted';
 }
 snapshot(){return [...this.items.values()].map(m=>({...m,text:displayMessage(m.text,!m.done)})).filter(m=>m.text.trim());}
}
export class MuseCloud {
 constructor({store,socket,fetcher=fetch,identity=()=>null,profile='main'}){this.profile=PROFILES.includes(profile)?profile:'main';this.identity=identity;this.store=store;this.socketFactory=socket;this.fetcher=fetcher;this.replies=new Replies(SESSION,data=>this.probe('reply_parse',data),this.profile==='main');this.state='not_connected';this.error='';this.active=false;this.revoked=false;this.generation=0;this.checks=0;this.sending=false;}
 probe(event,data={}){console.log('[MuseProbe]',JSON.stringify({release:'0.3.1',profile:this.profile,event,...data}));}
 node(){return this.record?.device_id||this.identity()?.device_id||(this.record?.access_token?NODE:null);}
 sessionId(){return deviceSession(this.node());}
 health(){return {bridge:'online',muse:this.record&&!this.revoked?'paired':'unpaired',message_channel:this.session?.ready?'connected':this.state,error:this.error,transport:'rokid-phone',checks:this.checks,authorization:this.authorization()};}
 authorization(){let record=this.record;try{record=this.store.load()||record;}catch(_){}return {device_id:record?.device_id||this.identity()?.device_id||(record?.access_token?NODE:null),type:record?.token_type||'device',access_token_present:!!record?.access_token,refresh_token_present:!!record?.refresh_token,saved_at:record?.access_token_saved_at||0,expires_in:record?.expires_in||null,source:'aiui-app-storage'};}
 events(){return {messages:this.replies.snapshot(),revision:this.replies.revision,transcript:this.replies.transcript||''};}
 async api(url,bearer,data){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const r=await this.fetcher(url,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+bearer,'X-API-Version':'1.0.0','Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,signal:controller.signal,timeout:15000});this.probe('api_status',{path:new URL(url).pathname,status:r.status});if(!r.ok){const e=new Error('Muse HTTP '+r.status);e.status=r.status;throw e;}return await r.json();}finally{cancel(timer);}}
 async refresh(record,root,generation=this.generation){const raw=record.refresh_token.split(':').pop();let tokens;try{tokens=await this.api(root+'/device_token/refresh','hatch_refresh:'+raw,{device_id:this.node()});}catch(e){if(generation!==this.generation)throw new Error('Connection state has changed');if(e.status===401){this.revoked=true;throw new Error('Muse authorization expired; please pair again');}throw e;}tokens=tokens.payload||tokens;if(!tokens.access_token||!tokens.refresh_token)throw new Error('Invalid Muse token refresh response');const next={...record,...tokens,access_token_saved_at:Math.floor(Date.now()/1000)};if(generation!==this.generation){const saved=this.store.load?.();if(saved?.refresh_token===record.refresh_token&&saved?.access_token===record.access_token)this.store.save(next);throw new Error('Connection state has changed');}this.store.save(next);return next;}
 start(){if(this.active)return;this.active=true;this.revoked=false;this.connect();}
 stop(){this.voice?.end();this.active=false;this.generation++;cancel(this.retry);this.retry=undefined;if(this.session)this.session.close();this.session=null;this.state='not_connected';}
 async connect(){if(this.connecting){this.schedule();return;}this.connecting=true;const generation=++this.generation;this.state='connecting';this.error='';try{let record=this.store.load();this.record=record;if(!record?.access_token||!record?.refresh_token){this.state='unpaired';this.error='Please pair with Muse first';return;}const root=(record.api_url_v2||'https://api.muse.ai').replace(/\/+$/,'');if(!root.startsWith('https://'))throw new Error('Muse API must use HTTPS');// Validate the saved access token before rotating credentials; age alone is not expiry.
   let data;try{data=await this.api(root+'/fetch_vms',record.access_token);}catch(e){if(e.status!==401)throw e;record=await this.refresh(record,root,generation);data=await this.api(root+'/fetch_vms',record.access_token);}if(!this.active||generation!==this.generation)return;this.record=record;this.probe('authorization_verified',{vm_count:(data.vm_list||[]).length});const sid=this.sessionId();if(this.replies.sessionId!==sid)this.replies=new Replies(sid,data=>this.probe('reply_parse',data),this.profile==='main');const list=(data.vm_list||[]).filter(v=>v.vm_auth_token&&(v.vm_ws_url||v.vm_url));const vm=list.find(v=>v.default)||list[0];if(!vm)throw new Error('No cloud instance available for this Muse account');const host=record.noise_host||'hatch.metaaivm.com';if(!/^[a-z0-9.-]+$/i.test(host))throw new Error('Invalid Muse cloud address');const url='wss://'+host+'/v1/noise?vm_id='+encodeURIComponent(vm.vm_id||vm.vm_name);this.voiceTarget={root,url,vmId:vm.vm_id};const session=new CloudSession(this,url,vm.vm_auth_token);this.session=session;this.probe('websocket_connect',{host,vm_id_present:!!(vm.vm_id||vm.vm_name)});session.open();
  }catch(e){if(!this.active||generation!==this.generation)return;this.error=e.status?'Muse HTTP '+e.status:(this.revoked?'Muse authorization expired; please pair again':'Connection failed: '+(e.message||'Check the Rokid phone connection and network'));this.state=this.revoked?'unpaired':'reconnecting';this.schedule();}finally{this.connecting=false;}}
 schedule(){cancel(this.retry);if(this.active&&!this.revoked)this.retry=setTimeout(()=>{this.retry=undefined;this.connect();},5000);}
 disconnected(session,message){if(this.session!==session)return;this.session=null;this.error=message;this.state=this.revoked?'unpaired':'reconnecting';this.schedule();}
 startVoice(callbacks){
  if(!this.session?.ready||!this.voiceTarget?.vmId)throw new Error('Muse cloud is not connected');
  if(this.voice&&!this.voice.finished)throw new Error('Previous Muse call is still closing');
  const target=this.voiceTarget, generation=this.generation;
  const call=new MuseVoiceCall({...callbacks,node:this.node(),thread:this.profile==='main'?null:this.sessionId(),
   probe:(event,data)=>this.probe(event,data),
   connect:async voice=>{
    const data=await this.api(target.root+'/fetch_vms',this.record.access_token);
    if(!this.active||generation!==this.generation)throw new Error('Muse connection changed');
    const vm=data.vm_list?.find(vm=>vm.vm_id===target.vmId&&vm.vm_auth_token);
    if(!vm)throw new Error('Muse voice VM is unavailable');
    const nativeHeaders=await voiceCryptoHeaders(this.identity());
    return new CloudSession(this,target.url+'&app_id=hatch-web',vm.vm_auth_token,voice,nativeHeaders);
   }
  });
  this.voice=call;
  call.start();
  return call;
 }
 async history(cursor){
  const session=this.session;
  if(!session?.ready)throw new Error('Muse cloud is not connected');
  const sid=this.profile==='main'?null:this.sessionId();
  const limit=Number.isInteger(cursor)&&[4,8,16,32].includes(cursor)?cursor:1;
  const remoteCursor=typeof cursor==='string'?cursor:null;
  const path='/chat/history?limit='+limit+(sid?'&session_id='+encodeURIComponent(sid):'')+
   (remoteCursor?'&cursor='+encodeURIComponent(remoteCursor):'');
  const result=await session.json(path,EMPTY,[],'GET');
  const payload=result.value?.result??result.value?.payload??result.value;
  const keys=value=>Object.keys(value||{}).filter(key=>/^[a-z_]{1,40}$/i.test(key)).slice(0,15);
  const first=(Array.isArray(payload)?payload:payload?.chat_events??payload?.messages??payload?.items)?.[0];
  this.probe('history_status',{status:result.status,...responseSummary(result.body),
   result_keys:Array.isArray(payload)?[]:keys(payload),
   message_keys:keys(first), payload_keys:keys(first?.payload),
   event_kind:safeEnum(first?.event),event_type:safeEnum(first?.type),
   channel:safeEnum(payload?.channel),has_more:payload?.has_more===true});
  if(result.status<200||result.status>=300)throw new Error('Muse history HTTP '+result.status);
  const page=readHistory(result.value,sid);
  // Some VMs report more results without returning a cursor. Request a
  // bounded, progressively larger window and let the UI deduplicate IDs.
  if(!page.cursor&&!remoteCursor&&payload?.has_more===true&&limit<32)page.cursor=Math.max(4,limit*2);
  return page;
 }
 async send(message){if(typeof message!=='string'||!message.trim()||message.length>2000)throw new Error('Message is empty or too long');return this.sendBody({message,output_modality:'text'});}
 async sendBody(body){const session=this.session;if(!session?.ready)throw new Error('Muse cloud is not connected; check the Rokid phone connection and network');if(this.sending)throw new Error('The previous message is still being submitted');this.sending=true;this.replies.begin();let pending;try{pending=session.http('/chat/stream',utf8(JSON.stringify({...body,device_id:this.node(),...(this.profile==='main'?{}:{session_id:this.sessionId()})})),[['Content-Type','application/json'],['x-request-id',crypto.randomUUID()],['x-app-id',this.profile==='gadget'||this.profile==='baseline'?'musegadget':'hatch-web']]);const response=await pending.promise;this.probe('message_status',{status:pending.status,...responseSummary(pending.body)});if(pending.status<200||pending.status>=300)throw new Error('Muse rejected the message (HTTP '+pending.status+')');this.probe('message_ack',this.replies.acknowledge(response));return {accepted:true,muse_sent:true,session_id:this.sessionId()};}catch(error){if(error.message==='Muse message submission timed out')session.fail('Muse message submission timed out; reconnecting');throw error;}finally{if(pending){cancel(pending.timer);session.pending.delete(pending.id);}this.sending=false;this.replies.waiting=false;this.replies.pending=[];}}
}
export class CloudSession {
 constructor(cloud,url,token,voice=null,nativeHeaders=null){this.voice=voice;this.nativeHeaders=nativeHeaders;this.cloud=cloud;this.url=url;this.token=token;this.phase=0;this.next=1;this.ready=false;this.ended=false;this.pending=new Map();this.decoder=new Decoder();this.controlBuffer=EMPTY;this.eventBuffer=EMPTY;this.deduplicator=new EventDeduplicator();}
 open(){const socket=this.cloud.socketFactory({url:this.url,header:{Authorization:'Bearer '+this.token}});this.token='';this.socket=socket;this.deadline=setTimeout(()=>this.fail('Muse cloud connection timed out; check the Rokid phone connection and network'),45000);socket.onOpen(()=>{try{if(this.ended)return;if(this.nativeHeaders){this.openVoiceCrypto();return;}this.noise=new NoiseXX();this.phase=1;socket.send(this.noise.message1());}catch(e){this.fail('AIUI encryption handshake failed: '+e.message);}});socket.onMessage(data=>{try{if(this.ended)return;if(data&&!(data instanceof ArrayBuffer)&&!(data instanceof Uint8Array)&&data.data!==undefined)data=data.data;if(typeof data==='string')throw new Error('Muse returned an invalid protocol frame');const bytes=data instanceof Uint8Array?data:new Uint8Array(data);
 if(this.voiceCrypto){
  if(this.phase===1){this.phase=2;this.voiceCrypto.send(concat(new Uint8Array([1]),bytes));return;}
  if(this.phase!==3||bytes.length>65535)throw new Error('Invalid native voice protocol frame');
  this.voiceCrypto.send(concat(new Uint8Array([3]),bytes));return;
 }
 if(this.phase===1){this.noise.message2(bytes);socket.send(this.noise.message3());[this.sendCipher,this.recvCipher]=this.noise.split();this.noise=null;this.phase=2;this.cloud.probe('noise_established',{voice:!!this.voice});if(this.voice){cancel(this.deadline);this.voice.opened();return;}this.control=this.stream('/link-control');this.registerId=crypto.randomUUID();this.controlSend({type:'req',id:this.registerId,method:'link.register',params:{node_id:this.cloud.node(),display_name:(this.cloud.record?.display_name||'Rokid')+' · Muse AIUI',platform:'android',version:'0.4.0',device_family:'homehub',model_id:'rokid-aiui',is_wakeup_supported:false,commands_v2:{}}});return;}if(this.phase!==2||bytes.length>65535)throw new Error('Invalid Muse protocol frame');const frame=this.decoder.decode(this.recvCipher.apply(false,EMPTY,bytes));if(frame)this.receive(frame);}catch(e){this.fail('Muse protocol connection interrupted: '+e.message);}});socket.onError(error=>{
  const detail=[error?.message,error?.errMsg,String(error??'')].filter(Boolean).join(' ');
  const voiceActive=this.voice?.micStarted;
  const failure=voiceActive
   ? (/send timeout/i.test(detail)?'Voice audio upload timed out':'Voice network interrupted; check the Rokid phone connection')
   : 'Muse network connection failed; check the Rokid phone connection and network';
  this.fail(failure);
 });socket.onClose(()=>this.fail('Muse cloud connection is closed'));}
 openVoiceCrypto(){
  const local=this.cloud.socketFactory({url:'ws://127.0.0.1:18791/voice-crypto',header:this.nativeHeaders});
  this.nativeHeaders=null;
  this.voiceCrypto=local;
  const failed=()=>this.fail('Muse native voice connection failed');
  local.onError(failed);local.onClose(failed);
  local.onMessage(data=>{
   if(this.ended)return;
   try{
    const bytes=new Uint8Array(data?.data??data);
    const operation=bytes[0], payload=bytes.subarray(1);
    if(operation===1&&this.phase===0){this.phase=1;this.socket.send(payload);return;}
    if(operation===1&&this.phase===2){
     this.socket.send(payload);this.phase=3;cancel(this.deadline);
     this.cloud.probe('noise_established',{voice:true,native:true});this.voice.opened();return;
    }
    if(this.phase!==3)throw new Error('Invalid native voice handshake');
    if(operation===2)this.socket.send(payload);
    else if(operation===3){const frame=this.decoder.decode(payload);if(frame)this.receive(frame);}
    else throw new Error('Invalid native voice operation');
   }catch(error){this.fail('Muse native voice protocol interrupted: '+error.message);}
  });
 }
 encrypted(envelope){if(this.ended)throw new Error('Muse connection is closed');try{for(const chunk of chunks(envelope)){if(this.voiceCrypto)this.voiceCrypto.send(concat(new Uint8Array([2]),chunk));else this.socket.send(this.sendCipher.apply(true,EMPTY,chunk));}}catch(e){this.fail('Muse encrypted send failed');throw e;}}
 stream(path,headers=[]){const id=this.next++;this.encrypted(request(id,path,EMPTY,false,headers));return id;}
 http(path,data,headers,method='POST',timeout=65000){const d=deferred(),pending={...d,id:this.next++,status:0,body:EMPTY};this.pending.set(pending.id,pending);pending.promise.catch(()=>{});pending.timer=setTimeout(()=>pending.reject(new Error('Muse message submission timed out')),timeout);try{this.encrypted(request(pending.id,path,data,true,headers,method));this.cloud.probe('request_sent',{stream:pending.id,path:path.split('?')[0],bytes:data.length});}catch(e){cancel(pending.timer);this.pending.delete(pending.id);throw e;}return pending;}
 async json(path,data,headers,method='POST',timeout=12000){
  const pending=this.http(path,data,headers,method,timeout);
  try{return {value:await pending.promise,status:pending.status,body:pending.body};}
  finally{cancel(pending.timer);this.pending.delete(pending.id);}
 }
 controlSend(obj){const data=utf8(JSON.stringify(obj)),prefix=new Uint8Array(4);new DataView(prefix.buffer).setUint32(0,data.length,true);this.encrypted(bodyChunk(this.control,concat(prefix,data)));}
 receive(f){if(this.voice&&f.id===this.voice.streamId){this.voice.receive(f);return;}this.cloud.probe('frame_received',{stream:f.id,kind:f.kind,status:f.status||null,bytes:f.data.length,end:!!f.end});if(f.kind===5){if(f.id===this.control||f.id===this.subscribe)throw new Error('Muse reset the conversation channel');const p=this.pending.get(f.id);if(p)p.reject(new Error('Muse reset the message request'));return;}
  if(f.id===this.control){if(f.kind===3&&f.status>=400)throw new Error('Device registration HTTP '+f.status);this.controlBuffer=concat(this.controlBuffer,f.data);if(this.controlBuffer.length>4194304)throw new Error('Device message is too large');while(this.controlBuffer.length>=4){const n=new DataView(this.controlBuffer.buffer,this.controlBuffer.byteOffset,4).getUint32(0,true);if(n>4194304)throw new Error('Device message is too large');if(this.controlBuffer.length<n+4)break;const data=this.controlBuffer.slice(4,n+4);this.controlBuffer=this.controlBuffer.slice(n+4);if(n)this.handle(JSON.parse(text(data)));}if(f.end)throw new Error('Device channel ended');}
  else if(f.id===this.subscribe){if(this.subscriptionFailure){this.failureBody=concat(this.failureBody,f.data).slice(0,4096);if(f.end)this.finishSubscriptionFailure();return;}if(f.kind===3){this.cloud.probe('subscription_status',{status:f.status,path:'/chat/subscribe'});if(f.status!==200){this.subscriptionFailure=f.status;this.failureBody=f.data;this.failureTimer=setTimeout(()=>this.finishSubscriptionFailure(),2000);if(f.end)this.finishSubscriptionFailure();return;}this.ready=true;this.cloud.state='connected';this.cloud.error='';cancel(this.deadline);this.heartbeat=setInterval(()=>{try{this.encrypted(bodyChunk(this.control,new Uint8Array(4)));}catch(e){this.fail('Muse heartbeat failed');}},20000);}this.eventBuffer=concat(this.eventBuffer,f.data);if(this.eventBuffer.length>1048576)throw new Error('Reply data is too large');let start=0;for(let i=0;i<this.eventBuffer.length;i++)if(this.eventBuffer[i]===10){const line=this.eventBuffer.slice(start,i);start=i+1;if(line.length){const event=JSON.parse(text(line));if(this.deduplicator.duplicate(event,line)){this.cloud.probe('reply_duplicate',{kind:safeEnum(event.event),seq:event.seq,session_fp:fingerprint(event.payload?.session_id||event.session_id)});continue;}this.cloud.replies.feed(event);this.cloud.probe('reply_event',{kind:typeof event.event==='string'?event.event.slice(0,60):'unknown',accepted_messages:this.cloud.replies.snapshot().length});}}if(start)this.eventBuffer=this.eventBuffer.slice(start);if(f.end)throw new Error('Reply channel ended');}
  else{const p=this.pending.get(f.id);if(!p)return;if(f.kind===3){p.status=f.status;this.cloud.probe('message_headers',{status:f.status});}p.body=concat(p.body,f.data);if(p.body.length>1048576){p.reject(new Error('Muse response is too large'));return;}if(f.end){cancel(p.timer);let obj={};try{if(p.body.length)obj=JSON.parse(text(p.body));}catch(_){}p.resolve(obj);}}
 }
 handle(message){if(message.id===this.registerId&&!message.method){if(message.error)throw new Error('Muse rejected device registration');this.cloud.probe('registered');const spec=subscriptionSpec(this.cloud.profile,this.cloud.sessionId());this.subscribe=this.stream('/chat/subscribe',spec.headers);this.cloud.probe('subscription_request',{path:'/chat/subscribe',body_mode:Object.keys(spec.body).length?'session':'empty',app_id:this.cloud.profile==='baseline'?'absent':this.cloud.profile==='gadget'?'musegadget':'hatch-web'});this.encrypted(bodyChunk(this.subscribe,utf8(JSON.stringify(spec.body)),true));}if(['link.unpaired','node.unpaired'].includes(message.event)){this.cloud.revoked=true;throw new Error('Muse device pairing was removed');}if(message.method==='link.invoke')this.controlSend({method:'link.result',id:message.id,ok:false,error:{code:'unsupported',message:'Remote execution is not supported'}});}
 finishSubscriptionFailure(){cancel(this.failureTimer);this.cloud.probe('subscription_error',{status:this.subscriptionFailure,...responseSummary(this.failureBody||EMPTY)});this.fail('Reply subscription HTTP '+this.subscriptionFailure);}
 fail(message){if(this.ended)return;this.cloud.probe('session_failed',{voice:!!this.voice,reason:message.slice(0,200)});this.close();if(this.voice)this.voice.closed(message);else this.cloud.disconnected(this,message);}
 close(){if(this.ended)return;this.ended=true;this.ready=false;this.token='';cancel(this.deadline);cancel(this.failureTimer);if(this.heartbeat!==undefined)clearInterval(this.heartbeat);for(const p of this.pending.values()){cancel(p.timer);p.reject(new Error('Muse connection interrupted'));}this.pending.clear();if(this.sendCipher)this.sendCipher.destroy();if(this.recvCipher)this.recvCipher.destroy();try{this.voiceCrypto?.close();}catch(_){}this.voiceCrypto=null;this.nativeHeaders=null;try{this.socket?.close();}catch(_){}this.socket=null;}
}

// The documented endpoint returns the current chat by default. A side-chat
// response must identify its scope before any of its text can be rendered.
export function readHistory(value,sessionId){
 const result=value?.result??value?.payload??value;
 const rows=Array.isArray(result)?result:result?.chat_events??result?.messages??result?.items;
 if(value?.ok===false||!Array.isArray(rows))throw new Error('Muse history response format is unsupported');
 const scope=result?.session_id??value?.session_id;
 if(sessionId&&((scope&&scope!==sessionId)||rows.some(row=>(row?.payload?.session_id||row?.session_id||scope)!==sessionId))){
  throw new Error('Muse did not confirm the requested history session');
 }
 const messages=new Map();
 const recentRows=rows.slice(0,100);
 if(recentRows.every(row=>Number.isFinite(row?.occurred_at_ms))){
  recentRows.sort((a,b)=>a.occurred_at_ms-b.occurred_at_ms);
 }
 for(const row of recentRows){
  if(!row||typeof row!=='object')continue;
  const event=row.event_name??row.event??row.type;
  const message=row.payload??row;
  const role=event==='message.user'?'user':event==='message.assistant'||event==='delta.message_done'?'assistant':row.role??message.role;
  const id=row.message_id??message.message_id??message.id;
  const content=row.display_text||message.display_text||message.text||message.content;
  if(typeof id==='string'&&id.length<=200&&typeof content==='string'&&content&&['user','assistant'].includes(role)&&(row.display_text_ready??message.display_text_ready)!==false){
   messages.set(id,{id,role,text:displayMessage(content).slice(0,12000),done:true});
  }
 }
 const cursor=result?.next_cursor;
 return {messages:[...messages.values()],cursor:typeof cursor==='string'&&cursor.length<=512?cursor:null};
}
