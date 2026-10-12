export const SERVICE_UUID='7fdd3d1c-38ea-46cf-8b46-314ecf5f240c';
export const RX_UUID='4d593029-28a2-4a6e-a1f0-3c2d5e8f9b01';
export const TX_UUID='d75dc4ca-7b2b-4e9c-8f0a-1d2e3f4a5b6c';
export const BRIDGE_URL='http://127.0.0.1:18787';
export async function requestBridge(path, body, timeoutMs=6000) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetch(BRIDGE_URL+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:controller.signal});
    const result=await response.json();
    if (!response.ok) throw new Error(result.message||result.code||'连接失败');
    return result;
  } finally { clearTimeout(timer); }
}
export function createFrameAssembler(onMessage) {
  let buffer=[],total=0,next=0;
  return (input)=>{
    const bytes=Array.from(input||[]);
    if(bytes.length<3||bytes[0]!==254) return decode(bytes);
    if(bytes[1]===0) {buffer=[];next=0;total=bytes[2];}
    if(!total||bytes[2]!==total||bytes[1]!==next||next>=total) {buffer=[];total=0;next=0;return;}
    buffer=buffer.concat(bytes.slice(3));next++;
    if(buffer.length>8192) {buffer=[];total=0;next=0;return;}
    if(next===total){const complete=buffer;buffer=[];total=0;next=0;decode(complete);}
    function decode(data){try{onMessage(JSON.parse(new TextDecoder().decode(new Uint8Array(data))));}catch(_){}}
  };
}
