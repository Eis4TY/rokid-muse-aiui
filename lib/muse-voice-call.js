// Realtime voice protocol and reply lineage follow Muse Gadget SDK (Apache-2.0).
import {EMPTY, concat, utf8} from './muse-noise.js';
import {bodyChunk} from './muse-wire.js';
import {decodeBase64} from './muse-audio.js';

const FRAME_MS=40, MIC_BYTES=1280, VOICE_BYTES=1920, MAX_PCM=240000;
const CLOUD_VOICE_EVENTS=new Set([
 'input_audio_buffer.speech_started','input_audio_buffer.speech_stopped',
 'input_audio_buffer.committed','conversation.item.input_audio_transcription.completed',
 'conversation.item.input_audio_transcription.failed','hatch.voice.input_suppressed',
 'hatch.voice.turn_started','hatch.voice.turn_settled','response.created','response.done','response.completed'
]);
const JSON_HEADERS=[['Content-Type','application/json']];
function audiblePCM(pcm){
 const samples=new DataView(pcm.buffer,pcm.byteOffset,pcm.byteLength);
 let sum=0;
 for(let offset=0;offset<pcm.length;offset+=2){const sample=samples.getInt16(offset,true);sum+=sample*sample;}
 return sum>=pcm.length/2*300*300;
}
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!value.includes('\0')?value:null;

// 640 mono samples at 16 kHz become 960 at 24 kHz. Each input
// frame ends on the same resampling phase, including silent frames.
export function voicePCM(input){
 const source=new DataView(input.buffer,input.byteOffset,MIC_BYTES);
 const pcm=new Uint8Array(VOICE_BYTES), output=new DataView(pcm.buffer);
 for(let i=0;i<960;i++){
  const pos=i*2, at=Math.floor(pos/3), mix=pos%3;
  const first=source.getInt16(at*2,true), next=source.getInt16(Math.min(at+1,639)*2,true);
  output.setInt16(i*2,Math.round(((3-mix)*first+mix*next)/3),true);
 }
 return pcm;
}
function replyPCM(event){
 let encoded;
 if(event.type==='continuous_audio_video.delta'){
  const audio=event.audio_delta;
  if(!audio)return null;
  if((audio.format&&(audio.format.rate!==24000||!['audio/pcm','',undefined].includes(audio.format.type)))||
     (audio.num_channels??1)!==1)throw new Error('Unsupported Muse audio format');
  encoded=audio.audio_frames;
 }else if(['response.output_audio.delta','response.audio.delta'].includes(event.type)){
  encoded=event.delta;
 }else return null;
 if(typeof encoded!=='string'||encoded.length>256000||encoded.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)){
  throw new Error('Invalid Muse audio frame');
 }
 const pcm=decodeBase64(encoded);
 if(pcm.length%2)throw new Error('Invalid Muse PCM length');
 return pcm;
}

