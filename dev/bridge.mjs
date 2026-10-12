import http from 'node:http';
import { pathToFileURL } from 'node:url';
export function createBridge({pairingStatus = async () => false, cloudRequest = null} = {}) {
  let checks = 0;
  return http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const reply = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
    if (req.method === 'OPTIONS') return reply(204, {});
    if (req.method === 'GET' && req.url === '/health') {
      let cloud={};if(cloudRequest)try{cloud=(await cloudRequest('/health')).body;}catch{cloud={message_channel:'reconnecting'};}
      return reply(200,{bridge:'online',muse:cloud.paired||await pairingStatus()?'paired':'unpaired',message_channel:cloud.message_channel||'not_connected',error:cloud.error||'',transport:'adb-usb',checks});
    }
    if (req.method === 'GET' && req.url === '/events') {
      if(!cloudRequest)return reply(200,{messages:[],revision:0});
      try{const r=await cloudRequest('/events');return reply(r.status,r.body);}catch{return reply(503,{message:'Muse 回复通道暂不可用'});}
    }
    if (req.method === 'POST' && (req.url === '/messages' || req.url === '/transport-check')) {
      let body = ''; let overflow = false;
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body)>16384) { overflow=true; break; } }
      if (overflow) return reply(413, {code:'message_too_large'});
      let data;
      try { data=JSON.parse(body); } catch { return reply(400,{code:'invalid_json'}); }
      if (typeof data.text !== 'string' || !data.text.trim()) return reply(400,{code:'empty_message'});
      if(req.url === '/messages' && cloudRequest){try{const r=await cloudRequest('/messages',{text:data.text});return reply(r.status,r.body);}catch{return reply(503,{message:'Muse 消息提交失败，请检查连接'});}}
      if (req.url === '/messages') return reply(409,await pairingStatus()?{code:'muse_channel_unavailable',message:'Muse 已配对，会话通道尚未接入，消息未发送。'}:{code:'muse_unpaired',message:'Muse 尚未配对，消息未发送。'});
      checks++;
      console.log('[MuseBridge] transport-check', JSON.stringify({characters:data.text.length,checks}));
      return reply(200,{received:true,characters:data.text.length,muse_sent:false});
    }
    return reply(404,{code:'not_found'});
  });
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  createBridge({cloudRequest:async(path,body)=>{const r=await fetch('http://127.0.0.1:18789'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(body?70000:3000)});return {status:r.status,body:await r.json()};},pairingStatus:async()=>{try{const r=await fetch('http://127.0.0.1:18788/health',{signal:AbortSignal.timeout(2000)});return !!(await r.json()).paired;}catch{return false;}}}).listen(18787,'127.0.0.1',()=>console.log('[MuseBridge] listening on 127.0.0.1:18787'));
}
