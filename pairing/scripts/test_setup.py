#!/usr/bin/env python3
"""Tests run without glasses or any real account credentials."""
import importlib.util, json, unittest, urllib.request
from unittest.mock import patch
from pathlib import Path
spec=importlib.util.spec_from_file_location('pair_setup',Path(__file__).with_name('setup.py'))
setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)
class InstallerTests(unittest.TestCase):
    def test_device_selection_never_guesses_between_glasses(self):
        with patch.object(setup,'run',return_value='List of devices attached\na device\nb device\n'):
            with self.assertRaisesRegex(RuntimeError,'多台设备'):
                setup.select_device()
            self.assertEqual(setup.select_device('b'),'b')
        with patch.object(setup,'run',return_value='List of devices attached\na unauthorized\n'):
            with self.assertRaisesRegex(RuntimeError,'允许 USB'):
                setup.select_device()
    def test_no_hardware_is_needed_for_artifact_integrity(self):
        setup.verify_assets()
    def test_sdk_secret_is_only_sent_on_stdin(self):
        captured=[]
        with patch.object(setup,'run',side_effect=lambda argv,data=None:captured.append((argv,data)) or ''):
            setup.Device('synthetic').private('sdk-token',b'synthetic-secret')
        self.assertEqual(captured[0][1],b'synthetic-secret')
        self.assertNotIn('synthetic-secret',' '.join(captured[0][0]))
    def test_binding_crosses_usb_once_and_cleans_up(self):
        class Device:
            def __init__(self):self.writes=[];self.commands=[]
            def cmd(self,*args,**kwargs):self.commands.append(args)
            def private(self,name,body):self.writes.append((name,json.loads(body)))
            def start(self,binding=False):self.binding=binding
            def launch(self,params):
                url=params['importBindingURL']
                with urllib.request.urlopen(url,timeout=2) as r: data=json.load(r)
                assert data==self.writes[0][1]
                request=urllib.request.Request(url+'/complete',data=b'{"saved":true}',headers={'Content-Type':'application/json'})
                with urllib.request.urlopen(request,timeout=2) as r: assert r.status==200
        device=Device();setup.bind(device,{'device_id':'homelink-123456abcdef'})
        self.assertEqual(device.writes[0][1]['device_id'],'homelink-123456abcdef')
        self.assertEqual(len(device.writes[0][1]['binding_key']),43)
        self.assertIn(('reverse','--remove','tcp:18790'),device.commands)
        self.assertNotIn('access_token',device.writes[0][1])
    def test_binding_reports_existing_pixel_authorization_without_exporting_tokens(self):
        class Device:
            def __init__(self): self.writes=[]; self.commands=[]
            def cmd(self,*args,**kwargs): self.commands.append(args)
            def private(self,name,body): self.writes.append((name,json.loads(body)))
            def start(self,binding=False): pass
            def launch(self,params):
                url=params['importBindingURL']
                with urllib.request.urlopen(url,timeout=2) as r: json.load(r)
                request=urllib.request.Request(url+'/complete',data=b'{"saved":true,"authorization_present":true}',headers={'Content-Type':'application/json'})
                with urllib.request.urlopen(request,timeout=2) as r: assert r.status==200
        device=Device()
        self.assertTrue(setup.bind(device,{'device_id':'homelink-123456abcdef'}))
        target=device.writes[1][1]
        self.assertEqual(device.writes[1][0],'aiui-target.json')
        self.assertTrue(target['authorization_present'])
        self.assertEqual(target['agent_id'],json.loads((setup.ROOT/'assets/releases/agent.json').read_text())['agentId'])
        self.assertNotIn('access_token',target)
    def test_target_marker_absence_is_treated_as_first_binding(self):
        with patch.object(setup.Device,'cmd',return_value=''):
            self.assertEqual(setup.read_target(setup.Device('synthetic')), {})
        with patch.object(setup.Device,'cmd',return_value='{"agent_id":"pixel","authorization_present":true}'):
            self.assertTrue(setup.read_target(setup.Device('synthetic'))['authorization_present'])

    def test_prebuilt_update_keeps_registration_identity_separate_from_code_version(self):
        manifest=json.loads((setup.ROOT/'assets/releases/manifest.json').read_text())
        uploads=[];operations=[]
        class Device(setup.Device):
            def cmd(self,*args,**kwargs):
                if args[0]=='push':
                    uploads.append((Path(args[1]).read_bytes(),json.loads(Path(args[2]).read_text())))
                return ''
            def develop(self,method,arg=None):
                operations.append((method,arg))
                if method=='prepare':return {'ready':True,'inboxPath':'/sdcard/aiui/package/.staging/adb/'}
                if method=='apply':return {'agentId':manifest['agent_id'],'outcome':'UPDATED','operationId':'test-operation'}
                return {'publishState':'UPLOADED'}
        Device('synthetic').publish()
        self.assertEqual(uploads[0][1]['agentId'],manifest['agent_id'])
        self.assertEqual(setup.hashlib.sha256(uploads[0][0]).hexdigest(),manifest['sha256']['muse-aiui.aix'])
        self.assertNotEqual(manifest['agent_id'],'develop.rokid.agent.'+manifest['build_id'])
        self.assertIn(('status','test-operation'),operations)
    def test_developer_result_parses_json_inside_android_bundle(self):
        with patch.object(setup.Device,'cmd',return_value='Result: Bundle[{result_data={"ready":true,"errorCode":"","nested":{"ok":true}}, unrelated=0}]'):
            self.assertEqual(setup.Device('synthetic').develop('prepare')['nested'],{'ok':True})
if __name__=='__main__':unittest.main()

class BroadcastTests(unittest.TestCase):
    def device(self,log):
        class Device(setup.Device):
            def cmd(self,*args,**kw):return '22' if args[:2]==('shell','pidof') else log
        return Device('synthetic')
    def test_current_success_is_required(self):
        self.device('1.0 22 22 I MusePair: ADVERTISING_LOCAL_PROTOCOL').verify_broadcast()
    def test_old_success_does_not_hide_current_name_failure(self):
        d=self.device('1.0 11 11 I MusePair: ADVERTISING_LOCAL_PROTOCOL\n2.0 22 22 I MusePair: UI_STATUS Muse 广播名称准备失败')
        with self.assertRaisesRegex(RuntimeError,'广播启动失败'):d.verify_broadcast()
    def test_no_success_never_claims_window_open(self):
        with patch.object(setup.time,'sleep'):
            with self.assertRaisesRegex(RuntimeError,'未确认'):self.device('1.0 11 11 I MusePair: ADVERTISING_LOCAL_PROTOCOL').verify_broadcast()
