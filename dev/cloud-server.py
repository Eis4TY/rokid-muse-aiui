"""Muse cloud bridge: official Noise SDK, no remote shell/file capabilities."""
import asyncio,json,logging,os,sys,time,threading,uuid
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from urllib.parse import urlparse
SDK=Path(os.environ.get('MUSE_SDK_SOURCE',str(Path(__file__).resolve().parents[2]/'muse-validation-research')))
sys.path.insert(0,str(SDK/'linux/src'))
os.environ['MUSEGADGET_STATE_DIR']=str(Path.home()/'.config/muse-prism-validation/glasses-pairing')
from musegadget import config,muse_api
from musegadget.link_client import LinkSession,DeviceDescription,Outcome
from musegadget.noise import Header
logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
log=logging.getLogger('MuseCloud')
SESSION_ID=str(uuid.uuid5(uuid.NAMESPACE_URL,'rokid-muse-demo:homelink-a17c09'))
class Replies:
 def __init__(self):self.items={};self.ids=set();self.parents=set();self.pending=[];self.waiting=False;self.revision=0
 def begin(self):self.waiting=True;self.pending=[]
 def acknowledge(self,response):
  if isinstance(response,str):
   try:response=json.loads(response)
   except ValueError:response={}
  obj=response.get('result',response) if isinstance(response,dict) else {}
  self.parents.update(obj[k] for k in ('message_id','reply_to_message_id') if isinstance(obj.get(k),str))
  self.waiting=False
  pending,self.pending=self.pending,[]
  for event in pending:self.feed(event)
 def feed(self,event):
  if self.waiting:self.pending=(self.pending+[event])[-200:];return
  if event.get('type')!='event':return
  kind=event.get('event');p=event.get('payload') or {}
  if not isinstance(p,dict):return
  sid=p.get('session_id',event.get('session_id'))
  if sid and sid!=SESSION_ID:return
  mid=p.get('message_id') or event.get('message_id') or p.get('id')
  parent=p.get('reply_to_message_id') or p.get('parent_message_id')
  if not isinstance(mid,str):return
  if mid not in self.ids and not (sid==SESSION_ID or parent in self.parents or parent in self.ids):return
  if kind not in ('delta.message_start','delta.text_append','delta.message_done','message.assistant'):return
  self.ids.add(mid);item=self.items.setdefault(mid,{'id':mid,'role':'assistant','text':'','done':False})
  if kind=='delta.text_append' and isinstance(p.get('text'),str):item['text']+=p['text']
  if kind in ('delta.message_done','message.assistant'):
   final=p.get('text') or p.get('display_text') or p.get('content')
   if isinstance(final,str):item['text']=final
   item['done']=True;log.info('REPLY_COMPLETE characters=%d',len(item['text']))
  item['text']=item['text'][-12000:];self.revision+=1
  if len(self.items)>30:self.items.pop(next(iter(self.items)))
 def snapshot(self):return [dict(v) for v in list(self.items.values()) if v['text']]
class Subscription:
 def __init__(self,replies):self.done=asyncio.get_running_loop().create_future();self.buffer=bytearray();self.status=0;self.replies=replies;self.last_seq=0
 def on_frame(self,frame):
  if frame.kind=='reset':self.done.set_result(None);return
  if frame.kind=='response':self.status=frame.value.status;data=frame.value.body;end=frame.value.end_body
  else:data=frame.value.data;end=frame.value.end_body
  self.buffer.extend(data)
  if len(self.buffer)>1024*1024:self.done.set_result(None);return
  while b'\n' in self.buffer:
   line,_,tail=self.buffer.partition(b'\n');self.buffer=bytearray(tail)
   try:
    event=json.loads(line)
    seq=event.get('seq',0)
    if isinstance(seq,int) and seq and seq<=self.last_seq:continue
    if isinstance(seq,int):self.last_seq=max(seq,self.last_seq)
    self.replies.feed(event)
   except (ValueError,TypeError):pass
  if end and not self.done.done():self.done.set_result(None)
class CloudSession(LinkSession):
 async def subscribe(self,replies):
  stream=self._transport.start_stream_request('POST','/chat/subscribe',headers=[Header('Content-Type','application/json'),Header('Accept','application/x-ndjson')])
  sub=Subscription(replies);self._requests[stream.stream_id]=sub
  await self._send_frames(stream.frames)
  await self._send_frames(self._transport.encrypt_body_chunk(stream.stream_id,json.dumps({'session_id':SESSION_ID}).encode(),end_body=True))
  return sub
