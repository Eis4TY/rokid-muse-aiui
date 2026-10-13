// English interface strings. User messages and Muse replies retain their original language.
const STRINGS = {
    loading:'Checking connection', starting:'Starting', idle:'Ready', listening:'Listening', thinking:'Preparing recording', waiting:'Waiting for reply', replying:'Replying', error:'Error', connected:'Online', cloudConnecting:'Connecting to cloud', serviceUnpaired:'Service online · Not paired', serviceStopped:'Glasses service is not running',
    holdToTalk:'Hold touchpad to speak', recorded:'Recorded {seconds}s · Confirm to send', draft:'Draft', stopSpeaking:'Done', cancel:'Cancel', processing:'Preparing recording', sending:'Sending', send:'Send', retryInput:'Record again', undo:'Undo', replyTimeout:'Muse reply timed out', speechFailed:'Recording failed', museReplied:'Muse replied', museNotConfirmed:'Muse has not confirmed receipt', voiceMessage:'Voice message ({seconds}s)'
};

export function mt(key, params) {
  const template = STRINGS[key] || key;
  return String(template).replace(/\{(\w+)\}/g, (match, name) => params && params[name] !== undefined ? String(params[name]) : match);
}
