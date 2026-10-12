"""Exercise the Android Java protocol against the unmodified official SDK responder."""
import os,socket,struct,subprocess,sys,threading
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SDK=ROOT.parent.parent/'muse-validation-research/linux/src'
sys.path.insert(0,str(SDK))
from musegadget.noise.noise_xx import NoiseXXResponder
from musegadget.noise.framing import NoiseFrameDecoder,encode_noise_frames
from musegadget.noise.transport import decode_request_envelope,encode_response_envelope
from musegadget.noise.envelope import ServiceFrame,ApplicationResponse

def receive(sock):
 def exact(n):
  b=b''
  while len(b)<n:
   piece=sock.recv(n-len(b))
   if not piece:raise EOFError()
   b+=piece
  return b
 return exact(struct.unpack('>I',exact(4))[0])
def send(sock,b):sock.sendall(struct.pack('>I',len(b))+b)
errors=[]
with socket.socket() as server:
 server.bind(('127.0.0.1',0));server.listen();port=server.getsockname()[1]
 def serve():
  try:
   with server.accept()[0] as sock:
    sock.settimeout(10);n=NoiseXXResponder();n.initialize();send(sock,n.read_message1_and_write_message2(receive(sock)));n.read_message3(receive(sock));tx,rx=n.split();req=decode_request_envelope(NoiseFrameDecoder().decode(rx.decrypt_with_ad(b'',receive(sock))))
    assert req.value.path=='/chat/subscribe' and req.value.end_body
    assert req.value.body==b'{"session_id":"test"}'
    response=encode_response_envelope(ServiceFrame.response(req.stream_id,ApplicationResponse(status=200,body=('成功'+'a'*69996).encode(),end_body=True)))
    for b in encode_noise_frames(response):send(sock,tx.encrypt_with_ad(b'',b))
  except BaseException as e:errors.append(e)
 thread=threading.Thread(target=serve);thread.start()
 cp=str(ROOT/'build/host-protocol')+':'+str(ROOT/'build/classes')+':'+str(ROOT/'deps/bcprov-jdk18on-1.78.1.jar')
 subprocess.run(['javac','--release','8','-cp',cp,'-d',str(ROOT/'build/host-protocol'),str(ROOT/'tests/ProtocolCheck.java')],check=True)
 subprocess.run(['java','-cp',cp,'com.prism.musepair.ProtocolCheck',str(port)],check=True)
 thread.join()
 if errors:raise errors[0]
