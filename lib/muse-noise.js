// Copyright (c) Meta Platforms, Inc. and affiliates.
// JavaScript port of Muse Gadget SDK Noise XX. Apache-2.0; see THIRD-PARTY.md.
import {x25519,gcm,sha256,hmac} from './muse-crypto.js';
export const EMPTY=new Uint8Array(0);
export const utf8=s=>new TextEncoder().encode(s);
export function concat(...parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}return out;}
export function randomBytes(n){if(globalThis.crypto?.getRandomValues)return crypto.getRandomValues(new Uint8Array(n));if(!globalThis.crypto?.randomUUID)throw new Error('AIUI does not provide secure random numbers');const out=new Uint8Array(n);for(let i=0;i<n;i+=32){const b=sha256(utf8(crypto.randomUUID()+crypto.randomUUID()+crypto.randomUUID()));out.set(b.subarray(0,Math.min(32,n-i)),i);}return out;}
function hkdf(key,data){const t=hmac(sha256,key,data),a=hmac(sha256,t,new Uint8Array([1]));return [a,hmac(sha256,t,concat(a,new Uint8Array([2])))];}
export class CipherState {
 constructor(key=null){this.key=key;this.nonce=0n;this.dead=false;}
 apply(encrypt,ad,data){if(this.dead)throw new Error('Noise cipher is closed');if(!this.key)return data;if(this.nonce>=9007199254740991n){this.dead=true;throw new Error('Noise nonce exhausted');}const iv=new Uint8Array(12);let n=this.nonce++;for(let i=11;i>=4;i--){iv[i]=Number(n&255n);n>>=8n;}try{const aes=gcm(this.key,iv,ad);return encrypt?aes.encrypt(data):aes.decrypt(data);}catch(e){this.dead=true;throw e;}}
 destroy(){if(this.key)this.key.fill(0);this.dead=true;}
}
export class NoiseXX {
 constructor(){this.h=new Uint8Array(32);this.h.set(utf8('Noise_XX_25519_AESGCM_SHA256'));this.ck=this.h.slice();this.cipher=new CipherState();this.mixHash(EMPTY);this.phase=0;}
 mixHash(b){this.h=sha256(concat(this.h,b));}
 mixKey(b){const [ck,k]=hkdf(this.ck,b);this.ck=ck;this.cipher.destroy();this.cipher=new CipherState(k);}
 enc(b){const out=this.cipher.apply(true,this.h,b);this.mixHash(out);return out;}
 dec(b){const out=this.cipher.apply(false,this.h,b);this.mixHash(b);return out;}
 message1(){if(this.phase!==0)throw new Error('Invalid Noise handshake order');this.e=randomBytes(32);const p=x25519.getPublicKey(this.e);this.mixHash(p);this.enc(EMPTY);this.phase=1;return p;}
 message2(b){if(this.phase!==1||b.length<96)throw new Error('Invalid second Noise handshake message');this.re=b.slice(0,32);this.mixHash(this.re);this.mixKey(x25519.getSharedSecret(this.e,this.re));const rs=this.dec(b.slice(32,80));this.mixKey(x25519.getSharedSecret(this.e,rs));const payload=this.dec(b.slice(80));this.phase=2;return payload;}
 message3(){if(this.phase!==2)throw new Error('Invalid Noise handshake order');const s=randomBytes(32);try{const a=this.enc(x25519.getPublicKey(s));this.mixKey(x25519.getSharedSecret(s,this.re));const out=concat(a,this.enc(EMPTY));this.phase=3;return out;}finally{s.fill(0);}}
 split(){if(this.phase!==3)throw new Error('Invalid Noise handshake order');const [a,b]=hkdf(this.ck,EMPTY);this.e.fill(0);this.ck.fill(0);this.cipher.destroy();this.phase=4;return [new CipherState(a),new CipherState(b)];}
}