class Cloud:
 def __init__(self):self.session=None;self.sub=None;self.status='connecting';self.error='';self.replies=Replies();self.sending=False
 def ready(self):return bool(self.session and self.session.registered_at and self.sub and self.sub.status==200 and not self.sub.done.done())
 def health(self):return {'paired':bool(config.load_json(config.PAIRING_FILE)),'message_channel':'connected' if self.ready() else self.status,'error':self.error,'revision':self.replies.revision}
 async def run(self):
  while True:
   self.session=None;self.sub=None
   record=config.load_json(config.PAIRING_FILE)
   if not record:self.status='unpaired';await asyncio.sleep(10);continue
   try:
    self.status='connecting';self.error=''
    api=muse_api.api_root(record.get('api_url_v2',''))
    if time.time()-record.get('access_token_saved_at',0)>1800:
     tokens,code=await asyncio.to_thread(muse_api.refresh_device_token,record['refresh_token'],'homelink-a17c09',api)
     if tokens:record={**record,**tokens,'access_token_saved_at':int(time.time())};config.save_json(config.PAIRING_FILE,record)
    vms,code=await asyncio.to_thread(muse_api.fetch_vms_with_status,record['access_token'],api)
    if not vms:raise ConnectionError('Muse 账号服务暂不可用（HTTP '+str(code)+'）')
    vm=next((v for v in vms if v.get('is_default')),vms[0])
    device=DeviceDescription(node_id='homelink-a17c09',display_name='Glasses_0068 · Muse',version='0.2.0',commands={})
    session=CloudSession(noise_host=record.get('noise_host') or 'hatch.metaaivm.com',vm_id=vm['vm_id'] or vm['vm_name'],vm_auth_token=vm['vm_auth_token'],device=device,run_command=lambda *args:{'ok':False,'error':{'code':'unsupported','message':'Demo has no remote execution capabilities'}})
    self.session=session;stop=asyncio.Event();task=asyncio.create_task(session.run(stop))
    try:
     deadline=time.monotonic()+30
     while not session.registered_at:
      if task.done():
       task.result();raise ConnectionError('Muse 云端注册失败')
      if time.monotonic()>deadline:raise TimeoutError('Muse 云端注册超时')
      await asyncio.sleep(.1)
     self.sub=await session.subscribe(self.replies)
     deadline=time.monotonic()+15
     while not self.ready():
      if task.done() or self.sub.done.done() or self.sub.status>=400:raise ConnectionError('Muse 回复订阅失败（HTTP '+str(self.sub.status)+'）')
      if time.monotonic()>deadline:raise TimeoutError('Muse 回复订阅超时')
      await asyncio.sleep(.1)
     self.status='connected';log.info('CLOUD_READY registered + subscribed')
     await asyncio.wait([task,self.sub.done],return_when=asyncio.FIRST_COMPLETED)
    finally:
     stop.set();await asyncio.gather(task,return_exceptions=True)
   except Exception as exc:self.status='reconnecting';self.error=str(exc)[:200];log.warning('Cloud connection failed: %s',type(exc).__name__)
   await asyncio.sleep(5)
 async def send(self,text):
  if not self.ready():raise ConnectionError('Muse 云端通道尚未连接')
  if self.sending:raise ValueError('上一条消息还在提交中')
  self.sending=True;self.replies.begin()
  try:
   result=await self.session.send_chat(text,SESSION_ID)
   if not result.get('ok'):
    response=result.get('response');detail=(response.get('detail') or response.get('message') or response.get('error') or '') if isinstance(response,dict) else ''
    raise ConnectionError('Muse 拒绝消息（HTTP '+str(result.get('status'))+'）'+str(detail)[:300])
   response=result.get('response');self.replies.acknowledge(response);log.info('CHAT_ACCEPTED characters=%d',len(text));return {'accepted':True,'muse_sent':True,'session_id':SESSION_ID}
  finally:self.sending=False;self.replies.waiting=False
cloud=Cloud();loop=None
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def reply(self,code,obj):
  body=json.dumps(obj,ensure_ascii=False).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def do_GET(self):
  path=urlparse(self.path).path
  if path=='/health':self.reply(200,cloud.health())
  elif path=='/events':self.reply(200,{'messages':cloud.replies.snapshot(),'revision':cloud.replies.revision})
  else:self.reply(404,{'code':'not_found'})
 def do_POST(self):
  if self.path!='/messages':self.reply(404,{});return
  try:
   size=int(self.headers.get('Content-Length','0'))
   if size>16000:raise ValueError('消息过长')
   obj=json.loads(self.rfile.read(size));text=obj.get('text')
   if not isinstance(text,str) or not text.strip() or len(text)>2000:raise ValueError('消息为空或过长')
   future=asyncio.run_coroutine_threadsafe(cloud.send(text),loop);result=future.result(70);self.reply(200,result)
  except Exception as exc:self.reply(503,{'code':'cloud_unavailable','message':str(exc)[:200]})
async def main():
 global loop
 loop=asyncio.get_running_loop();server=ThreadingHTTPServer(('127.0.0.1',18789),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
 log.info('Cloud bridge 127.0.0.1:18789');await cloud.run()
if __name__=='__main__':asyncio.run(main())
