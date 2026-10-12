"""Official Muse v5 pairing, with a localhost USB transport to Android BLE.
No command execution service is enabled. Credentials stay in mode-600 state.
"""
import os, sys, json, queue, threading, logging, urllib.request, urllib.error
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
SDK=Path(os.environ.get('MUSE_SDK_SOURCE',str(Path(__file__).resolve().parents[2]/'muse-validation-research')))
sys.path.insert(0,str(SDK/'linux/src'))
os.environ['MUSEGADGET_STATE_DIR']=str(Path.home()/'.config/muse-prism-validation/glasses-pairing')
from musegadget import config, __version__, network
from musegadget.identity import Identity
from musegadget.pairing import PairingSession
from musegadget.ble_setup import SetupController
from musegadget.cli import _verify_and_save
logging.basicConfig(level=logging.INFO,format='%(asctime)s %(name)s %(message)s')
# Separate stable identity from the Mac probe, so devices cannot be confused.
ident=Identity('02:00:00:a1:7c:09')
token_path=Path.home()/'.config/muse-prism-validation/sdk-token'
os.environ['MUSEGADGET_SDK_TOKEN']=token_path.read_text().strip()
class Transport:
 def __init__(self): self.packets=queue.Queue();self.size=23;self.disconnect_pending=False;self.complete=False;self.status=''
 def send_packets(self,packets):
  for packet in packets:self.packets.put(list(packet))
 def mtu(self):return self.size
 def disconnect(self,delay):threading.Timer(delay,lambda:setattr(self,'disconnect_pending',True)).start()
t=Transport()
class Network:
 online=False
 is_online=staticmethod(lambda:Network.online)
 current_connection_entry=staticmethod(lambda:{'ssid':'Use current connection','rssi':-40,'secure':False})
def connectivity_worker():
 while True:
  try:
   with urllib.request.urlopen("https://api.muse.ai",timeout=3) as response: Network.online=True
  except urllib.error.HTTPError: Network.online=True
  except (OSError,ValueError): Network.online=False
  threading.Event().wait(10)
threading.Thread(target=connectivity_worker,daemon=True).start()
def complete(): t.complete=True;t.status='PAIRED';logging.info('PAIRING_COMPLETE credentials verified and saved')
pairing=PairingSession(node_id=ident.node_id,device_id=ident.device_id,mac=ident.mac,firmware_version=__version__,sdk_token=config.sdk_token())
controller=SetupController(pairing=pairing,identity=ident,version=__version__,transport=t,network=Network(),provision=_verify_and_save,on_complete=complete)
controller.start()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):self.dispatch(None)
 def do_POST(self):
  n=int(self.headers.get('Content-Length','0'))
  if n>32000:self.send_error(413);return
  try:self.dispatch(json.loads(self.rfile.read(n)))
  except (ValueError,TypeError):self.send_error(400)
 def dispatch(self,data):
  result={}
  if self.path=='/session':
   controller.on_disconnect();t.complete=False;t.disconnect_pending=False;t.status=''
   while not t.packets.empty():t.packets.get_nowait()
   t.size=23
  elif self.path=='/mtu':t.size=max(23,min(517,int(data['mtu'])))
  elif self.path=='/write':controller.on_write(bytes(data['packet']))
  elif self.path=='/poll':
   packets=[]
   while not t.packets.empty():packets.append(t.packets.get_nowait())
   result={'packets':packets,'disconnect':t.disconnect_pending,'complete':t.complete,'status':t.status};t.status='';t.disconnect_pending=False
  elif self.path=='/health':result={'identity':ident.ble_name,'paired':bool(config.load_json(config.PAIRING_FILE)),'session_state':pairing.state.name,'network_ready':Network.online}
  else:self.send_error(404);return
  body=json.dumps(result).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
logging.info('Pairing bridge 127.0.0.1:18788 identity=%s',ident.ble_name)
ThreadingHTTPServer(('127.0.0.1',18788),Handler).serve_forever()
