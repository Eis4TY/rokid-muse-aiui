import wx from 'wx';
import {createVoiceInput} from '../../lib/voice-input.js';
import {LONG_PRESS_MENU_MS} from '../../lib/prism-gesture.js';
import {requestBridge,SERVICE_UUID,RX_UUID,TX_UUID,createFrameAssembler} from '../../lib/muse-transport.js';

function cancelTimer(id) { if(id !== undefined && id !== null) clearTimeout(id); }
function trace(event, data={}) {console.log('[MuseDemo]',JSON.stringify({event,...data}));}
export default {
  data:{surface:'inbox',title:'Muse',status:'检查连接中',bridgeOnline:false,museReady:false,channelReady:false,focus:0,actions:[],messages:[],lastQuestion:'',draft:'',voiceNoteLabel:'',listening:false,recognizing:false,sending:false,toast:'',diagnostics:[],scrollTop:0,scrollIntoView:''},
  onLoad(params={}) {
    this._active=true;this._generation=0;this._devices=new Map();this._lines=[];this._counter=0;
    this._recognition=createVoiceInput({wx});
    this.setupVoice();this.refreshActions();this.checkConnection();this.pollBridge();
    trace('loaded',{voiceInput:'muse-voice-note',bluetooth:!!(navigator&&navigator.bluetooth)});
    if(params.draft) this.setData({draft:String(params.draft).slice(0,2000)});
    if(params.screen==='chat')this.openChat();
    if(params.screen==='diagnostics'){this.setData({surface:'diagnostics'});this.refreshActions();}
    if(params.checkTransport==='true')this.transportCheck('Muse demo device transport check');
  },
  onShow(){this._active=true;if(this._pollPaused){this._pollPaused=false;this.pollBridge();}},
  onHide(){this._active=false;this.cleanup();},
  onUnload(){this._active=false;this.cleanup();},
  cleanup(){this._pollPaused=true;cancelTimer(this._pollTimer);cancelTimer(this._pressTimer);cancelTimer(this._tapTimer);cancelTimer(this._scanTimer);cancelTimer(this._toastTimer);this._generation++;if(this._scan)this._scan.stop();this._scan=null;this._scanning=false;this._pressAt=0;this._tapTimer=null;if(this._recognition)this._recognition.abort();this._voiceNote=null;if(this._gatt)this._gatt.disconnect().catch(()=>{});},
  toast(text){if(!this._active)return;this.setData({toast:text});cancelTimer(this._toastTimer);this._toastTimer=setTimeout(()=>{if(this._active)this.setData({toast:''});},4500);},
  line(text){this._lines=(this._lines||[]).concat(text).slice(-7);if(this._active)this.setData({diagnostics:this._lines.map((text,index)=>({id:String(index),text}))});trace('diagnostic',{text});},
  async checkConnection(){
    try{const result=await requestBridge('/health');if(!this._active)return;
      this.setData({bridgeOnline:true,museReady:result.muse==='paired',channelReady:result.message_channel==='connected',status:result.message_channel==='connected'?'Muse 在线':result.muse==='paired'?'Muse 云端连接中':'服务在线 · Muse 未配对'});
      trace('health',{bridge:result.bridge,muse:result.muse,transport:result.transport});
      if(result.error&&result.error!==this._connectionError)this.line(result.error);this._connectionError=result.error||'';
    }catch(error){if(this._active)this.setData({bridgeOnline:false,museReady:false,channelReady:false,status:'眼镜服务未启动'});trace('health.error',{message:error.message});}
    if(this._active)this.refreshActions();
  },
  async pollBridge(){
    if(!this._active||this._pollBusy)return;this._pollBusy=true;
    try{const result=await requestBridge('/events');if(this._active&&result.revision!==this._revision){this._revision=result.revision;this.setData({messages:(result.messages||[]).slice(-6),...(result.transcript?{lastQuestion:result.transcript}:{})});this.refreshActions();trace('reply.update',{messages:this.data.messages.length});}if(++this._counter%5===0)await this.checkConnection();}
    catch(error){trace('poll.error',{message:error.message});}
    finally{this._pollBusy=false;if(this._active)this._pollTimer=setTimeout(()=>this.pollBridge(),1000);}
  },
  refreshActions(){
    let actions;
    if(this.data.surface==='inbox')actions=[{id:'chat',label:'打开会话'},{id:'diagnostics',label:'连接诊断'}];
    else if(this.data.surface==='diagnostics')actions=[{id:'connection',label:'检查连接'},{id:'transport',label:'验证传输'},{id:'back',label:'返回'}];
    else if(this.data.listening)actions=[{id:'stopVoice',label:'说完了'},{id:'cancelVoice',label:'取消'}];
    else if(this.data.recognizing||this.data.sending)actions=[{id:'waiting',label:this.data.recognizing?'整理录音中':'发送中'}];
    else if(this.data.draft||this.data.voiceNoteLabel)actions=[{id:'send',label:'发送'},{id:'voice',label:'重新输入'},{id:'clear',label:'撤销输入'}];
    else actions=[{id:'voice',label:'语音输入'},this.data.messages.length?{id:'read',label:'阅读回复'}:{id:'diagnostics',label:'连接诊断'},{id:'back',label:'返回'}];
    this.setData({actions,focus:Math.min(this.data.focus,actions.length-1)});
  },
  openChat(){this.setData({surface:'chat',focus:0});this.refreshActions();trace('chat.open');},
  activate(){const action=this.data.actions[this.data.focus];if(action)this.runAction(action.id);},
  handleAction(event){this.runAction(event.currentTarget.dataset.action);},
  runAction(id){trace('action',{id});
    if(id==='chat')this.openChat();
    if(id==='diagnostics'){this.setData({surface:'diagnostics',focus:0});this.refreshActions();this.checkConnection();}
    if(id==='back')this.goBack();
    if(id==='voice')this.startVoice();
    if(id==='stopVoice')this.stopVoice();
    if(id==='cancelVoice')this.cancelVoice();
    if(id==='clear'){this._voiceNote=null;this.setData({draft:'',voiceNoteLabel:'',focus:0});this.refreshActions();}
    if(id==='send')this.sendMessage();
    if(id==='read'){const total=this.data.messages.reduce((sum,m)=>sum+50+Math.ceil(m.text.length/24)*27,0);this.setData({scrollTop:this.data.scrollTop+130>total?0:this.data.scrollTop+130});}
    if(id==='connection')this.checkConnection();
    if(id==='transport')this.transportCheck('Muse demo device transport check');
  },
  goBack(){if(this.data.listening||this.data.recognizing){this.cancelVoice();return;}
    this.setData({surface:this.data.surface==='diagnostics'?'chat':'inbox',focus:0});this.refreshActions();},
  onKeyDown(event){
    if(event.code!=='Enter'||this._pressAt)return;
    this._pressAt=Date.now();this._long=false;
    this._pressTimer=setTimeout(()=>{this._long=true;cancelTimer(this._tapTimer);if(this.data.surface==='chat'&&!this.data.listening&&!this.data.recognizing&&!this.data.sending)this.startVoice();},LONG_PRESS_MENU_MS);
  },
  onKeyUp(event){
    if(event.code==='Backspace'){if(this.data.surface==='inbox')return;event.preventDefault();this.goBack();return;}
    if(event.code==='ArrowUp'||event.code==='ArrowDown'){
      event.preventDefault();cancelTimer(this._pressTimer);this._long=true;
      const step=event.code==='ArrowDown'?1:-1;this.setData({focus:(this.data.focus+step+this.data.actions.length)%this.data.actions.length});trace('focus',{index:this.data.focus});return;
    }
    if(event.code!=='Enter')return;
    event.preventDefault();cancelTimer(this._pressTimer);this._pressAt=0;
    if(this._long)return;
    if(this.data.listening){this.stopVoice();return;}
    if(this._tapTimer){cancelTimer(this._tapTimer);this._tapTimer=null;this.goBack();return;}
    this._tapTimer=setTimeout(()=>{this._tapTimer=null;if(this._active)this.activate();},280);
  },
  onVoiceWakeup(event){if(event.preventDefault)event.preventDefault();cancelTimer(this._pressTimer);this._long=true;this.openChat();this.startVoice();},
  setupVoice(){
    const r=this._recognition;
    r.onstart=()=>{if(!this._active)return;this.setData({listening:true,recognizing:false});this.refreshActions();trace('voice.start');};
    r.onstopping=()=>{if(this._active){this.setData({listening:false,recognizing:true});this.refreshActions();}};
    r.onrecorded=(note)=>{if(!this._active)return;this._voiceNote=note;this.setData({voiceNoteLabel:'已录音 '+note.duration.toFixed(1)+' 秒，确认后发送'});trace('voice.recorded',{seconds:note.duration});};
    r.onerror=(event)=>{if(!this._active)return;this.setData({listening:false,recognizing:false});this.refreshActions();this.toast(event.message||'语音识别失败');trace('voice.error',{error:event.error});};
    r.onend=()=>{if(!this._active)return;this.setData({listening:false,recognizing:false,focus:0});this.refreshActions();trace('voice.end',{hasNote:!!this._voiceNote});};
  },
  startVoice(){if(this.data.listening||this.data.recognizing||this.data.sending)return;this._voiceNote=null;this.setData({surface:'chat',draft:'',voiceNoteLabel:'',recognizing:true,focus:0});this.refreshActions();this._recognition.start();},
  stopVoice(){this.setData({listening:false,recognizing:true,focus:0});this.refreshActions();this._recognition.stop();},
  cancelVoice(){this._recognition.abort();this._voiceNote=null;this.setData({listening:false,recognizing:false,draft:'',voiceNoteLabel:'',focus:0});this.refreshActions();},
  async sendMessage(){
    if((!this._voiceNote&&!this.data.draft.trim())||this.data.sending)return;
    const note=this._voiceNote;const submittedText=note?'语音消息（'+note.duration.toFixed(1)+' 秒）':this.data.draft;this.setData({sending:true});this.refreshActions();
    try{const result=await requestBridge(note?'/voice-notes':'/messages',note?{pcm_base64:note.pcm_base64}:{text:this.data.draft},75000);if(!result.muse_sent)throw new Error('Muse 尚未确认接收');if(this._active){this._voiceNote=null;this.setData({draft:'',voiceNoteLabel:'',lastQuestion:submittedText,focus:0,scrollTop:0});this.toast('Muse 已接收，正在等待回复');trace('send.accepted');}}
    catch(error){if(this._active)this.toast(error.message);trace('send.failed',{message:error.message});}
    finally{if(this._active){this.setData({sending:false});this.refreshActions();}}
  },
  async transportCheck(text){try{const result=await requestBridge('/transport-check',{text});this.line('眼镜本机传输通过 · '+result.characters+' 字符');this.toast('本地传输通过，未发送给 Muse');trace('transport.ok',{characters:result.characters,museSent:result.muse_sent});}catch(error){this.line('传输失败：'+error.message);}},
  async scanBluetooth(){
    if(this._scanning)return;this._scanning=true;const generation=++this._generation;
    this.line('正在检查蓝牙');
    try{
      if(!navigator.bluetooth)throw new Error('当前运行时未提供蓝牙 API');
      const available=await navigator.bluetooth.getAvailability();this.line('蓝牙可用：'+available);if(!available)throw new Error('蓝牙不可用');
      const scan=await navigator.bluetooth.scanDevices({filters:[{services:[SERVICE_UUID]}],optionalServices:[SERVICE_UUID]});
      if(generation!==this._generation||!this._active){scan.stop();return;}
      this._scan=scan;this._devices.clear();
      scan.onDeviceFound(event=>{const d=event.device;if(!d||this._devices.has(d.id)||generation!==this._generation)return;this._devices.set(d.id,d);trace('ble.found',{name:d.name||'(unnamed)'});this.line('找到 Muse 服务 · '+(d.name||'未命名设备'));if(!this._connecting)this.connectProbe(d,generation);});
      this.line('扫描 12 秒 · 寻找 MuseGadget');
      this._scanTimer=setTimeout(()=>{scan.stop();this._scan=null;this._scanning=false;if(this._active)this.line('扫描结束 · '+this._devices.size+' 个设备');},12000);
    }catch(error){this._scanning=false;this.line('蓝牙检查失败：'+error.message);}
  },
  async connectProbe(device,generation){
    this._connecting=true;
    try{const gatt=await device.gatt.connect();this._gatt=gatt;this.line('GATT 已连接');
      const service=await gatt.getPrimaryService(SERVICE_UUID);
      const tx=await service.getCharacteristic(TX_UUID);const rx=await service.getCharacteristic(RX_UUID);
      const assemble=createFrameAssembler(message=>{if(generation!==this._generation||!this._active)return;trace('ble.device_info',{type:message.type,model:message.model,protocol:message.pairing_protocol});if(message.type==='device_info')this.line('设备信息通过 · '+message.model+' v'+message.pairing_protocol);});
      tx.addEventListener('characteristicvaluechanged',()=>assemble(tx.value));await tx.startNotifications();
      const data=new TextEncoder().encode(JSON.stringify({action:'get_device_info'}));
      // ATT MTU 23: at most 20 bytes per write, including the 3-byte framing header.
      const count=Math.ceil(data.length/17);
      for(let i=0;i<count;i++)await rx.writeValueWithResponse([254,i,count,...data.slice(i*17,(i+1)*17)]);
      this.line('已请求设备信息');
    }catch(error){this.line('GATT 失败：'+error.message);}finally{this._connecting=false;}
  }
};
