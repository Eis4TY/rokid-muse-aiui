import wx from 'wx';
import {createPixelAvatar} from '../../lib/muse-avatar.js';
import {avatarState,newTurnReplies} from '../../lib/muse-avatar-state.js';
import {createVoiceInput} from '../../lib/voice-input.js';
import {LONG_PRESS_MENU_MS} from '../../lib/prism-gesture.js';
import {initMuse,resumeMuse,stopMuse,setEncodingAPI,requestBridge} from '../../lib/muse-transport.js';
import {mt} from '../../lib/muse-i18n.js';

function cancelTimer(id) { if(id !== undefined && id !== null) clearTimeout(id); }
function trace(event, data={}) {console.log('[Muse]',JSON.stringify({event,...data}));}
export default {
  data:{surface:'chat',title:'Muse',status:'',authorizationHint:'',connectionState:'connecting',loaderAngle:0,bridgeOnline:false,museReady:false,channelReady:false,focus:0,actions:[],messages:[],conversation:[],awaitingReply:false,replyStreaming:false,avatarExpanded:false,avatarLabel:'',lastQuestion:'',draft:'',voiceNoteLabel:'',listening:false,recognizing:false,sending:false,toast:'',scrollTop:0,scrollIntoView:''},
  onLoad(params={}) {
    this._active=true;this._avatarStartedAt=Date.now();this._avatarMode='boot';this._avatarModeAt=this._avatarStartedAt;this._avatar=createPixelAvatar();this._audioLevel=0;this._replyBaseline=new Map();this._generation=0;this._counter=0;
    this._recognition=createVoiceInput({wx});
    this.applyLabels();
    setEncodingAPI(wx);initMuse(wx,params);this.setupVoice();this.refreshActions();this.checkConnection();this.pollBridge();
    trace('loaded',{release:'0.3.1',voiceInput:'muse-voice-note',bluetooth:typeof navigator!=='undefined'&&!!navigator.bluetooth});
    if(params.draft) this.setData({draft:String(params.draft).slice(0,2000)});
    this.refreshActions();
  },
  onReady(){this._avatarReady=true;this.startAvatar();},
  onShow(){this._active=true;resumeMuse();if(this._pollPaused){this._pollPaused=false;this.pollBridge();}if(this._avatarReady)this.startAvatar();},
  onHide(){this._active=false;this.cleanup();},
  onUnload(){this._active=false;this.cleanup();},
  cleanup(){stopMuse();this._pollPaused=true;cancelTimer(this._avatarTimer);this._avatarTimer=null;cancelTimer(this._pollTimer);cancelTimer(this._pressTimer);cancelTimer(this._tapTimer);cancelTimer(this._scanTimer);cancelTimer(this._toastTimer);this._generation++;if(this._scan)this._scan.stop();this._scan=null;this._scanning=false;this._pressAt=0;this._tapTimer=null;if(this._recognition)this._recognition.abort();this._voiceNote=null;this.setData({listening:false,recognizing:false,voiceNoteLabel:'',avatarExpanded:false});if(this._gatt)this._gatt.disconnect().catch(()=>{});},
  startAvatar(){
    cancelTimer(this._avatarTimer);
    if(!this._active||!this._avatarReady)return;
    // A persistent page node avoids rebinding a Canvas on every conversation update.
    if(!this._avatarContext)this._avatarContext=wx.createCanvasContext('museAvatar');
    if(!this._avatarContext){trace('avatar.unavailable');return;}
    if(!this._avatarImage)this._avatarImage=this._avatarContext.createImageData(192,192);
    this.drawAvatar();
  },
  avatarError(){this._avatarErrorUntil=Date.now()+4500;},
  applyLabels(){
    const state=this.data.connectionState;
    const status=state==='online'?mt('connected'):state==='offline'?(this.data.bridgeOnline?mt('serviceUnpaired'):mt('serviceStopped')):(this.data.museReady?mt('cloudConnecting'):mt('loading'));
    this.setData({title:'Muse',status,voiceHint:mt('holdToTalk'),draftLabel:mt('draft'),avatarLabel:mt(this._avatarMode==='boot'?'starting':this._avatarMode==='idle'?'idle':this._avatarMode==='listening'?'listening':this._avatarMode==='thinking'?(this.data.replyStreaming?'replying':this.data.awaitingReply?'waiting':'thinking'):'error')});
    this.refreshActions();
  },
  drawAvatar(){
    if(!this._active)return;
    const now=Date.now();
    if(this.data.awaitingReply&&now-this._replyStartedAt>120000){
      this.setData({awaitingReply:false,replyStreaming:false,avatarExpanded:false});this.avatarError();this.toast(mt('replyTimeout'));this.refreshActions();
    }
    const state=avatarState(this.data,now,this._avatarStartedAt,this._avatarErrorUntil||0);
    if(state.mode!==this._avatarMode){this._avatarMode=state.mode;this._avatarModeAt=now;}
    const avatarLabel=mt(state.mode==='boot'?'starting':state.mode==='idle'?'idle':state.mode==='listening'?'listening':state.mode==='thinking'?(this.data.replyStreaming?'replying':this.data.awaitingReply?'waiting':'thinking'):'error');
    if(avatarLabel!==this.data.avatarLabel)this.setData({avatarLabel});
    if(this.data.connectionState==='connecting')this.setData({loaderAngle:Math.floor((now-this._avatarStartedAt)%1200*360/1200)});
    this._audioLevel*=0.9;
    try{
      this._avatar.render({mode:state.mode,t:(now-this._avatarStartedAt)/1000,modeTime:(now-this._avatarModeAt)/1000,level:this.data.listening?this._audioLevel:0});
      // One persistent surface moves/scales in the layout; keep the upstream RGB palette.
      this._avatar.writeRGBA(this._avatarImage.data,192,false);
      this._avatarContext.putImageData(this._avatarImage,0,0);
    }catch(error){trace('avatar.error',{message:error.message});return;}
    this._avatarTimer=setTimeout(()=>this.drawAvatar(),state.mode==='idle'||(state.mode==='error'&&now-this._avatarModeAt>600)?100:40);
  },
  updateReplies(messages){
    const conversation=this.data.conversation.slice();
    for(const message of messages){
      const row={id:message.id,role:'assistant',text:message.text,done:message.done};
      const index=conversation.findIndex(item=>item.role==='assistant'&&item.id===message.id);
      if(index<0)conversation.push(row);else conversation[index]=row;
    }
    const fresh=this.data.awaitingReply?newTurnReplies(messages,this._replyBaseline):[];
    const latest=fresh[fresh.length-1];
    this.setData({messages,conversation:conversation.slice(-12),
      awaitingReply:this.data.awaitingReply&&!(latest&&latest.done),
      replyStreaming:!!(latest&&!latest.done),
      avatarExpanded:this.data.avatarExpanded&&!latest,
      ...(this.data.avatarExpanded&&latest?{scrollIntoView:latest.id,scrollTop:0}:{})});
  },
  toast(text){if(!this._active)return;this.setData({toast:text});cancelTimer(this._toastTimer);this._toastTimer=setTimeout(()=>{if(this._active)this.setData({toast:''});},4500);},
  async checkConnection(){
    try{const result=await requestBridge('/health');if(!this._active)return;
      const connectionState=result.message_channel==='connected'?'online':['connecting','reconnecting'].includes(result.message_channel)?'connecting':'offline';
      const bridgeOnline=true,museReady=result.muse==='paired';
      this.setData({authorizationHint:result.authorization_error||'',bridgeOnline,museReady,channelReady:result.message_channel==='connected',connectionState,status:connectionState==='online'?mt('connected'):connectionState==='connecting'?(museReady?mt('cloudConnecting'):mt('loading')):mt('serviceUnpaired')});
      trace('health',{bridge:result.bridge,muse:result.muse,transport:result.transport});
      if(result.error&&result.error!==this._connectionError)trace('connection.error',{message:result.error});this._connectionError=result.error||'';
    }catch(error){if(this._active)this.setData({bridgeOnline:false,museReady:false,channelReady:false,connectionState:'offline',status:mt('serviceStopped')});trace('health.error',{message:error.message});}
    if(this._active)this.refreshActions();
  },
  async pollBridge(){
    if(!this._active||this._pollBusy)return;this._pollBusy=true;
    try{const result=await requestBridge('/events');if(this._active&&result.revision!==this._revision){this._revision=result.revision;this.updateReplies((result.messages||[]).slice(-6));
      if(!result.transcript)this._transcriptCleared=true;
      if(result.transcript&&this._activeUserId&&this._sentVoiceNote&&(this._transcriptCleared||this._replyBaseline.size===0||newTurnReplies(this.data.messages,this._replyBaseline).length)){
        const conversation=this.data.conversation.map(item=>item.id===this._activeUserId?{...item,text:result.transcript}:item);
        this.setData({conversation,lastQuestion:result.transcript});
      }this.refreshActions();trace('reply.update',{messages:this.data.messages.length});}if(++this._counter%5===0)await this.checkConnection();}
    catch(error){trace('poll.error',{message:error.message});}
    finally{this._pollBusy=false;if(this._active)this._pollTimer=setTimeout(()=>this.pollBridge(),1000);}
  },
  refreshActions(){
    let actions;
    if(this.data.listening)actions=[{id:'stopVoice',label:mt('stopSpeaking')},{id:'cancelVoice',label:mt('cancel')}];
    else if(this.data.recognizing||this.data.sending||this.data.awaitingReply)actions=[];
    else if(this.data.draft||this.data.voiceNoteLabel)actions=[{id:'send',label:mt('send')},{id:'voice',label:mt('retryInput')},{id:'clear',label:mt('undo')}];
    else actions=[];
    this.setData({actions,focus:Math.max(0,Math.min(this.data.focus,actions.length-1))});
  },
  openChat(){this.setData({surface:'chat',focus:0});this.refreshActions();trace('chat.open');},
  activate(){const action=this.data.actions[this.data.focus];if(action)this.runAction(action.id);},
  handleAction(event){this.runAction(event.currentTarget.dataset.action);},
  runAction(id){trace('action',{id});
    if(id==='voice')this.startVoice();
    if(id==='stopVoice')this.stopVoice();
    if(id==='cancelVoice')this.cancelVoice();
    if(id==='clear'){this._voiceNote=null;this.setData({draft:'',voiceNoteLabel:'',focus:0,avatarExpanded:false});this.refreshActions();}
    if(id==='send')this.sendMessage();
  },
  goBack(){
    if(this.data.listening||this.data.recognizing){this.cancelVoice();return true;}
    if(this.data.draft||this.data.voiceNoteLabel){this._voiceNote=null;this.setData({draft:'',voiceNoteLabel:'',focus:0,avatarExpanded:false});this.refreshActions();return true;}
    return false;
  },
  scrollMessages(step){
    // scroll-view exposes no scroll callback; bound the requested offset using
    // wrapped line counts so repeated down presses cannot accumulate indefinitely.
    const rows=this.data.conversation.concat(this.data.draft?[{role:'user',text:this.data.draft}]:[]);
    // Allow space for Markdown block margins and larger headings. The native
    // scroll-view clamps the actual offset to its rendered content height.
    const content=rows.reduce((height,row)=>height+String(row.text||'').split('\n').reduce((lines,line)=>lines+Math.max(1,Math.ceil(line.length/26)),0)*(row.role==='assistant'?44:27)+(row.role==='assistant'?24:0),0)+(this.data.voiceNoteLabel?54:0);
    const limit=Math.max(0,content-(this.data.avatarExpanded?96:288));
    this.setData({scrollIntoView:'',scrollTop:Math.max(0,Math.min(limit,this.data.scrollTop+step))});
  },
  onKeyDown(event){
    if(event.code!=='Enter'||this._pressAt)return;
    this._pressAt=Date.now();this._long=false;
    this._pressTimer=setTimeout(()=>{this._long=true;cancelTimer(this._tapTimer);if(this.data.surface==='chat'&&!this.data.listening&&!this.data.recognizing&&!this.data.sending)this.startVoice();},LONG_PRESS_MENU_MS);
  },
  onKeyUp(event){
    if(event.code==='Backspace'){if(this.goBack())event.preventDefault();return;}
    if(event.code==='ArrowUp'||event.code==='ArrowDown'){
      event.preventDefault();cancelTimer(this._pressTimer);cancelTimer(this._tapTimer);this._tapTimer=null;this._long=true;
      if(this.data.actions.length>1){
        const step=event.code==='ArrowDown'?1:-1;
        this.setData({focus:(this.data.focus+step+this.data.actions.length)%this.data.actions.length});
      }else this.scrollMessages(event.code==='ArrowDown'?100:-100);
      return;
    }
    if(event.code!=='Enter')return;
    event.preventDefault();cancelTimer(this._pressTimer);this._pressAt=0;
    if(this._long)return;
    if(this.data.listening){this.activate();return;}
    if(this._tapTimer){cancelTimer(this._tapTimer);this._tapTimer=null;this.goBack();return;}
    this._tapTimer=setTimeout(()=>{this._tapTimer=null;if(this._active)this.activate();},280);
  },
  onVoiceWakeup(event){if(event.preventDefault)event.preventDefault();cancelTimer(this._pressTimer);this._long=true;this.openChat();this.startVoice();},
  setupVoice(){
    const r=this._recognition;
    r.onlevel=(level)=>{if(this._active)this._audioLevel=this._audioLevel*0.35+level*0.65;};
    r.onstart=()=>{if(!this._active)return;this.setData({listening:true,recognizing:false,avatarExpanded:true});this.refreshActions();trace('voice.start');};
    r.onstopping=()=>{if(this._active){this.setData({listening:false,recognizing:true,avatarExpanded:true});this.refreshActions();}};
    r.onrecorded=(note)=>{if(!this._active)return;this._voiceNote=note;this.setData({voiceNoteLabel:mt('recorded',{seconds:note.duration.toFixed(1)})});trace('voice.recorded',{seconds:note.duration});};
    r.onerror=(event)=>{if(!this._active)return;this.setData({listening:false,recognizing:false,avatarExpanded:false});this.avatarError();this.refreshActions();this.toast(mt('speechFailed'));trace('voice.error',{error:event.error});};
    r.onend=()=>{if(!this._active)return;this.setData({listening:false,recognizing:false,focus:0,avatarExpanded:!!this._voiceNote});this.refreshActions();trace('voice.end',{hasNote:!!this._voiceNote});};
  },
  startVoice(){this._avatarErrorUntil=0;if(this.data.listening||this.data.recognizing||this.data.sending||this.data.awaitingReply)return;this._voiceNote=null;this.setData({surface:'chat',draft:'',voiceNoteLabel:'',recognizing:true,focus:0,avatarExpanded:true});this.refreshActions();this._recognition.start();},
  stopVoice(){this.setData({listening:false,recognizing:true,focus:0,avatarExpanded:true});this.refreshActions();this._recognition.stop();},
  cancelVoice(){this._recognition.abort();this._voiceNote=null;this.setData({listening:false,recognizing:false,draft:'',voiceNoteLabel:'',focus:0,avatarExpanded:false});this.refreshActions();},
  async sendMessage(){
    if((!this._voiceNote&&!this.data.draft.trim())||this.data.sending||this.data.awaitingReply)return;
    const note=this._voiceNote;const submittedText=note?mt('voiceMessage',{seconds:note.duration.toFixed(1)}):this.data.draft;
    this._avatarErrorUntil=0;this._replyStartedAt=Date.now();
    this._replyBaseline=new Map(this.data.messages.map(message=>[message.id,message.text]));
    const userId='user-'+this._replyStartedAt;
    this._activeUserId=userId;this._sentVoiceNote=!!note;this._transcriptCleared=false;
    this.setData({sending:true,awaitingReply:true,replyStreaming:false,avatarExpanded:true,scrollIntoView:userId,
      conversation:this.data.conversation.concat({id:userId,role:'user',text:submittedText,done:true}).slice(-12)});this.refreshActions();
    try{const result=await requestBridge(note?'/voice-notes':'/messages',note?{pcm_base64:note.pcm_base64}:{text:this.data.draft},75000);if(!result.muse_sent)throw new Error(mt('museNotConfirmed'));if(this._active){this._voiceNote=null;this.setData({draft:'',voiceNoteLabel:'',lastQuestion:submittedText,focus:0,scrollTop:0});if(!this.data.awaitingReply)this.toast(mt('museReplied'));trace('send.accepted');}}
    catch(error){if(this._active){this._activeUserId=null;this.setData({awaitingReply:false,replyStreaming:false,avatarExpanded:false,scrollIntoView:'',conversation:this.data.conversation.filter(item=>item.id!==userId)});this.avatarError();this.toast(error.message);}trace('send.failed',{message:error.message});}
    finally{if(this._active){this.setData({sending:false});this.refreshActions();}}
  }
};
