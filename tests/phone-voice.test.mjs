import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceBody} from '../lib/muse-transport.js';
import {Replies} from '../lib/muse-cloud.js';
const wx={arrayBufferToBase64:b=>Buffer.from(b).toString('base64')};
test('phone transport wraps recorded PCM in a real mono 16k WAV attachment',()=>{
 const pcm=Buffer.alloc(9600);pcm[100]=47;
 const body=voiceBody(pcm.toString('base64'),wx),wav=Buffer.from(body.items[0].data_base64,'base64');
 assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.readUInt32LE(40),9600);assert.deepEqual(wav.subarray(44),pcm);assert.equal(body.items[0].mime_type,'audio/wav');
 assert.throws(()=>voiceBody(Buffer.alloc(9598).toString('base64'),wx));assert.throws(()=>voiceBody('!'.repeat(12800),wx));
});
test('voice transcript comes only from this send acknowledgement user echo',()=>{
 const r=new Replies('side',()=>{},true);r.begin();r.acknowledge({message_id:'own',session_id:'main'});
 r.feed({type:'event',event:'message.user',payload:{session_id:'main',message_id:'own',display_text:'测试问题\n[file:voice]'}});
 assert.equal(r.transcript,'测试问题');assert.equal(r.snapshot().length,0);
 r.feed({type:'event',event:'message.user',payload:{session_id:'main',message_id:'foreign',display_text:'其他人的问题'}});
 assert.equal(r.transcript,'测试问题');
});

test('a timed-out cloud submission invalidates the apparently online session',async()=>{
 const {MuseCloud}=await import('../lib/muse-cloud.js');let failure;
 const cloud=new MuseCloud({store:{load:()=>({access_token:'synthetic',refresh_token:'synthetic'})},socket:()=>{}});
 cloud.record={device_id:'homelink-abcdef',access_token:'synthetic'};
 cloud.session={ready:true,pending:new Map(),http:()=>({id:3,promise:Promise.reject(new Error('Muse message submission timed out'))}),fail:reason=>{failure=reason;}};
 await assert.rejects(cloud.send('测试'),/timed out/);assert.match(failure,/reconnecting/);assert.equal(cloud.sending,false);
});
