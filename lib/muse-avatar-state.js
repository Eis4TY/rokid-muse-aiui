// Rendering state follows actual interaction events, never local receipts.
export function avatarState(data, now, startedAt, errorUntil = 0) {
  if (now < errorUntil) return {mode:'error',label:'Error'};
  if (data.listening) return {mode:'listening',label:'Listening'};
  if (data.recognizing) return {mode:'thinking',label:'Preparing recording'};
  if (data.sending || data.awaitingReply) return {mode:'thinking',label:data.replyStreaming?'Replying':'Waiting for reply'};
  if (now-startedAt < 1400) return {mode:'boot',label:'Starting'};
  if (!data.channelReady) return {mode:'error',label:data.museReady?'Connecting':'Not connected'};
  return {mode:'idle',label:'Ready'};
}

export function newTurnReplies(messages, baseline) {
  return messages.filter(message => message.text && baseline.get(message.id)!==message.text);
}

// Recorder uses little-endian signed 16-bit PCM. Sample sparsely for HUD feedback.
export function pcmLevel(frameBuffer) {
  const pcm = new DataView(frameBuffer);
  let energy=0,count=0;
  for(let i=0;i+1<pcm.byteLength;i+=16){const sample=pcm.getInt16(i,true)/32768;energy+=sample*sample;count++;}
  return count ? Math.min(1,Math.sqrt(energy/count)*5) : 0;
}