export class MuseVoiceCall {
 constructor({node,thread,connect,onReady,onAudio,onFlush,onEnd,onInputStatus,encode,probe}){
  Object.assign(this,{node,thread,connect,onReady,onAudio,onFlush,onEnd,onInputStatus,encode,probe});
  this.id=crypto.randomUUID();
  this.input=EMPTY;
  this.buffer=EMPTY;
  this.provider=new Map();
  this.inputIds=new Set();
  this.turns=new Map();
  this.started=Date.now();
  this.activity=this.started;
  this.playingUntil=0;
  this.pendingPCM=EMPTY;
  this.timer=setInterval(()=>{try{this.tick();}catch(error){this.end(error);}},10);
 }
 async start(){
  try{const session=await this.connect(this);if(this.ending){session.close();return;}this.session=session;session.open();}
  catch(error){this.end(error);}
 }
 opened(){
  this.streamId=this.session.stream('/voice/realtime?call_id='+encodeURIComponent(this.id),
    [['Content-Type','application/x-ndjson; charset=utf-8']]);
  this.admissionSent=true;
  this.send({type:'hatch.voice.call.start',call_id:this.id,device:'mcu-wearable',
    device_id:this.node,call_media_type:'audio',proactive_greeting_enabled:false,
    ...(this.thread?{thread_id:this.thread}:{})});
  this.send({type:'hatch.voice.capability.offer',end_call_stop:1});
 }
 send(event){this.session.encrypted(bodyChunk(this.streamId,utf8(JSON.stringify(event)+'\n')));}
 receive(frame){
  if(this.ending||this.remoteEnded)return;
  try{
   if(frame.kind===5)throw new Error('Muse reset the voice stream');
   if(frame.kind===3){
    this.probe('voice_http',{status:frame.status});
    if(frame.status<200||frame.status>=300)throw new Error('Muse voice HTTP '+frame.status);
    this.accepted=true;
   }
   this.buffer=concat(this.buffer,frame.data);
   let start=0;
   for(let i=0;i<this.buffer.length;i++){
    if(this.buffer[i]!==10)continue;
    if(i-start>1048576)throw new Error('Muse voice record is too large');
    if(i>start)this.event(JSON.parse(new TextDecoder().decode(this.buffer.slice(start,i))));
    start=i+1;
    if(this.ending||this.remoteEnded)return;
   }
   this.buffer=this.buffer.slice(start);
   if(this.buffer.length>1048576)throw new Error('Muse voice record is too large');
   if(frame.end){
    if(this.buffer.length)this.event(JSON.parse(new TextDecoder().decode(this.buffer)));
    if(!this.ready)throw new Error('Muse voice closed before admission');
    this.remoteEnded=true;
   }
  }catch(error){this.end(error);}
 }
 event(event){
  const type=event.type;
  if(CLOUD_VOICE_EVENTS.has(type))this.probe('voice_cloud_event',{type});
  if(type==='error'){
   if(!this.ready||event.error?.code==='session_dead')throw new Error('Muse voice session rejected or expired');
   this.probe('voice_advisory');
   return;
  }
  if(type==='hatch.voice.session'){
   if(!this.accepted||this.ready||event.call_id!==this.id||!identifier(event.session_id)||
      (this.thread&&this.thread!==event.thread_id)||(event.thread_id!=null&&!identifier(event.thread_id))){
    throw new Error('Muse voice admission identity mismatch');
   }
   this.ready=true;
   this.thread=event.thread_id||null;
   this.activity=Date.now();
   this.probe('voice_ready');
   this.onReady();
   return;
  }
  if(type==='hatch.voice.switch_input_hold'){
   if(typeof event.held!=='boolean')throw new Error('Invalid Muse voice hold');
   if(event.held!==this.held)this.input=EMPTY;
   this.held=event.held;
  }
  if(type==='input_audio_buffer.speech_started'){
   const item=identifier(event.item_id);
   if(item&&this.inputIds.has(item))return;
   if(this.inputIds.size>=128)throw new Error('Too many voice inputs');
   if(item)this.inputIds.add(item);
   this.activity=Date.now();
   this.interrupt(item);
   this.onInputStatus?.('cloud');
  }
  if(type==='input_audio_buffer.speech_stopped')this.onInputStatus?.('waiting');
  if(type==='conversation.item.input_audio_transcription.failed')this.onInputStatus?.('failed');
  if(type==='hatch.voice.turn_started'||type==='hatch.voice.turn_settled'){
   const item=identifier(event.item_id), submission=identifier(event.submission_message_id);
   if(!item||!submission)return;
   if(type==='hatch.voice.turn_settled'){
    const turn=this.turns.get(submission);
    if(turn?.item===item&&turn.active){turn.active=false;this.activity=Date.now();}
    return;
   }
   if(this.turns.has(submission))return;
   if(this.turns.size>=1024)throw new Error('Too many Muse voice turns');
   if([...this.turns.values()].filter(turn=>turn.active).length>=64)throw new Error('Too many active Muse voice turns');
   this.turns.set(submission,{item,active:true});
   if(this.item===item){
    this.turnFresh=![...this.provider.values()].some(state=>state==='waiting'||state==='playing'||state==='continuing');
    this.confirmed=true;
    this.blocked=false;
    for(const [id,state] of this.provider)if(state==='waiting'||state==='continuing')this.provider.set(id,'playing');
    if(this.pendingPCM.length)this.play(this.pendingPCM);
    this.pendingPCM=EMPTY;
   }else if(this.fenced&&this.item){
    this.blocked=true;
    this.turnFresh=false;
    this.pendingPCM=EMPTY;
    let flush=false;
    for(const [id,state] of this.provider){
     if(state==='continuing')flush=true;
     if(state==='waiting'||state==='continuing')this.provider.set(id,'stale');
    }
    if(flush)this.flush();
   }
  }
  if(type==='hatch.voice.input_suppressed'&&this.item&&event.item_id===this.item)this.interrupt(null);
  if(['response.created','response.done','response.completed'].includes(type)){
   const id=identifier(event.response?.id);
   if(type==='response.created')this.response=id;
   else if(id===this.response)this.response=null;
   this.activity=Date.now();
  }
  if(type==='conversation.item.added'&&event.item?.type==='session_control'&&
     event.item?.name?.trim?.().toLowerCase()==='stop'&&identifier(event.item.call_id)){
   if(!this.ready)throw new Error('Muse voice stopped before admission');
   this.remoteEnded=true;
   return;
  }
  const pcm=replyPCM(event);
  if(!pcm?.length)return;
  const audible=pcm.some(byte=>byte!==0);
  if(!this.ready){if(audible)throw new Error('Muse audio arrived before admission');return;}
  const id=type==='continuous_audio_video.delta'?identifier(event.response_id):null;
  let state=id?this.provider.get(id):this.fenced?'stale':'playing';
  if(!state){
   if(this.provider.size>=128)throw new Error('Too many Muse voice responses');
   state='playing';
   if(this.fenced){
    if(!this.item||this.blocked)state='stale';
    else if(!this.confirmed)state='waiting';
    else{
     let flush=false;
     for(const [key,previous] of this.provider)if(previous==='playing'||previous==='continuing'){
      this.provider.set(key,'stale');
      flush=true;
     }
     if(flush)this.flush();
     state=this.turnFresh?'playing':'continuing';
     this.turnFresh=false;
    }
   }
   if(state==='waiting'){
    for(const [key,previous] of this.provider)if(previous==='waiting')this.provider.set(key,'stale');
    this.pendingPCM=EMPTY;
   }
   this.provider.set(id,state);
  }
  if(!audible&&!this.playingUntil&&!this.pendingPCM.length)return;
  if(state==='playing'||state==='continuing')this.play(pcm);
  if(state==='waiting'){
   if(this.pendingPCM.length+pcm.length>MAX_PCM)throw new Error('Muse voice reply buffer is full');
   this.pendingPCM=concat(this.pendingPCM,pcm);
  }
 }
 play(pcm){
  const now=Date.now(), until=Math.max(this.playingUntil,now)+pcm.length/48;
  if(until-now>5000)throw new Error('Muse voice playback fell behind');
  if(audiblePCM(pcm)){this.activity=now;this.micMutedUntil=until+200;this.input=EMPTY;}
  else if(now<this.micMutedUntil)this.micMutedUntil=until+200;
  this.playingUntil=until;
  this.onAudio(pcm);
  if(!this.playbackStarted){this.playbackStarted=true;this.probe('voice_playback_started');}
 }
 flush(){this.playingUntil=0;this.micMutedUntil=0;this.input=EMPTY;this.onFlush();}
 interrupt(item){
  this.item=item;
  this.fenced=true;
  this.confirmed=false;
  this.blocked=false;
  this.turnFresh=false;
  this.pendingPCM=EMPTY;
  for(const id of this.provider.keys())this.provider.set(id,'stale');
  this.response=null;
  this.flush();
 }
 bargeIn(){
  if(!this.ready||this.ending||this.remoteEnded)return;
  const response=this.response;
  try{
   this.interrupt(null);
   if(response)this.send({type:'response.cancel',response_id:response});
  }catch(error){this.end(error);}
 }
 gated(){return this.ending||!this.ready||this.held||this.remoteEnded||Date.now()<this.micMutedUntil;}
 capture(buffer){
  if(this.gated())return;
  const bytes=new Uint8Array(buffer), max=MIC_BYTES*8;
  this.input=concat(this.input,bytes.slice(Math.max(0,bytes.length-max))).slice(-max);
 }
 tick(){
  const now=Date.now();
  if(this.remoteEnded){if(now>=this.playingUntil)this.end();return;}
  if(now-this.started>=300000){this.end();return;}
  if(!this.ready){if(now-this.started>=35000)this.end(new Error('Muse voice admission timed out'));return;}
  if(now-this.activity>=45000&&![...this.turns.values()].some(turn=>turn.active)){this.end();return;}
  if(this.gated()){this.input=EMPTY;this.nextFrameAt=0;return;}
  if(now<(this.nextFrameAt||0))return;
  if(this.input.length<MIC_BYTES)return;
  const pcm=voicePCM(this.input);
  this.input=this.input.slice(MIC_BYTES);
  this.send({type:'input_audio_buffer.append',audio:this.encode(pcm),send_timestamp_ms:now});
  this.nextFrameAt=Math.max((this.nextFrameAt||now)+FRAME_MS,now+FRAME_MS/2);
  this.uploadedFrames=(this.uploadedFrames||0)+1;
  if(!this.micStarted){this.micStarted=true;this.probe('voice_mic_started');}
  if(audiblePCM(pcm)){
   this.activity=now;
   if(!this.speechDetected){
    this.speechDetected=true;
    this.probe('voice_mic_activity');
    this.onInputStatus?.('local');
   }
  }
 }
 closed(message){
  if(this.ending)return;
  if(!this.ready&&!this.accepted&&!this.retried&&Date.now()-this.started<25000){
   this.retried=true;
   this.admissionSent=false;
   this.streamId=undefined;
   this.buffer=EMPTY;
   this.id=crypto.randomUUID();
   this.probe('voice_connect_retry');
   this.retryTimer=setTimeout(()=>{if(!this.ending)void this.start();},700);
   return;
  }
  this.end(new Error(message));
 }
 async end(error){
  if(this.ending)return;
  this.ending=true;
  clearInterval(this.timer);
  if(this.retryTimer!=null)clearTimeout(this.retryTimer);
  this.input=EMPTY;
  this.pendingPCM=EMPTY;
  try{this.flush();}catch(flushError){error=error||flushError;}
  // Release microphone and playback immediately, while the socket is still
  // available for the bounded end-call request.
  this.probe('voice_local_end',{uploaded_frames:this.uploadedFrames||0,error:!!error});
  try{this.onEnd(error);}catch(cleanupError){this.probe('voice_local_cleanup_failed',{name:cleanupError?.name||'Error'});}
  try{
   if(this.admissionSent&&!this.session.ended){
    const body={call_id:this.id,call_started_at:new Date(this.started).toISOString(),
      call_ended_at:new Date(Math.max(Date.now(),this.started+1)).toISOString(),
      ...(this.thread?{thread_id:this.thread}:{})};
    const {status,value}=await this.session.json('/voice/end-call',utf8(JSON.stringify(body)),JSON_HEADERS,'POST',10000);
    this.probe('voice_end',{status,acknowledged:status>=200&&status<300&&value?.ok===true&&value?.result?.ok===true});
   }
  }catch(_){this.probe('voice_end_unconfirmed');}
  finally{this.session?.close();this.finished=true;}
 }
}
