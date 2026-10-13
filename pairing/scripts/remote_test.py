#!/usr/bin/env python3
"""Read-only diagnostics plus controlled protocol reconnects. No token export."""
import argparse, datetime, importlib.util, json, re, subprocess, sys, time, zipfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('muse_setup',Path(__file__).with_name('setup.py'))
setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)
PROFILES=['main','official','gadget','scoped','baseline']
OPEN_PROFILES=PROFILES
FIELDS={'release','profile','event','path','status','vm_count','host','vm_id_present','body_mode','app_id','bytes','format','keys','code','error_code','type','ack_session_present','ack_session_matches_request','ack_message_id_present','requested_session_fp','ack_session_fp','session_fp','message_fp','parent_fp','decision','event_type','event_keys','payload_keys','text_characters','kind','accepted_messages','reason','bound','saved','delivered','cloud_verified','already_saved','component_available','muse','bridge','transport','message','text','seq','task_status','task_kind','job_fp','run_fp','channel','is_thread','stream','end','authorization_error'}
EVENTS={'loaded','native.auto','native.auto_failed','health','diagnostic','api_status','authorization_verified','websocket_connect','noise_established','registered','subscription_request','subscription_status','subscription_error','session_failed','message_ack','reply_parse','message_status','reply_event','reply_duplicate','send.accepted','send.failed','frame_received','request_sent','message_headers','connection.error'}

def redact(value):
    if isinstance(value,str):
        value=re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', value)
        value=re.sub(r'(?i)(bearer\s+\S+|(?:access_token|refresh_token|sdk_token|binding_key)\s*[:=]\s*\S+)', '[credential]',value)
        value=re.sub(r'[A-Za-z0-9_+/=-]{40,}', '[long-value]',value)
        return value[:400]
    if isinstance(value,dict):return {k:redact(v) for k,v in value.items() if k in FIELDS}
    if isinstance(value,list):return [redact(v) for v in value[:15]]
    return value

def events(log):
    result=[]
    for line in log.splitlines():
        match=re.search(r'\[(MuseProbe|Muse)\]\s*(\{.*)',line)
        if not match:continue
        try: data=json.JSONDecoder().raw_decode(match[2])[0]
        except (ValueError,TypeError):continue
        if data.get('event') not in EVENTS:continue
        try:stamp=float(line.split()[0])
        except ValueError:stamp=0
        result.append({'timestamp':stamp,'data':redact(data)})
    return result

def capture(device,*args):
    try:
        return setup.run(device.adb+list(args))
    except (RuntimeError,OSError,subprocess.TimeoutExpired) as error:return 'UNAVAILABLE: '+str(error)

def save_report(directory,report):
    directory.mkdir(parents=True,exist_ok=True)
    (directory/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    archive=directory.with_suffix('.zip')
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        z.write(directory/'report.json',directory.name+'/report.json')
    return archive

def watch_events(device,directory,report,seconds):
    report['events']=[];seen={};end=time.monotonic()+max(20,min(seconds,180))
    while time.monotonic()<end:
        for event in events(capture(device,'logcat','-d','-v','epoch','-t','3000')):
            seen[json.dumps(event,sort_keys=True)]=event
        report['events']=sorted(seen.values(),key=lambda e:e['timestamp'])
        save_report(directory,report)
        time.sleep(2)

def main():
    p=argparse.ArgumentParser(description='Muse 远程测试：不导出任何授权文件，不自动发聊天消息')
    p.add_argument('action',choices=['matrix','collect','open','watch'],nargs='?',default='matrix')
    p.add_argument('--serial');p.add_argument('--profile',choices=OPEN_PROFILES,default='main')
    p.add_argument('--seconds',type=int,default=65);args=p.parse_args()
    device=setup.Device(setup.select_device(args.serial))
    if args.action=='open':
        device.launch({'screen':'chat','subscriptionProfile':args.profile})
        print('已打开 '+args.profile+' 模式。请只发一条“你好，请只回复：测试通过。”');return
    report={'expected_package':json.loads((setup.ROOT/'assets/releases/manifest.json').read_text()),'release':'0.3.1','created_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'note':'只包含筛选后的应用事件与网络摘要；没有完整 logcat、令牌或录音。'}
    report['device']={name:capture(device,'shell','getprop',key).strip() for name,key in [('model','ro.product.model'),('android','ro.build.version.release'),('sdk','ro.build.version.sdk')]}
    report['routes']=capture(device,'shell','ip','route')
    report['network']={host:capture(device,'shell','ping','-c','3','-W','2',host) for host in ['muse.ai','api.muse.ai','hatch.metaaivm.com']}
    try:report['native']=device.status()
    except Exception as e:report['native']={'available':False,'error':redact(str(e))}
    directory=setup.ROOT/'results'/datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    if args.action=='watch':
        print('开始持续记录。现在请在眼镜发一次消息；不要重复发送，等待记录结束。',flush=True)
        watch_events(device,directory,report,args.seconds)
    elif args.action=='collect':
        report['events']=events(capture(device,'logcat','-d','-v','epoch','-t','3000'))
    else:
        report['runs']=[];successful=[]
        for profile in PROFILES:
            print('测试 '+profile+'（最长 '+str(args.seconds)+' 秒），保持 USB 和手机连接…',flush=True)
            before=events(capture(device,'logcat','-d','-v','epoch','-t','1500'))
            cutoff=max((e['timestamp'] for e in before),default=0)
            try:
                device.launch({'screen':'chat','subscriptionProfile':profile,'diagnosticRun':'true'})
            except Exception as error:
                report['runs'].append({'profile':profile,'launch_error':redact(str(error))});break
            seen={};end=time.monotonic()+max(20,min(args.seconds,120))
            while time.monotonic()<end:
                batch=events(capture(device,'logcat','-d','-v','epoch','-t','1500'))
                for event in batch:
                    if event['timestamp']>cutoff:
                        seen[json.dumps(event,sort_keys=True)]=event
                current=list(seen.values())
                stage=[e['data'] for e in current if e['data'].get('profile')==profile]
                if any(e.get('event')=='subscription_status' and e.get('status')==200 for e in stage):
                    successful.append(profile);break
                if any(e.get('event') in ('session_failed','subscription_error') for e in stage):break
                time.sleep(2)
            run={'profile':profile,'release_loaded':any(e['data'].get('event')=='loaded' and e['data'].get('release')=='0.3.1' for e in seen.values()),'events':list(seen.values()),'subscription_ok':profile in successful}
            report['runs'].append(run)
            print('订阅成功' if run['subscription_ok'] else '未确认订阅成功，已记录具体阶段',flush=True)
            save_report(directory,report)
            # Auth must work before a protocol matrix is meaningful.
            if not any(e['data'].get('event')=='noise_established' for e in run['events']):
                print('尚未走到加密握手，停止其他协议对比。先查看授权/连接错误。');break
        report['successful_profiles']=successful
        if successful:
            chosen=successful[0];device.launch({'screen':'chat','subscriptionProfile':chosen})
            print('已打开成功模式 '+chosen+'。请手动发送一条测试消息；完成后运行 collect。')
        else:print('未找到成功模式。请按文档补充截图，并运行 collect 收集最终状态。')
    archive=save_report(directory,report)
    print('请回传诊断包：'+str(archive))

if __name__=='__main__':
    try:main()
    except (RuntimeError,OSError,subprocess.TimeoutExpired,ValueError) as e:
        print('未完成：'+redact(str(e)),file=sys.stderr);sys.exit(1)
