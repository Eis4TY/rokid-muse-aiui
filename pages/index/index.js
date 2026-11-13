import wx from 'wx';
import {AudioPlayer} from 'audio';
import {createPixelAvatar} from '../../lib/muse-avatar.js';
import {avatarState,newTurnReplies} from '../../lib/muse-avatar-state.js';
import {createVoiceInput} from '../../lib/voice-input.js';
import {LONG_PRESS_MENU_MS} from '../../lib/prism-gesture.js';
import {initMuse,resumeMuse,stopMuse,setEncodingAPI,requestBridge,startMuseVoice} from '../../lib/muse-transport.js';
import {mt} from '../../lib/muse-i18n.js';

function cancelTimer(id) { if(id !== undefined && id !== null) clearTimeout(id); }
function trace(event, data={}) {console.log('[Muse]',JSON.stringify({event,...data}));}
export default {
  data:{callConnectingLabel:mt('callConnecting'),callLiveLabel:mt('callLive'),surface:'chat',timeline:[],callState:'',title:'Muse',status:'',authorizationHint:'',connectionState:'connecting',loaderAngle:0,bridgeOnline:false,museReady:false,channelReady:false,focus:0,actions:[],messages:[],conversation:[],awaitingReply:false,replyStreaming:false,avatarExpanded:false,avatarLabel:'',lastQuestion:'',draft:'',voiceNoteLabel:'',listening:false,recognizing:false,sending:false,toast:'',scrollTop:0,scrollIntoView:'',latestPreview:false,latestRows:[]},
  onLoad(params={}) {
    this._active=true;this._avatarStartedAt=Date.now();this._avatarMode='boot';this._avatarModeAt=this._avatarStartedAt;this._avatar=createPixelAvatar();this._audioLevel=0;this._replyBaseline=new Map();this._generation=0;this._counter=0;
    this._recognition=createVoiceInput({wx});
    this.applyLabels();
    setEncodingAPI(wx);initMuse(wx,params);this.setupVoice();this.refreshActions();this.checkConnection();this.pollBridge();
    trace('loaded',{release:'0.3.1-history-voice',voiceInput:'muse-voice-note',bluetooth:typeof navigator!=='undefined'&&!!navigator.bluetooth});
    if(params.draft) this.setData({draft:String(params.draft).slice(0,2000)});
    this.refreshActions();
  },
  onReady(){this._avatarReady=true;this.startAvatar();},
  onShow(){this._active=true;resumeMuse();if(this._pollPaused){this._pollPaused=false;this.pollBridge();}if(this._avatarReady)this.startAvatar();},
  onHide(){this._active=false;this.cleanup();},
  onUnload(){this._active=false;this.cleanup();},
  cleanup(){this._historyRequest=null;this._historyLoaded=false;this._historyCursor=null;this._historyRetryAt=0;this._historyScrollMoved=false;this._call?.end();this._menu=false;stopMuse();this._pollPaused=true;cancelTimer(this._avatarTimer);this._avatarTimer=null;cancelTimer(this._pollTimer);cancelTimer(this._pressTimer);cancelTimer(this._tapTimer);cancelTimer(this._scanTimer);cancelTimer(this._toastTimer);this._generation++;if(this._scan)this._scan.stop();this._scan=null;this._scanning=false;this._pressAt=0;this._tapTimer=null;if(this._recognition)this._recognition.abort();this._voiceNote=null;this.setData({listening:false,recognizing:false,voiceNoteLabel:'',avatarExpanded:false,surface:'chat',callState:'',latestPreview:false,scrollIntoView:'',scrollTop:0});if(this._gatt)this._gatt.disconnect().catch(()=>{});},
  startAvatar(){
    cancelTimer(this._avatarTimer);
    if(!this._active||!this._avatarReady||this.data.callState)return;
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
    if(!this._active||this.data.callState)return;
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
    this.setConversation(conversation.slice(-12),{messages,
      awaitingReply:this.data.awaitingReply&&!(latest&&latest.done),
      replyStreaming:!!(latest&&!latest.done),
      avatarExpanded:this.data.avatarExpanded&&!latest,
      ...(this.data.surface==='chat'&&this.data.avatarExpanded&&latest?{latestPreview:false,scrollIntoView:latest.id,scrollTop:0}:{})});
  },
  setConversation(conversation, patch={}){
    if(patch.scrollIntoView&&patch.scrollIntoView!=='timeline-end')patch={latestPreview:false,...patch};
    const liveIds=new Set(conversation.map(row=>row.id));
    const history=(this._history||[]).filter(row=>!liveIds.has(row.id));
    const timeline=[...history,...conversation];
    this.setData({...patch,conversation,timeline,latestRows:timeline.slice(-8)});
  },
  toast(text){if(!this._active)return;this.setData({toast:text});cancelTimer(this._toastTimer);this._toastTimer=setTimeout(()=>{if(this._active)this.setData({toast:''});},4500);},
  async checkConnection(){
    try{const result=await requestBridge('/health');if(!this._active)return;
      const connectionState=result.message_channel==='connected'?'online':['connecting','reconnecting'].includes(result.message_channel)?'connecting':'offline';
      const bridgeOnline=true,museReady=result.muse==='paired';
      this.setData({authorizationHint:result.authorization_error||'',bridgeOnline,museReady,channelReady:result.message_channel==='connected',connectionState,status:connectionState==='online'?mt('connected'):connectionState==='connecting'?(museReady?mt('cloudConnecting'):mt('loading')):mt('serviceUnpaired')});
      if(connectionState==='online')void this.loadHistory();
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
        this.setConversation(conversation,{lastQuestion:result.transcript});
      }this.refreshActions();trace('reply.update',{messages:this.data.messages.length});}if(++this._counter%5===0)await this.checkConnection();}
    catch(error){trace('poll.error',{message:error.message});}
    finally{this._pollBusy=false;if(this._active)this._pollTimer=setTimeout(()=>this.pollBridge(),1000);}
  },
  refreshActions(){
    let actions;
    if(this.data.callState)actions=this.data.callState==='live'?[{id:'hangup',label:mt('hangup')},{id:'interrupt',label:mt('interrupt')}]:[{id:'hangup',label:mt('cancel')}];
    else if(this._menu)actions=[{id:'call',label:mt('call')}];
    else if(this.data.listening)actions=[{id:'stopVoice',label:mt('stopSpeaking')},{id:'cancelVoice',label:mt('cancel')}];
    else if(this.data.recognizing||this.data.sending||this.data.awaitingReply)actions=[];
    else if(this.data.draft||this.data.voiceNoteLabel)actions=[{id:'send',label:mt('send')},{id:'voice',label:mt('retryInput')},{id:'clear',label:mt('undo')}];
    else actions=[];
    this.setData({actions,focus:Math.max(0,Math.min(this.data.focus,actions.length-1))});
  },
  openMenu(){this._menu=true;this.setData({focus:0});this.refreshActions();},
  openChat(){this.setData({surface:'chat',focus:0});this.refreshActions();trace('chat.open');},
  activate(){const action=this.data.actions[this.data.focus];if(action)this.runAction(action.id);},
  handleAction(event){this.runAction(event.currentTarget.dataset.action);},
  runAction(id){trace('action',{id});
    if(id==='call')this.openCall();
    if(id==='hangup')this._call?.end();
    if(id==='interrupt')this._call?.bargeIn();
    if(id==='voice')this.startVoice();
    if(id==='stopVoice')this.stopVoice();
    if(id==='cancelVoice')this.cancelVoice();
    if(id==='clear'){this._voiceNote=null;this.setData({draft:'',voiceNoteLabel:'',focus:0,avatarExpanded:false});this.refreshActions();}
    if(id==='send')this.sendMessage();
  },
  async loadHistory(older=false){
    if(!this._active||this._historyRequest||Date.now()<(this._historyRetryAt||0))return;
    if(older?!this._historyCursor:this._historyLoaded)return;
    const cursor=older?this._historyCursor:8;
    const current={};this._historyRequest=current;
    try{
      const page=await requestBridge('/history',{cursor});
      if(this._historyRequest!==current)return;
      if(older&&typeof cursor==='string'){
        const rows=new Map([...page.messages,...this._history].map(row=>[row.id,row]));
        this._history=[...rows.values()];
      }else this._history=page.messages;
      this._historyCursor=page.cursor===cursor?null:page.cursor;
      this._historyLoaded=true;
      const followLatest=!older&&page.messages.length&&!this._historyScrollMoved&&!this.data.scrollIntoView;
      this.setConversation(this.data.conversation,followLatest?{latestPreview:true,scrollIntoView:'timeline-end'}:{});
      trace('history.loaded',{count:page.messages.length});
    }catch(error){
      if(this._historyRequest!==current)return;
      this._historyRetryAt=Date.now()+15000;
      trace('history.error',{message:error.message});
    }finally{
      if(this._historyRequest===current)this._historyRequest=null;
    }
  },
  openCall(){
    if(this._call||this.data.sending||this.data.listening||this.data.recognizing)return;
    this._menu=false;
    cancelTimer(this._avatarTimer);this._avatarTimer=null;
    this.setData({callState:'connecting',callLiveLabel:mt('callLive'),focus:0});this.refreshActions();
    try{
      this._call=startMuseVoice({
        onReady:()=>{
          if(!this._active)return;
          this.setData({callState:'live'});this.refreshActions();
          this._recognition.start(buffer=>this._call?.capture(buffer));
        },
        onInputStatus:status=>{
          const labels={local:'callLocalAudio',cloud:'callCloudAudio',waiting:'callWaiting',failed:'callTranscriptionFailed'};
          if(this._active&&this.data.callState==='live')this.setData({callLiveLabel:mt(labels[status])});
        },
        onAudio:pcm=>{
          const start=!this._player;
          if(start&&this._active)this.setData({callLiveLabel:mt('callReplying')});
          const player=this._player||new AudioPlayer({format:'pcm',sampleRate:24000,channels:1});
          this._player=player;
          const failed=()=>{if(this._player===player)this._call?.end(new Error(mt('playbackFailed')));};
          player.append(pcm.buffer)?.catch?.(failed);
          if(start)player.play()?.catch?.(failed);
        },
        onFlush:()=>this.stopCallAudio(),
        onEnd:error=>{
          this._call=null;
          try{this._recognition.abort();}
          finally{
            if(this._active){
              this.setData({callState:'',focus:0});this.refreshActions();this.startAvatar();
              this.toast(error?.message||mt('callEnded'));
              trace('call.closed',{error:!!error});
            }
          }
        }
      });
    }catch(error){this.setData({callState:''});this.refreshActions();this.startAvatar();this.toast(error.message);trace('call.error',{message:error.message});}
  },
  stopCallAudio(){
    const player=this._player;this._player=null;
    if(player)player.destroy()?.catch?.(()=>{});
  },
  goBack(){
    if(this._call){this._call.end();return true;}
    if(this._menu){this._menu=false;this.setData({focus:0});this.refreshActions();return true;}
    if(this.data.listening||this.data.recognizing){this.cancelVoice();return true;}
    if(this.data.draft||this.data.voiceNoteLabel){this._voiceNote=null;this.setData({draft:'',voiceNoteLabel:'',focus:0,avatarExpanded:false});this.refreshActions();return true;}
    return false;
  },
  scrollMessages(step){
    // scroll-view exposes no scroll callback; bound the requested offset using
    // wrapped line counts so repeated down presses cannot accumulate indefinitely.
    const rows=this.data.timeline.concat(this.data.draft?[{role:'user',text:this.data.draft}]:[]);
    // Allow space for Markdown block margins and larger headings. The native
    // scroll-view clamps the actual offset to its rendered content height.
    const content=rows.reduce((height,row)=>height+String(row.text||'').split('\n').reduce((lines,line)=>lines+Math.max(1,Math.ceil(line.length/26)),0)*(row.role==='assistant'?44:27)+(row.role==='assistant'?24:0),0)+(this.data.voiceNoteLabel?54:0);
    const limit=Math.max(0,content-(this.data.avatarExpanded?96:288));
    this._historyScrollMoved=true;
    if(this.data.latestPreview){
      if(step>0)return;
      this.setData({latestPreview:false});
    }
    const anchor=this.data.scrollIntoView;
    if(anchor&&rows.length){
      const index=anchor==='timeline-end'?rows.length:rows.findIndex(row=>row.id===anchor);
      if(index>=0){
        const next=index+Math.sign(step);
        if(next<0){void this.loadHistory(true);return;}
        this.setData({scrollIntoView:next>=rows.length?'timeline-end':rows[next].id});
        return;
      }
    }
    const offset=this.data.scrollTop;
    if(step<0&&offset===0)void this.loadHistory(true);
    this.setData({scrollIntoView:'',scrollTop:Math.max(0,Math.min(limit,offset+step))});
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
    if(this.data.callState){this.activate();return;}
    if(this.data.listening){this.activate();return;}
    if(this._tapTimer){cancelTimer(this._tapTimer);this._tapTimer=null;this.goBack();return;}
    this._tapTimer=setTimeout(()=>{this._tapTimer=null;if(this._active){
      if(this.data.surface==='chat'&&!this.data.actions.length&&!this.data.awaitingReply&&!this.data.sending&&!this.data.recognizing)this.openMenu();
      else this.activate();
    }},280);
  },
  onVoiceWakeup(event){if(this._call){event.preventDefault?.();this._call.bargeIn();return;}if(event.preventDefault)event.preventDefault();cancelTimer(this._pressTimer);this._long=true;this.openChat();this.startVoice();},
  setupVoice(){
    const r=this._recognition;
    r.onlevel=(level)=>{if(this._active)this._audioLevel=this._audioLevel*0.35+level*0.65;};
    r.onstart=()=>{if(!this._active||this._call)return;this.setData({listening:true,recognizing:false,avatarExpanded:true});this.refreshActions();trace('voice.start');};
    r.onstopping=()=>{if(this._active){this.setData({listening:false,recognizing:true,avatarExpanded:true});this.refreshActions();}};
    r.onrecorded=(note)=>{if(!this._active)return;this._voiceNote=note;this.setData({voiceNoteLabel:mt('recorded',{seconds:note.duration.toFixed(1)})});trace('voice.recorded',{seconds:note.duration});};
    r.onerror=(event)=>{if(this._call){this._call.end(new Error(mt('speechFailed')));return;}if(!this._active)return;this.setData({listening:false,recognizing:false,avatarExpanded:false});this.avatarError();this.refreshActions();this.toast(mt('speechFailed'));trace('voice.error',{error:event.error});};
    r.onend=()=>{if(!this._active)return;this.setData({listening:false,recognizing:false,focus:0,avatarExpanded:!!this._voiceNote});this.refreshActions();trace('voice.end',{hasNote:!!this._voiceNote});};
  },
  startVoice(){this._avatarErrorUntil=0;if(this._call||this.data.surface!=='chat'||this.data.listening||this.data.recognizing||this.data.sending||this.data.awaitingReply)return;this._menu=false;this._voiceNote=null;this.setData({surface:'chat',draft:'',voiceNoteLabel:'',recognizing:true,focus:0,avatarExpanded:true});this.refreshActions();this._recognition.start();},
  stopVoice(){this.setData({listening:false,recognizing:true,focus:0,avatarExpanded:true});this.refreshActions();this._recognition.stop();},
  cancelVoice(){this._recognition.abort();this._voiceNote=null;this.setData({listening:false,recognizing:false,draft:'',voiceNoteLabel:'',focus:0,avatarExpanded:false});this.refreshActions();},
  async sendMessage(){
    if((!this._voiceNote&&!this.data.draft.trim())||this.data.sending||this.data.awaitingReply)return;
    const note=this._voiceNote;const submittedText=note?mt('voiceMessage',{seconds:note.duration.toFixed(1)}):this.data.draft;
    this._avatarErrorUntil=0;this._replyStartedAt=Date.now();
    this._replyBaseline=new Map(this.data.messages.map(message=>[message.id,message.text]));
    const userId='user-'+this._replyStartedAt;
    this._activeUserId=userId;this._sentVoiceNote=!!note;this._transcriptCleared=false;
    this.setConversation(this.data.conversation.concat({id:userId,role:'user',text:submittedText,done:true}).slice(-12),{sending:true,awaitingReply:true,replyStreaming:false,avatarExpanded:true,scrollIntoView:userId});this.refreshActions();
    try{const result=await requestBridge(note?'/voice-notes':'/messages',note?{pcm_base64:note.pcm_base64}:{text:this.data.draft},75000);if(!result.muse_sent)throw new Error(mt('museNotConfirmed'));if(this._active){this._voiceNote=null;this.setData({draft:'',voiceNoteLabel:'',lastQuestion:submittedText,focus:0,scrollTop:0});if(!this.data.awaitingReply)this.toast(mt('museReplied'));trace('send.accepted');}}
    catch(error){if(this._active){this._activeUserId=null;this.setConversation(this.data.conversation.filter(item=>item.id!==userId),{awaitingReply:false,replyStreaming:false,avatarExpanded:false,scrollIntoView:''});this.avatarError();this.toast(error.message);}trace('send.failed',{message:error.message});}
    finally{if(this._active){this.setData({sending:false});this.refreshActions();}}
  }
};
