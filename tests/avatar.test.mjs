import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {createPixelAvatar,AVATAR_MODES} from '../lib/muse-avatar.js';
import {mt} from '../lib/muse-i18n.js';
import {avatarState,newTurnReplies,pcmLevel} from '../lib/muse-avatar-state.js';

// Independent oracle was rendered by the upstream C implementation, not JS.
const reference=JSON.parse(readFileSync(new URL('./avatar-c-reference.json',import.meta.url)));
test('procedural renderer matches upstream C in 418 of 420 frames; reuses framebuffer',()=>{
  const avatar=createPixelAvatar();let buffer,exact=0;
  for(let mode=0;mode<7;mode++)for(let i=0;i<60;i++){
    const n=mode*60+i;
    const frame=avatar.render({mode:AVATAR_MODES[mode],t:n*.04,modeTime:i*.04,level:.5});
    if(buffer)assert.equal(frame,buffer);buffer=frame;
    assert.equal(frame.length,4096);
    assert.ok(frame.every(pixel=>pixel<29));
    if(reference.frames[n].boundaryTolerance){
      const original=Buffer.from(reference.frames[n].referenceIndices,'base64');
      const differences=frame.reduce((sum,value,index)=>sum+(value!==original[index]),0);
      assert.ok(differences<=reference.frames[n].boundaryTolerance,`time boundary frame ${n}`);
      continue;
    }
    assert.equal(createHash('sha256').update(frame).digest('hex'),reference.frames[n].hash,`${AVATAR_MODES[mode]} frame ${i}`);
    exact++;
  }
  assert.equal(exact,418);
});
test('green RGBA output is sharp at integer scale and contains transparent background',()=>{
  const avatar=createPixelAvatar();avatar.render({mode:'idle',t:2,modeTime:2});
  const bytes=new Uint8Array(128*128*4);assert.equal(avatar.writeRGBA(bytes,128),bytes);
  let transparent=0,visible=0;
  for(let y=0;y<128;y+=2)for(let x=0;x<128;x+=2){
    const i=(y*128+x)*4;
    assert.deepEqual(bytes.slice(i,i+4),bytes.slice(i+4,i+8));
    if(bytes[i+3]){visible++;assert.ok(bytes[i+1]>=bytes[i]&&bytes[i+1]>=bytes[i+2]);}else transparent++;
  }
  assert.ok(visible>1000&&transparent>1000);
});
test('pet reaction changes the pose; independent instances retain independent clocks',()=>{
  const a=createPixelAvatar(),b=createPixelAvatar();
  const normal=a.render({mode:'idle',t:2,modeTime:2}).slice();
  assert.deepEqual(b.render({mode:'idle',t:2,modeTime:2}),normal);
  assert.notDeepEqual(a.render({mode:'idle',t:2,modeTime:2,happy:1}),normal);
});
test('state never claims speech playback for text streaming or a delivery receipt',()=>{
  const online={channelReady:true,museReady:true};
  assert.equal(avatarState(online,500,0).mode,'boot');
  assert.equal(avatarState({...online,listening:true},2000,0).mode,'listening');
  assert.equal(avatarState({...online,awaitingReply:true},2000,0).mode,'thinking');
  assert.equal(avatarState({...online,awaitingReply:true,replyStreaming:true},2000,0).label,'Replying');
  assert.equal(avatarState(online,2000,0).mode,'idle');
  assert.equal(avatarState(online,2000,0,3000).mode,'error');
  assert.equal(avatarState({channelReady:false},2000,0).mode,'error');
  assert.deepEqual(newTurnReplies([{id:'old',text:'旧回复',done:true}],new Map([['old','旧回复']])),[]);
});
test('PCM volume handles silence, signed samples and odd/truncated frames',()=>{
  assert.equal(pcmLevel(new ArrayBuffer(32)),0);
  const pcm=new ArrayBuffer(33),view=new DataView(pcm);
  view.setInt16(0,-32768,true);view.setInt16(16,32767,true);
  assert.equal(pcmLevel(pcm),1);
  assert.equal(pcmLevel(new ArrayBuffer(1)),0);
});

