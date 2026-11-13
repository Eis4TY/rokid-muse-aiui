export function decodeBase64(base64){
 // AIUI provides arrayBufferToBase64, but no base64ToArrayBuffer.
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 const padding=base64.endsWith('==')?2:base64.endsWith('=')?1:0;
 const pcm=new Uint8Array(base64.length/4*3-padding);let at=0;
 for(let i=0;i<base64.length;i+=4){const value=(alphabet.indexOf(base64[i])<<18)|(alphabet.indexOf(base64[i+1])<<12)|(Math.max(0,alphabet.indexOf(base64[i+2]))<<6)|Math.max(0,alphabet.indexOf(base64[i+3]));if(at<pcm.length)pcm[at++]=value>>>16;if(at<pcm.length)pcm[at++]=value>>>8;if(at<pcm.length)pcm[at++]=value;}
 return pcm;
}
