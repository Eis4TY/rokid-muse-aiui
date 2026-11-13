// English interface strings. User messages and Muse replies retain their original language.
const STRINGS = {
    loading:'Checking connection', starting:'Starting', idle:'Ready', listening:'Listening', thinking:'Preparing recording', waiting:'Waiting for reply', replying:'Replying', error:'Error', connected:'Online', cloudConnecting:'Connecting to cloud', serviceUnpaired:'Service online · Not paired', serviceStopped:'Glasses service is not running',
    unsupportedWidget:'Muse card unavailable on glasses', call:'Voice call (Experimental)', hangup:'End', interrupt:'Interrupt', callConnecting:'Calling', callLive:'Voice live', callLocalAudio:'Mic active · Awaiting Muse', callCloudAudio:'Muse hears speech', callWaiting:'Waiting for Muse', callTranscriptionFailed:'Muse could not recognize speech', callReplying:'Muse replying', callEnded:'Call ended', playbackFailed:'Voice playback failed',
    holdToTalk:'Tap: menu · Hold: talk', recorded:'Recorded {seconds}s · Confirm to send', draft:'Draft', stopSpeaking:'Done', cancel:'Cancel', processing:'Preparing recording', sending:'Sending', send:'Send', retryInput:'Record again', undo:'Undo', replyTimeout:'Muse reply timed out', speechFailed:'Recording failed', museReplied:'Muse replied', museNotConfirmed:'Muse has not confirmed receipt', voiceMessage:'Voice message ({seconds}s)'
};

export function mt(key, params) {
  const template = STRINGS[key] || key;
  return String(template).replace(/\{(\w+)\}/g, (match, name) => params && params[name] !== undefined ? String(params[name]) : match);
}
