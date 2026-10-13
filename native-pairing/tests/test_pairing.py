"""Official Python SDK mobile-side cryptography vs Android Java BLE responder."""
import sys,json,subprocess,hashlib,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT.parents[1]/'muse-validation-research/linux/src'))
from musegadget.pairing import build_transcript,derive_session_keys,b64url_encode,b64url_decode,record_nonce,record_aad
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
jar=ROOT/'build/test-json.jar'
jar.parent.mkdir(parents=True,exist_ok=True)
raw=jar.read_bytes() if jar.exists() else urllib.request.urlopen('https://maven.aliyun.com/repository/central/org/json/json/20240303/json-20240303.jar',timeout=20).read()
assert hashlib.sha256(raw).hexdigest()=='3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed'
jar.write_bytes(raw)
cp=str(ROOT/'build/host-pair')+':'+str(ROOT/'deps/bcprov-jdk18on-1.78.1.jar')+':'+str(jar)
(ROOT/'build/host-pair').mkdir(parents=True,exist_ok=True)
subprocess.run(['javac','--release','8','-cp',cp,'-d',str(ROOT/'build/host-pair'),str(ROOT/'src/com/prism/musepair/Noise.java'),str(ROOT/'src/com/prism/musepair/PairProtocol.java'),str(ROOT/'tests/PairCheck.java')],check=True)
p=subprocess.Popen(['java','-cp',cp,'com.prism.musepair.PairCheck'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
def call(op,value):
 p.stdin.write(json.dumps({'op':op,'value':value})+'\n');p.stdin.flush();return json.loads(p.stdout.readline())
key=ec.generate_private_key(ec.SECP256R1());pub=key.public_key().public_bytes(Encoding.X962,PublicFormat.UncompressedPoint);nonce=bytes(range(16))
ready=call('hello',{'version':5,'pairing_auth':'none','pairing_policy':'confirm_app','mobile_pub':b64url_encode(pub),'mobile_nonce':b64url_encode(nonce)})
th=hashlib.sha256(build_transcript(community=True,auth_epoch=0,policy='confirm_app',device_id=ready['device_id'],node_id=ready['node_id'],mac=ready['mac'],firmware_version=ready['firmware_version'],mobile_pub=b64url_encode(pub),device_pub=ready['device_pub'],mobile_nonce=b64url_encode(nonce),device_nonce=ready['device_nonce']).encode()).digest()
assert b64url_encode(th)==ready['transcript_hash']
shared=key.exchange(ec.ECDH(),ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(),b64url_decode(ready['device_pub'])))
tx,rx,sid=derive_session_keys(shared,nonce,b64url_decode(ready['device_nonce']),th);assert b64url_encode(sid)==ready['session_id'];session=ready['session_id']
def seal(n,obj):
 data=AESGCM(tx).encrypt(record_nonce(0,n),json.dumps(obj,separators=(',',':')).encode(),record_aad(session,0,n));return {'session_id':session,'counter':str(n),'ciphertext':b64url_encode(data[:-16]),'tag':b64url_encode(data[-16:])}
response=call('finished',seal(0,{'action':'pairing_client_finished'}))
plain=AESGCM(rx).decrypt(record_nonce(1,0),b64url_decode(response['ciphertext'])+b64url_decode(response['tag']),record_aad(session,1,0));assert json.loads(plain)['status']=='pairing_confirmed'
envelope=seal(1,{'action':'provision_v2','access_token':'synthetic-test','text':'授权验证'});assert call('receive',envelope)['text']=='授权验证'
assert call('receive',envelope)=={'error':'error_pairing_decrypt','state':0}
assert call('hello',{'version':5,'pairing_auth':'none','pairing_policy':'confirm_app','mobile_pub':'AA','mobile_nonce':b64url_encode(nonce)})['state']==0
p.stdin.close();assert p.wait(timeout=5)==0
print('PASS: canonical transcript, P-256/HKDF, bidirectional AES-GCM, Unicode, replay reset, invalid key rejection')
