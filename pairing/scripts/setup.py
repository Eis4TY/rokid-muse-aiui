#!/usr/bin/env python3
"""USB installation and same-device binding; Python standard library only."""
import argparse, getpass, hashlib, json, os, secrets, shutil, socket, subprocess
import sys, tempfile, threading, time, urllib.request
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
ROOT = Path(__file__).resolve().parents[1]
PKG = 'com.prism.musepair'
APK = ROOT / 'assets/releases/muse-pairing.apk'
AIX = ROOT / 'assets/releases/muse-aiui.aix'


def run(argv, data=None, quiet=False):
    if os.name == 'nt' and Path(shutil.which(argv[0]) or argv[0]).suffix.lower() in ('.cmd','.bat'):
        # npm publishes aix as a Windows command shim. No credentials on argv.
        command = subprocess.list2cmdline(argv)
        p = subprocess.run(command, shell=True, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    else:
        p = subprocess.run(argv, input=data, stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, timeout=180)
    # Sensitive data is only sent on stdin. Never include stdin in exceptions.
    if p.returncode:
        raise RuntimeError('命令失败：' + ' '.join(argv[:4]) + '\n' +
                           p.stderr.decode(errors='replace')[-1200:])
    return p.stdout.decode(errors='replace')


def select_device(serial=None):
    rows = [x.split()[:2] for x in run(['adb', 'devices']).splitlines()[1:] if x.strip()]
    if serial:
        rows = [row for row in rows if row[0] == serial]
    ready = [row[0] for row in rows if row[1] == 'device']
    if len(ready) != 1:
        if any(row[1] == 'unauthorized' for row in rows):
            raise RuntimeError('请在眼镜上允许 USB 调试，再运行一次。')
        if len(ready) > 1:
            raise RuntimeError('连接了多台设备，请拔掉其他设备或使用 --serial 指定。')
        raise RuntimeError('未找到在线眼镜。使用数据线连接，开启 USB 调试并确认授权。')
    return ready[0]


def verify_assets():
    manifest = json.loads((ROOT / 'assets/releases/manifest.json').read_text())
    for path in [APK, AIX, ROOT / 'assets/releases/agent.json']:
        if hashlib.sha256(path.read_bytes()).hexdigest() != manifest['sha256'][path.name]:
            raise RuntimeError('安装包校验失败：' + path.name + '。请重新下载完整 skill。')


class Device:
    def __init__(self, serial):
        self.serial = serial
        self.adb = ['adb', '-s', serial]
    def cmd(self, *args, data=None):
        return run(self.adb + list(args), data=data)
    def private(self, filename, value):
        # filename is internal, never user-controlled. ADB shell needs quoted -c.
        self.cmd('shell', 'run-as', PKG, 'sh', '-c',
                 "'umask 077; mkdir -p files; cat > files/" + filename + "'", data=value)
    def start(self, binding=False):
        self.cmd('shell', 'am', 'force-stop', PKG)
        args = ['shell', 'am', 'start', '-n', PKG + '/.PairActivity']
        if binding:
            args += ['--ez', 'binding_only', 'true']
        result = self.cmd(*args)
        if 'Error:' in result or 'Exception' in result:
            raise RuntimeError('原生组件启动失败，请查看眼镜提示。')
    def verify_broadcast(self):
        # Match this process only: an old success must not hide a new failure.
        for attempt in range(25):
            pid = self.cmd('shell', 'pidof', PKG).strip().split()
            if not pid:
                raise RuntimeError('配对组件已退出，不能确认广播成功。请检查眼镜错误提示。')
            log = self.cmd('logcat', '-d', '-v', 'epoch', '-s', 'MusePair:I', '*:S', '-t', '2000')
            current = [line for line in log.splitlines() if len(line.split()) > 2 and line.split()[1] in pid]
            for line in reversed(current):
                if 'ADVERTISING_LOCAL_PROTOCOL' in line:
                    print('已确认当前配对进程的 BLE 广播启动成功。')
                    return
                if any(marker in line for marker in ['名称准备失败', '广播失败：', '广播初始化超时', 'GATT 失败：', '启动失败：', '无法生成 Muse 名称广播', '配对窗口已关闭']):
                    raise RuntimeError('配对广播启动失败；请查看眼镜错误文字及 references/故障排查.md。不要先排查手机或重新授权。')
            time.sleep(0.2)
        raise RuntimeError('未确认配对广播启动；组件存活或 native_pairing=true 不代表广播成功。请查看眼镜提示。')
    def status(self):
        port = int(self.cmd('forward', 'tcp:0', 'tcp:18791').strip())
        try:
            for attempt in range(30):
                try:
                    with urllib.request.urlopen('http://127.0.0.1:' + str(port) + '/status', timeout=2) as r:
                        return json.load(r)
                except (OSError, ValueError):
                    time.sleep(0.2)
            raise RuntimeError('配对组件未就绪。检查蓝牙权限、SDK token 和眼镜错误提示。')
        finally:
            self.cmd('forward', '--remove', 'tcp:' + str(port))
    def develop(self, method, arg=None):
        argv = ['shell', 'content', 'call', '--uri', 'content://com.rokid.aiui.develop', '--method', method]
        if arg: argv += ['--arg', arg]
        text = self.cmd(*argv).strip()
        if not text.startswith('{'):
            markers = text.split('result_data=', 1)
            if len(markers) != 2: raise RuntimeError('AIUI 开发接口未返回有效结果：' + method)
            text = markers[1].lstrip()
        result, _ = json.JSONDecoder().raw_decode(text)
        if result.get('errorCode') not in ('', None):
            raise RuntimeError('AIUI ' + method + ' 失败：' + str(result.get('errorCode')))
        return result
    def publish(self):
        # Same official content-provider flow as aix-cli install. Its file
        # resolver conflates package VERSION and agentId, so keep them separate.
        definition = json.loads((ROOT / 'assets/releases/agent.json').read_text())
        prepared = self.develop('prepare')
        if prepared.get('ready') is not True: raise RuntimeError('AIUI 开发接口未就绪。')
        inbox = prepared.get('inboxPath') or '/sdcard/aiui/package/.staging/adb/'
        if not isinstance(inbox, str) or not inbox.startswith('/sdcard/') or not all(c.isalnum() or c in '/._-' for c in inbox):
            raise RuntimeError('AIUI 安装目录无效。')
        with tempfile.TemporaryDirectory(prefix='muse-publish-') as tmp:
            package = Path(tmp) / 'package.aix'; shutil.copyfile(AIX, package)
            config = Path(tmp) / 'agent.json'; shutil.copyfile(ROOT / 'assets/releases/agent.json', config)
            self.cmd('shell', 'rm', '-f', inbox.rstrip('/') + '/package.aix', inbox.rstrip('/') + '/agent.json')
            self.cmd('push', str(package), str(config), inbox)
            applied = self.develop('apply')
            if applied.get('agentId') != definition['agentId'] or applied.get('outcome') not in ('CREATED','UPDATED','UNCHANGED','REPAIRED') or not applied.get('operationId'):
                raise RuntimeError('AIUI 安装结果或应用 ID 不一致，停止。')
            operation = applied['operationId']
            if not isinstance(operation,str) or not all(c.isalnum() or c in '._:-' for c in operation): raise RuntimeError('AIUI operationId 格式无效。')
            status = self.develop('status', operation)
            if status.get('publishState') in ('FAILED_RETRYABLE','FAILED_PERMANENT'):
                raise RuntimeError('AIUI 发布失败：' + status['publishState'])
        print('AIX 已安装到原应用 ID；新代码 VERSION 将触发重新解包。')
    def launch(self, params=None):
        # Exit a cached AIUI page so onLoad processes new binding parameters.
        for _ in range(3):
            self.cmd('shell', 'input', 'keyevent', '4')
        with tempfile.TemporaryDirectory(prefix='muse-launch-') as tmp:
            path = Path(tmp) / 'params.json'
            path.write_text(json.dumps(params or {'screen': 'chat'}))
            path.chmod(0o600)
            run(['aix', 'launch-page', str(ROOT / 'assets/source'), 'pages/index/index', '-s', self.serial,
                 '--params-file', str(path)])


def bind(device, identity):
    body = json.dumps({'binding_key': secrets.token_urlsafe(32),
                       'device_id': identity['device_id']}).encode()
    route = '/binding/' + secrets.token_hex(16)
    complete = threading.Event()
    receipt = {'authorization_present': False}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_GET(self):
            if self.path != route:
                self.send_error(404); return
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers(); self.wfile.write(body)
        def do_POST(self):
            if self.path != route + '/complete':
                self.send_error(404); return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 1024:
                    raise ValueError()
                data = json.loads(self.rfile.read(size))
                if data.get('saved') is not True:
                    raise ValueError()
            except (ValueError, TypeError):
                self.send_error(400); return
            receipt['authorization_present'] = data.get('authorization_present') is True
            self.send_response(200); self.send_header('Content-Length', '2')
            self.end_headers(); self.wfile.write(b'{}'); complete.set()
    # Reserve before writing a new binding; an occupied port must not rotate it.
    server = HTTPServer(('127.0.0.1', 18790), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        device.cmd('shell', 'am', 'force-stop', PKG)
        device.private('binding-import.json', body)
        device.start(binding=True)
        device.cmd('reverse', 'tcp:18790', 'tcp:18790')
        device.launch({'screen': 'handoff', 'importBindingURL': 'http://127.0.0.1:18790' + route})
        if not complete.wait(45):
            raise RuntimeError('AIUI 尚未确认绑定。确认开发者模式已开启，运行 setup --rebind 重试。')
        device.private('aiui-target.json', json.dumps({'agent_id': json.loads((ROOT/'assets/releases/agent.json').read_text())['agentId'], 'authorization_present': receipt['authorization_present']}).encode())
        print('本机自动交接绑定完成；未导入电脑上的账号或设备授权。')
        return receipt['authorization_present']
    finally:
        try:
            device.cmd('reverse', '--remove', 'tcp:18790')
        finally:
            server.shutdown(); server.server_close()


def read_target(device):
    raw = device.cmd('shell', 'run-as', PKG, 'sh', '-c', "'cat files/aiui-target.json 2>/dev/null || true'")
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except (ValueError, TypeError):
        return {}

def main():
    p = argparse.ArgumentParser(description='Rokid Muse 配对助手（不清除已有授权）')
    p.add_argument('action', nargs='?', choices=['setup', 'check', 'pair', 'open', 'status'], default='setup')
    p.add_argument('--serial')
    p.add_argument('--sdk-token-file', type=Path)
    p.add_argument('--rebind', action='store_true', help='修复本机应用绑定；不清除 Muse 授权')
    p.add_argument('--dry-run', action='store_true', help='只验证安装包并展示流程，不操作眼镜')
    args = p.parse_args()
    verify_assets()
    if args.dry_run:
        print('安装包校验通过。流程：检测 USB → 增量安装 APK/AIX → 独立设备身份 → 本机绑定 → 手机 Muse 配对 → AIUI 自动验证授权。')
        return
    for name in ['adb', 'aix']:
        if not shutil.which(name):
            raise RuntimeError('缺少 ' + name + '，请按 references/快速上手.md 安装工具。')
    manifest = json.loads((ROOT / 'assets/releases/manifest.json').read_text())
    definition = json.loads((ROOT / 'assets/releases/agent.json').read_text())
    if definition['agentId'] != manifest['agent_id']:
        raise RuntimeError('应用定义 ID 不一致，停止安装以保留已有授权。')
    if json.loads(run(['aix', 'show', str(AIX), '--compact']))['agentId'] != 'develop.rokid.agent.' + manifest['build_id']:
        raise RuntimeError('AIX 代码版本不一致，停止安装。')
    device = Device(select_device(args.serial))
    print('USB 已连接：' + device.serial)
    if args.action == 'check':
        print('adb/aix 可用，安装包完整。下一步运行 setup。'); return
    if args.action == 'open':
        print('请先关闭手机 VPN，用 Rokid App 回连眼镜；回连成功后，非美国地区使用 AIUI 时开启并保持手机 VPN。')
        device.launch(); print('AIUI 已启动；请在眼镜查看授权与会话状态。'); return
    if args.action == 'status':
        status = device.status(); print(json.dumps(status, ensure_ascii=False, indent=2))
        print('delivered 只表示交接完成；会话在线请以眼镜 AIUI 显示为准。'); return
    if args.action == 'pair':
        device.start(); device.verify_broadcast(); print('配对窗口已打开（10 分钟）。请先在手机设置 → 蓝牙中忽略眼镜原有连接，再用 Muse App 配对。'); return
    print('安装配对组件和 AIUI，保留原有数据…')
    device.cmd('install', '-r', str(APK))
    android = int(device.cmd('shell', 'getprop', 'ro.build.version.sdk').strip())
    if android >= 31:
        for permission in ['BLUETOOTH_CONNECT', 'BLUETOOTH_ADVERTISE']:
            device.cmd('shell', 'pm', 'grant', PKG, 'android.permission.' + permission)
    exists = device.cmd('shell', 'run-as', PKG, 'sh', '-c', "'test -s files/sdk-token && echo present || true'").strip()
    if args.sdk_token_file or exists != 'present':
        token = (args.sdk_token_file.read_text().strip() if args.sdk_token_file
                 else getpass.getpass('请粘贴 Muse SDK token（输入不显示，回车确认）：').strip())
        if not token or '\n' in token or '\r' in token:
            raise RuntimeError('SDK token 为空或格式错误。')
        device.private('sdk-token', token.encode())
    run(['aix', 'device', 'set-dev', '-s', device.serial])
    device.publish()
    device.start(binding=True)
    status = device.status()
    print('配对广播：' + status['ble_name'] + '；原蓝牙名：' + status['original_name'])
    target = read_target(device)
    existing_authorization = target.get('authorization_present') is True
    if args.rebind or not status.get('binding_ready') or target.get('agent_id') != definition['agentId']:
        existing_authorization = bind(device, status)
    else:
        print('沿用已有应用绑定与设备授权。')
    if existing_authorization or status.get('delivered') or status.get('handoff_ready'):
        device.launch()
        print('已有配对，已打开 AIUI。需要重新配对时单独运行 pair。')
    else:
        device.start()
        device.verify_broadcast()
        print('请在手机 Muse → Developer mode → Add Device，选择上述广播并确认。')
        print('配对前：手机设置 → 蓝牙 → 忽略眼镜原有连接（仅断开不够）。')
        print('配对后：关闭手机 VPN → 用 Rokid App 回连眼镜 → 非美国地区开启并保持手机 VPN → 运行 open。')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.TimeoutExpired, ValueError) as error:
        print('未完成：' + str(error), file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print('\n已停止。已有授权未清除。', file=sys.stderr)
        sys.exit(130)