function pageHarness(requestBridge){
  let source=readFileSync(new URL('../pages/index/index.js',import.meta.url),'utf8');
  source=source.replace(/^import .*;\n/gm,'').replace('export default {','globalThis.definition={');
  const timers=new Map();let next=0;
  const sandbox={mt,avatarState,newTurnReplies,createPixelAvatar,requestBridge,
    stopMuse(){},LONG_PRESS_MENU_MS:700,wx:{},navigator:{},console:{log(){}},Date,Map,SpeechRecognitionSession:undefined,
    setTimeout(fn){const id=++next;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}};
  vm.runInNewContext(source,sandbox);
  const page={...sandbox.definition,data:structuredClone(sandbox.definition.data),_active:true,_replyBaseline:new Map(),
    setData(patch){Object.assign(this.data,patch);}};
  return {page,timers};
}
test('delivery acknowledgement preserves waiting; only a new cloud reply completes the turn',async()=>{
  const {page}=pageHarness(async()=>({muse_sent:true}));
  page.data.messages=[{id:'old',text:'上一轮',done:true}];
  page.data.conversation=[{id:'old',role:'assistant',text:'上一轮',done:true}];
  page.data.draft='新问题';
  await page.sendMessage();
  assert.equal(page.data.awaitingReply,true);assert.equal(page.data.sending,false);
  page.updateReplies([{id:'old',text:'上一轮',done:true}]);
  assert.equal(page.data.awaitingReply,true);
  page.updateReplies([{id:'old',text:'上一轮',done:true},{id:'new',text:'新回复',done:false}]);
  assert.equal(page.data.awaitingReply,true);assert.equal(page.data.replyStreaming,true);
  page.updateReplies([{id:'old',text:'上一轮',done:true},{id:'new',text:'新回复完成',done:true}]);
  assert.equal(page.data.awaitingReply,false);
  assert.deepEqual(Array.from(page.data.conversation,item=>item.role),['assistant','user','assistant']);
});
test('failed send preserves draft, removes unsubmitted chat row and ends waiting',async()=>{
  const {page}=pageHarness(async()=>{throw new Error('offline');});page.data.draft='保留问题';
  await page.sendMessage();
  assert.equal(page.data.draft,'保留问题');assert.equal(page.data.awaitingReply,false);
  assert.equal(page.data.conversation.length,0);assert.ok(page._avatarErrorUntil>Date.now());
});
test('hiding the page cancels drawing and polling timers',()=>{
  const {page,timers}=pageHarness(async()=>({}));
  page._avatarTimer=1;page._pollTimer=2;timers.set(1,()=>{});timers.set(2,()=>{});
  page.onHide();assert.equal(page._active,false);assert.equal(timers.size,0);
});

test('direction keys scroll chat instead of selecting toolbar actions and stop at bounds',()=>{
  const {page}=pageHarness(async()=>({}));
  page.data.conversation=[{id:'long',role:'assistant',text:'长回复'.repeat(200),done:true}];
  page.refreshActions();let prevented=0;
  const key=code=>page.onKeyUp({code,preventDefault(){prevented++;}});
  key('ArrowDown');assert.equal(page.data.scrollTop,100);assert.equal(page.data.focus,0);
  key('ArrowUp');assert.equal(page.data.scrollTop,0);
  key('ArrowUp');assert.equal(page.data.scrollTop,0);
  for(let i=0;i<50;i++)key('ArrowDown');
  const bottom=page.data.scrollTop;key('ArrowDown');assert.equal(page.data.scrollTop,bottom);
  key('ArrowUp');assert.equal(page.data.scrollTop,bottom-100);assert.ok(prevented>0);
});
test('idle toolbar shows no voice button; recording and draft retain their controls',()=>{
  const {page}=pageHarness(async()=>({}));
  assert.equal(page.data.surface,'chat');page.refreshActions();
  assert.deepEqual(Array.from(page.data.actions,action=>action.id),[]);
  page.data.draft='问题';page.refreshActions();
  assert.deepEqual(Array.from(page.data.actions,action=>action.id),['send','voice','clear']);
  page.data.listening=true;page.refreshActions();
  assert.deepEqual(Array.from(page.data.actions,action=>action.id),['stopVoice','cancelVoice']);
});

test('connection icons distinguish online, retrying, unpaired and unavailable service',async()=>{
  for(const [channel,muse,expected] of [['connected','paired','online'],['connecting','paired','connecting'],['reconnecting','paired','connecting'],['unpaired','unpaired','offline'],['not_connected','paired','offline']]){
    const {page}=pageHarness(async()=>({bridge:'online',muse,message_channel:channel}));
    await page.checkConnection();assert.equal(page.data.connectionState,expected);
  }
  const {page}=pageHarness(async()=>{throw new Error('offline');});
  await page.checkConnection();assert.equal(page.data.connectionState,'offline');
});


test('draft toolbar supports directional focus wrapping and confirms the selected action',()=>{
  const {page,timers}=pageHarness(async()=>({}));page.data.draft='问题';page.refreshActions();
  const key=code=>page.onKeyUp({code,preventDefault(){}});
  key('ArrowDown');assert.equal(page.data.focus,1);assert.equal(page.data.scrollTop,0);
  key('ArrowDown');assert.equal(page.data.focus,2);
  key('ArrowDown');assert.equal(page.data.focus,0);
  key('ArrowUp');assert.equal(page.data.focus,2);
  page.onKeyDown({code:'Enter'});key('Enter');
  for(const timer of [...timers.values()])timer();
  assert.equal(page.data.draft,'');assert.deepEqual(Array.from(page.data.actions,action=>action.id),[]);
});
test('recording toolbar confirms cancel when selected rather than always stopping',()=>{
  const {page}=pageHarness(async()=>({}));let aborted=0;
  page._recognition={abort(){aborted++;}};page.data.listening=true;page.refreshActions();
  page.onKeyUp({code:'ArrowDown',preventDefault(){}});assert.equal(page.data.focus,1);
  page.onKeyDown({code:'Enter'});page.onKeyUp({code:'Enter',preventDefault(){}});
  assert.equal(aborted,1);assert.equal(page.data.listening,false);
});
test('moving toolbar focus cancels a pending single-tap confirmation',()=>{
  const {page,timers}=pageHarness(async()=>({}));page.data.draft='问题';page.refreshActions();
  page.onKeyDown({code:'Enter'});page.onKeyUp({code:'Enter',preventDefault(){}});
  assert.ok(timers.size>0);
  page.onKeyUp({code:'ArrowDown',preventDefault(){}});
  assert.equal(timers.size,0);assert.equal(page.data.focus,1);assert.equal(page.data.draft,'问题');
});

