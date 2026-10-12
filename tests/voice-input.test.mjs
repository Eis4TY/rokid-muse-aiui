import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceInput} from '../lib/voice-input.js';
function fixture() {
 const callbacks={};let starts=0,stops=0;
 const recorder={onFrameRecorded(fn){callbacks.frame=fn;},onError(fn){callbacks.error=fn;},onStop(fn){callbacks.stop=fn;},async start(){starts++;},async stop(){stops++;callbacks.stop();}};
 const input=createVoiceInput({wx:{media:{getRecorderManager:()=>recorder},arrayBufferToBase64:b=>Buffer.from(b).toString('base64')}});
 const notes=[],errors=[];input.onrecorded=n=>notes.push(n);input.onerror=e=>errors.push(e);
 return {input,callbacks,notes,errors,get stops(){return stops;}};
}
test('records ordered PCM without ASR or network, then produces a note only on stop',async()=>{
 const f=fixture();await f.input.start();
 f.callbacks.frame({frameBuffer:new Uint8Array(6400).fill(1).buffer});
 f.callbacks.frame({frameBuffer:new Uint8Array(6400).fill(2).buffer});
 assert.equal(f.notes.length,0);f.input.stop();await Promise.resolve();
 const pcm=Buffer.from(f.notes[0].pcm_base64,'base64');assert.equal(pcm.length,12800);assert.equal(pcm[0],1);assert.equal(pcm[6400],2);assert.equal(f.notes[0].duration,.4);
});
test('cancel drops audio and a subsequent recording works',async()=>{
 const f=fixture();await f.input.start();f.callbacks.frame({frameBuffer:new ArrayBuffer(9600)});f.input.abort();await f.input.start();assert.equal(f.notes.length,0);
 f.callbacks.frame({frameBuffer:new ArrayBuffer(9600)});f.input.stop();assert.equal(f.notes.length,1);
});
test('short recordings fail; the 15 second cap stops recording and bounds its buffer',async()=>{
 const f=fixture();await f.input.start();f.callbacks.frame({frameBuffer:new ArrayBuffer(100)});f.input.stop();assert.equal(f.errors.length,1);
 await f.input.start();f.callbacks.frame({frameBuffer:new ArrayBuffer(500000)});assert.equal(f.notes[0].duration,15);assert.equal(Buffer.from(f.notes[0].pcm_base64,'base64').length,480000);
});

test('cancel during recorder startup cannot stop the next recording',async()=>{
 const f=fixture();const first=f.input.start();f.input.abort();const next=f.input.start();await Promise.all([first,next]);
 f.callbacks.frame({frameBuffer:new ArrayBuffer(9600)});f.input.stop();assert.equal(f.notes.length,1);
});
