import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudSession,MuseCloud,readHistory} from '../lib/muse-cloud.js';
import {MuseVoiceCall,voicePCM} from '../lib/muse-voice-call.js';
import {parse} from '../lib/muse-wire.js';
import {utf8} from '../lib/muse-noise.js';

const decode=new TextDecoder();
const empty=new Uint8Array();

test('history uses GET with an empty body and ends the request stream',async()=>{
  const cloud=new MuseCloud({store:{},socket(){},profile:'main'});
  const session=new CloudSession(cloud,'wss://example.test','');
  cloud.session=session;
  session.ready=true;
  session.encrypted=bytes=>{
    const envelope=parse(parse(bytes)[0].data);
    const fields=parse(envelope.find(field=>field.f===2).data);
    const value=key=>decode.decode(fields.find(field=>field.f===key)?.data);
    assert.equal(value(1),'GET');
    assert.equal(value(2),'/chat/history?limit=1&cursor=older%2Bpage');
    assert.equal(fields.find(field=>field.f===4),undefined);
    assert.equal(fields.find(field=>field.f===5).n,1n);
    session.receive({id:1,kind:3,status:200,end:true,data:utf8(JSON.stringify({
      ok:true,result:{messages:[{id:'a',role:'assistant',text:'Previous answer'}],next_cursor:'next'}
    }))});
  };
  assert.deepEqual(await cloud.history('older+page'),{
    messages:[{id:'a',role:'assistant',text:'Previous answer',done:true}],cursor:'next'
  });
  assert.equal(session.pending.size,0);
});

test('side history requires matching session scope and renders only conversational rows',()=>{
  const user={id:'u',role:'user',text:'Question'};
  assert.throws(()=>readHistory({messages:[user]},'glasses'),/requested history session/);
  assert.throws(()=>readHistory({session_id:'glasses',messages:[{...user,session_id:'other'}]},'glasses'),/requested history session/);
  assert.deepEqual(readHistory({session_id:'glasses',messages:[user,{id:'r',role:'tool',text:'Receipt'}]},'glasses').messages,[
    {...user,done:true}
  ]);
});

test('call gates capture on HTTP admission, drops interrupted audio, and closes its own stream',async()=>{
  const frames=[], played=[], ended=[], probes=[];
  const session={
    stream(path){assert.match(path,/^\/voice\/realtime\?call_id=/);return 7;},
    encrypted(bytes){
      const envelope=parse(parse(bytes)[0].data);
      const chunk=parse(envelope.find(field=>field.f===4).data);
      frames.push(JSON.parse(decode.decode(chunk[0].data)));
    },
    async json(path,bytes){
      assert.equal(path,'/voice/end-call');
      const body=JSON.parse(decode.decode(bytes));
      assert.equal(body.call_id,call.id);
      assert.equal(body.thread_id,'side');
      return {status:200,value:{ok:true,result:{ok:true}}};
    },
    close(){this.ended=true;}
  };
  const call=new MuseVoiceCall({node:'glasses',thread:'side',onReady(){},
    onAudio:pcm=>played.push(pcm),onFlush(){},onEnd:error=>ended.push(error),
    encode:pcm=>Buffer.from(pcm).toString('base64'),probe:(event,data)=>probes.push({event,data})});
  call.session=session;
  try{
    call.opened();
    call.tick();
    assert.deepEqual(frames.map(frame=>frame.type),['hatch.voice.call.start','hatch.voice.capability.offer']);
    call.receive({kind:3,status:200,data:empty,end:false});
    const record=(obj)=>utf8(JSON.stringify(obj)+'\n');
    const ready=record({type:'hatch.voice.session',call_id:call.id,session_id:'s',thread_id:'side'});
    call.receive({kind:4,data:ready.slice(0,25),end:false});
    assert.equal(call.ready,undefined);
    call.receive({kind:4,data:ready.slice(25),end:false});
    const mic=new Int16Array(640).fill(1600);
    call.capture(mic.buffer);
    call.tick();
    assert.equal(frames.at(-1).type,'input_audio_buffer.append');
    assert.equal(Buffer.from(frames.at(-1).audio,'base64').length,1920);
    assert.ok(new Int16Array(voicePCM(new Uint8Array(mic.buffer)).buffer).every(value=>value===1600));

    const audio=id=>({type:'continuous_audio_video.delta',response_id:id,audio_delta:{
      format:{rate:24000,type:'audio/pcm'},audio_frames:Buffer.from([0,32,0,32]).toString('base64')
    }});
    call.event(audio('old'));
    call.event({type:'response.created',response:{id:'mapper'}});
    call.bargeIn();
    assert.equal(frames.at(-1).response_id,'mapper');
    call.event(audio('old'));
    call.event({type:'input_audio_buffer.speech_started',item_id:'speech'});
    call.event(audio('new'));
    assert.equal(played.length,1);
    call.event({type:'hatch.voice.turn_started',item_id:'speech',submission_message_id:'submission'});
    assert.equal(played.length,2);
    call.event(audio('old'));
    assert.equal(played.length,2);
  }finally{await call.end();}
  assert.equal(session.ended,true);
  assert.deepEqual(ended,[undefined]);
  assert.equal(probes.find(entry=>entry.event==='voice_end').data.acknowledged,true);
});

test('voice refusal does not start recording and closes the dedicated connection',async()=>{
  const errors=[];
  const call=new MuseVoiceCall({onReady(){assert.fail('Unexpected voice admission');},
    onFlush(){},onEnd:error=>errors.push(error),probe(){}});
  call.session={close(){this.ended=true;}};
  call.receive({kind:3,status:403,data:empty,end:true});
  assert.equal(errors[0].message,'Muse voice HTTP 403');
  assert.equal(call.session.ended,true);
});

test('cloud chat events expose display text and use a bounded larger window when the VM omits a cursor',async()=>{
  const cloud=new MuseCloud({store:{},socket(){},profile:'main'});
  const urls=[];
  cloud.session={ready:true,async json(path){
    urls.push(path);
    const value={ok:true,result:{channel:'all',has_more:true,chat_events:[
      {event_name:'message.assistant',message_id:'m',role:'assistant',display_text:'Previous answer',
        payload:{session_id:'main',role:'assistant',content:[]}}
    ]}};
    return {status:200,value,body:utf8(JSON.stringify(value))};
  }};
  const first=await cloud.history();
  assert.deepEqual(first,{messages:[{id:'m',role:'assistant',text:'Previous answer',done:true}],cursor:4});
  assert.equal((await cloud.history(first.cursor)).cursor,8);
  assert.equal((await cloud.history(32)).cursor,null);
  assert.deepEqual(urls,['/chat/history?limit=1','/chat/history?limit=4','/chat/history?limit=32']);
});

test('history replaces standalone widget references',()=>{
 const history=readHistory({chat_events:[{
  role:'assistant',message_id:'widget',display_text:'[[hatch_widget:widget-bc8ebfc0-22ce-458b-b316-183dd0ad1f8a]]'
 }]});
 assert.equal(history.messages[0].text,'Muse card unavailable on glasses');
});
