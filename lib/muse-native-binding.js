import {gcm,hmac,sha256} from './muse-crypto.js';
const ORIGIN='http://127.0.0.1:18791',BINDING='muse.native.binding.v1',PAIRING='muse.phone.pairing.v1',RECEIPT='muse.native.receipt.v1';
const utf8=s=>new TextEncoder().encode(s),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=3){const n=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);s+=alphabet[(n>>>18)&63]+alphabet[(n>>>12)&63];if(i+1<bytes.length)s+=alphabet[(n>>>6)&63];if(i+2<bytes.length)s+=alphabet[n&63];}return s;}
export function unb64(s){if(typeof s!=='string'||!s.length||s.length>65536||s.length%4===1||!/^[A-Za-z0-9_-]+$/.test(s))throw new Error('Invalid local binding data');let n=0,bits=0,out=[];for(const c of s){n=(n<<6)|alphabet.indexOf(c);bits+=6;if(bits>=8){bits-=8;out.push((n>>>bits)&255);}}return new Uint8Array(out);}
export function saveNativeBinding(wx,record){const key=unb64(record.binding_key);if(key.length!==32||!/^homelink-[0-9a-f]{6,12}$/.test(record.device_id))throw new Error('Invalid local binding key');wx.setStorageSync(BINDING,record);if(wx.getStorageSync(BINDING)?.binding_key!==record.binding_key)throw new Error('Failed to save AIUI local binding');}
export async function boundedJSON(url,options={},milliseconds=5000){
 const controller=new AbortController();let timer;
 try{return await Promise.race([(async()=>{const r=await fetch(url,{...options,signal:controller.signal});if(!r.ok)throw new Error('Authorization request HTTP '+r.status);return await r.json();})(),new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new Error('Authorization request timed out; check the pairing component and phone network'));controller.abort();},milliseconds);})]);}finally{clearTimeout(timer);}
}
async function json(path,body){try{return await boundedJSON(ORIGIN+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});}catch(error){throw new Error('Local authorization handoff: '+error.message);}}
async function proof(key,action,id){const challenge=await json('/challenge');if(unb64(challenge.nonce).length!==32)throw new Error('Invalid local challenge');const message='muse-aiui-'+action+'-v1|'+(action==='complete'?id+'|':'')+challenge.nonce;return {nonce:challenge.nonce,proof:b64(hmac(sha256,key,utf8(message))),...(id?{handoff_id:id}:{})};}
let receiving;
export function autoReceiveNativePairing(wx,beforeSave=()=>{}){if(!receiving)receiving=receiveNativePairing(wx,beforeSave).finally(()=>{receiving=undefined;});return receiving;}
async function receiveNativePairing(wx,beforeSave){
 const binding=wx.getStorageSync(BINDING);if(!binding)return {bound:false,saved:false};const key=unb64(binding.binding_key);if(key.length!==32)throw new Error('Invalid local binding key');
 let status;try{status=await json('/status');}catch(error){if(wx.getStorageSync(RECEIPT)&&wx.getStorageSync(PAIRING)?.access_token)return {bound:true,saved:false,component_available:false};throw error;}if(status.device_id&&status.device_id!==binding.device_id)throw new Error('Glasses identity does not match the AIUI binding');if(!status.binding_ready)throw new Error('Native component is not bound to AIUI');if(!status.handoff_ready)return {bound:true,saved:false,delivered:status.delivered};
 const claim=await proof(key,'claim'),encrypted=await json('/claim-bound',claim);if(encrypted.nonce!==claim.nonce)throw new Error('Local handoff response does not match');const iv=unb64(encrypted.iv);if(iv.length!==12)throw new Error('Invalid local handoff IV');
 const record=JSON.parse(new TextDecoder().decode(gcm(key,iv,utf8(claim.nonce)).decrypt(unb64(encrypted.ciphertext))));
 if(record.device_id!==binding.device_id||record.token_type!=='device'||typeof record.access_token!=='string'||!record.access_token||typeof record.refresh_token!=='string'||!record.refresh_token||typeof record.handoff_id!=='string')throw new Error('Invalid native authorization record');
 if(record.api_url_v2&&record.api_url_v2!=='https://api.muse.ai')throw new Error('Unsupported native authorization API URL');
 const id=record.handoff_id;let alreadySaved=wx.getStorageSync(RECEIPT)===id;
 if(!alreadySaved){
  let data;try{data=await boundedJSON('https://api.muse.ai/fetch_vms',{headers:{Authorization:'Bearer '+record.access_token,'X-API-Version':'1.0.0'}},20000);}catch(error){throw new Error('Muse cloud authorization verification: '+error.message);}if(!Array.isArray(data.vm_list)||!data.vm_list.length)throw new Error('No Muse session available for the new authorization');
  beforeSave();delete record.handoff_id;delete record.handoff_delivered;wx.setStorageSync(PAIRING,record);const saved=wx.getStorageSync(PAIRING);if(saved?.access_token!==record.access_token||saved?.refresh_token!==record.refresh_token)throw new Error('Failed to save AIUI authorization');wx.setStorageSync(RECEIPT,id);
 }
 const ack=await json('/complete-bound',await proof(key,'complete',id));if(ack.saved!==true)throw new Error('Authorization saved; native handoff receipt not confirmed');return {bound:true,saved:true,cloud_verified:true,already_saved:alreadySaved};
}
