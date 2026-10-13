import {MuseCloud} from './muse-cloud.js';
import {autoReceiveNativePairing,saveNativeBinding,boundedJSON} from './muse-native-binding.js';
const KEY='muse.phone.pairing.v1';
let client,initializing,desired=true,receiving,nextReceive=0,authorizationError='';
export function initMuse(wx,params={}){
 if(client)client.stop();desired=true;globalWx=wx;authorizationError='';nextReceive=0;
 const store={load:()=>wx.getStorageSync(KEY),save:r=>wx.setStorageSync(KEY,r)};
 client=new MuseCloud({store,identity:()=>wx.getStorageSync('muse.native.binding.v1'),profile:params.subscriptionProfile,diagnostic:params.diagnosticRun==='true',socket:options=>wx.connectSocket(options)});
 const current=client;
 initializing=(async()=>{
  if(params.importBindingURL){
   const url=params.importBindingURL;delete params.importBindingURL;
   if(!/^http:\/\/127\.0\.0\.1:18790\/binding\/[a-f0-9]{32}$/.test(url))throw new Error('Invalid local binding import URL');
   saveNativeBinding(wx,await boundedJSON(url,{},6000));
   await boundedJSON(url+'/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({saved:true,authorization_present:!!store.load()?.access_token&&!!store.load()?.refresh_token})},6000);
   // The installer will open the normal page next; do not rotate tokens in this temporary page.
   return;
  }
  await receiveAuthorization(current,wx);
  if(client===current&&desired)current.start();
 })().catch(e=>{authorizationError=e.message;current.error=e.message;if(client===current&&desired)current.start();}).finally(()=>{if(client===current)initializing=null;});
 return initializing;
}
async function receiveAuthorization(current,wx){
 try{
  const result=await autoReceiveNativePairing(wx,()=>{if(client!==current)throw new Error('Authorization receiver has changed; please retry');current.stop();});
  if(client!==current)return;
  authorizationError='';
  if(result.saved){console.log('[Muse]',JSON.stringify({event:'native.auto',...result}));if(desired)current.start();}
  else if(!result.bound&&!current.authorization().access_token_present)authorizationError='Connect to a computer and run setup to establish automatic authorization handoff';
  return result;
 }catch(e){if(client===current){authorizationError=e.message;if(desired&&!current.active)current.start();}throw e;}
}
export function resumeMuse(){desired=true;if(client&&!initializing)client.start();}
export function stopMuse(){desired=false;if(client)client.stop();}
function retryAuthorization(){
 if(!client||!globalWx||initializing||receiving||Date.now()<nextReceive)return;
 nextReceive=Date.now()+5000;
 const current=client;
 receiving=receiveAuthorization(current,globalWx).catch(()=>{}).finally(()=>{receiving=null;});
}
export async function requestBridge(path,body){
 if(!client)throw new Error('Phone network client is not initialized');
 if(path==='/health'){retryAuthorization();const health=client.health();return {...health,authorization_error:authorizationError,error:authorizationError||health.error};}
 if(path==='/events')return client.events();
 if(path==='/messages')return client.send(body?.text);
 if(path==='/voice-notes')return client.sendBody(voiceBody(body?.pcm_base64,globalWx));
 throw new Error('Unsupported request');
}
let globalWx;
export function setEncodingAPI(wx){globalWx=wx;}
export function voiceBody(base64,wx){
 if(typeof base64!=='string'||base64.length<12800||base64.length>640000||base64.length%4||! /^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new Error('Invalid recording data');
 // AIUI provides arrayBufferToBase64, but no base64ToArrayBuffer.
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 const padding=base64.endsWith('==')?2:base64.endsWith('=')?1:0;
 const pcm=new Uint8Array(base64.length/4*3-padding);let at=0;
 for(let i=0;i<base64.length;i+=4){const value=(alphabet.indexOf(base64[i])<<18)|(alphabet.indexOf(base64[i+1])<<12)|(Math.max(0,alphabet.indexOf(base64[i+2]))<<6)|Math.max(0,alphabet.indexOf(base64[i+3]));if(at<pcm.length)pcm[at++]=value>>>16;if(at<pcm.length)pcm[at++]=value>>>8;if(at<pcm.length)pcm[at++]=value;}
 if(pcm.length<9600||pcm.length>480000||pcm.length%2)throw new Error('Invalid recording duration');
 const wav=new Uint8Array(44+pcm.length),v=new DataView(wav.buffer);
 const tag=(offset,text)=>{for(let i=0;i<text.length;i++)wav[offset+i]=text.charCodeAt(i);};
 tag(0,'RIFF');v.setUint32(4,36+pcm.length,true);tag(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);tag(36,'data');v.setUint32(40,pcm.length,true);wav.set(pcm,44);
 return {message:'',output_modality:'text',items:[{type:'file',mime_type:'audio/wav',filename:'voice_note.wav',data_base64:wx.arrayBufferToBase64(wav.buffer)}]};
}