test('waiting avatar expands after send and shrinks on the first new nonempty reply',async()=>{
  const {page}=pageHarness(async()=>({muse_sent:true}));
  page.data.messages=[{id:'old',text:'之前回复',done:true}];page.data.draft='新问题';
  await page.sendMessage();assert.equal(page.data.avatarExpanded,true);
  assert.match(page.data.scrollIntoView,/^user-/);
  page.updateReplies([{id:'old',text:'之前回复',done:true},{id:'new',text:'',done:false}]);
  assert.equal(page.data.avatarExpanded,true);
  page.updateReplies([{id:'old',text:'之前回复',done:true},{id:'new',text:'第一段',done:false}]);
  assert.equal(page.data.avatarExpanded,false);assert.equal(page.data.awaitingReply,true);
  assert.equal(page.data.scrollIntoView,'new');
  page.updateReplies([{id:'new',text:'第一段，第二段',done:false}]);assert.equal(page.data.avatarExpanded,false);
});
test('failed send restores the small avatar and clears its removed scroll target',async()=>{
  const {page}=pageHarness(async()=>{throw new Error('network');});page.data.draft='问题';
  await page.sendMessage();assert.equal(page.data.avatarExpanded,false);assert.equal(page.data.scrollIntoView,'');
});

test('waiting and reply draw into the same surface with the original RGB palette',()=>{
  const {page}=pageHarness(async()=>({}));let frames=0;
  const avatar=createPixelAvatar();page._avatar=avatar;page._avatarStartedAt=Date.now()-5000;page._avatarMode='thinking';page._avatarModeAt=Date.now();page._replyStartedAt=Date.now();
  const image={data:new Uint8Array(192*192*4)};page._avatarImage=image;
  page._avatarContext={putImageData(frame){assert.equal(frame,image);frames++;}};
  const write=avatar.writeRGBA;
  avatar.writeRGBA=(bytes,size,green)=>{assert.equal(bytes,image.data);assert.equal(size,192);assert.equal(green,false);return write(bytes,size,green);};
  page.data.channelReady=true;page.data.awaitingReply=true;page.data.avatarExpanded=true;
  page.drawAvatar();page.drawAvatar();
  assert.equal(frames,2);
  assert.ok(image.data.some((value,index)=>index%4===0&&value>image.data[index+1]),'original palette includes colors beyond green');
  page.updateReplies([{id:'first',text:'回复',done:false}]);page.drawAvatar();
  assert.equal(page.data.avatarExpanded,false);assert.equal(frames,3);assert.equal(page._avatarImage,image);
  const template=readFileSync(new URL('../pages/index/index.wxml',import.meta.url),'utf8');
  assert.equal((template.match(/<canvas /g)||[]).length,1);
  assert.ok(!template.includes('avatar-hidden'));
});

test('large avatar persists from recorder start through confirmation, send and first reply',async()=>{
  const {page}=pageHarness(async()=>({muse_sent:true}));
  const recorder={start(){},stop(){},abort(){}};page._recognition=recorder;page.setupVoice();
  page.startVoice();assert.equal(page.data.avatarExpanded,true);
  recorder.onstart();assert.equal(page.data.listening,true);assert.equal(page.data.avatarExpanded,true);
  page.stopVoice();recorder.onstopping();assert.equal(page.data.avatarExpanded,true);
  recorder.onrecorded({duration:1,pcm_base64:'AAAA'});recorder.onend();
  assert.equal(page.data.recognizing,false);assert.equal(page.data.avatarExpanded,true);
  page.updateReplies([{id:'old',text:'旧回复',done:true}]);assert.equal(page.data.avatarExpanded,true);
  await page.sendMessage();assert.equal(page.data.avatarExpanded,true);
  page.updateReplies([{id:'new',text:'',done:false}]);assert.equal(page.data.avatarExpanded,true);
  page.updateReplies([{id:'new',text:'开始回复',done:false}]);assert.equal(page.data.avatarExpanded,false);
});
test('cancel, discard and recording failure restore small avatar',()=>{
  for(const action of ['cancelVoice','clear','back','error']){
    const {page}=pageHarness(async()=>({}));page._recognition={start(){},stop(){},abort(){}};page.setupVoice();page.startVoice();
    if(action==='error'){page._recognition.onerror({error:'failure'});page._recognition.onend();}
    else if(action==='cancelVoice')page.cancelVoice();
    else{page._recognition.onrecorded({duration:1,pcm_base64:'AAAA'});page._recognition.onend();if(action==='back')page.goBack();else page.runAction('clear');}
    assert.equal(page.data.avatarExpanded,false,action);
  }
});
