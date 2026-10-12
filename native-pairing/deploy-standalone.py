#!/usr/bin/env python3
"""One-time development deployment; no token appears in argv or output."""
import argparse,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('--serial');p.add_argument('--pairing',type=Path,default=Path.home()/'.config/muse-prism-validation/glasses-pairing/pairing.json');args=p.parse_args()
listed=subprocess.check_output(['adb','devices'],text=True)
devices=[line.split()[0] for line in listed.splitlines()[1:] if len(line.split())==2 and line.split()[1]=='device']
serial=args.serial
if serial is None:
 if len(devices)!=1:raise SystemExit('请连接一台已授权的眼镜，或用 --serial 指定设备。')
 serial=devices[0]
if serial not in devices:raise SystemExit('指定眼镜未连接或 ADB 未授权。')
adb=['adb','-s',serial]
def run(*parts,**kw):return subprocess.run(adb+list(parts),check=True,**kw)
subprocess.run(['sh',str(ROOT/'native-pairing/build.sh')],check=True)
run('shell','am','force-stop','com.prism.musepair')
run('install','-r',str(ROOT/'native-pairing/build/muse-pairing.apk'))
# Keep other projects' ADB tunnels intact; remove only this demo's Mac links.
for port in ('18787','18788'):subprocess.run(adb+['reverse','--remove','tcp:'+port],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
exists=subprocess.run(adb+['shell','run-as','com.prism.musepair','test','-f','files/muse-pairing.enc'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
if not exists:
 raw=args.pairing.read_bytes();record=json.loads(raw)
 if not record.get('access_token') or not record.get('refresh_token'):raise SystemExit('本机没有有效的配对凭据。')
 run('shell','run-as','com.prism.musepair','mkdir','-p','files',stdout=subprocess.DEVNULL)
 run('shell','run-as','com.prism.musepair','sh','-c','"umask 077; cat > files/pairing-import.json"',input=raw,stdout=subprocess.DEVNULL)
 print('凭据已通过标准输入迁入私有目录，启动后加密并删除导入明文。')
else:print('保留眼镜上已有的加密配对凭据。')
run('shell','am','start','-n','com.prism.musepair/.PairActivity')
subprocess.run(['aix','install',str(ROOT),'-s',serial],check=True)
run('shell','input','keyevent','4')
subprocess.run(['aix','launch-page',str(ROOT),'pages/index/index','-s',serial,'--params','{"screen":"chat"}'],check=True)
print('已部署独立服务和 AIUI；请检查 Muse 在线，再拔 USB 验证。')
