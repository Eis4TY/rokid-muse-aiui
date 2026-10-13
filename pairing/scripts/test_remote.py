import importlib.util,unittest,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('remote',Path(__file__).with_name('remote_test.py'))
remote=importlib.util.module_from_spec(spec);spec.loader.exec_module(remote)
class PrivacyTests(unittest.TestCase):
 def test_logs_are_allowlisted_and_credentials_are_discarded(self):
  raw='12 I other Authorization: Bearer SECRET\n13 I Ink [MuseProbe] '+json.dumps({'event':'subscription_error','release':'0.2.2','status':404,'access_token':'SECRET','binding_key':'SECRET','code':'route_not_found'})
  report=remote.events(raw);self.assertEqual(len(report),1);self.assertEqual(report[0]['data']['status'],404);self.assertNotIn('SECRET',json.dumps(report))
 def test_error_strings_redact_email_and_bearer(self):
  self.assertNotIn('person@example.com',remote.redact('person@example.com Bearer synthetic-credential'));self.assertNotIn('synthetic-credential',remote.redact('Bearer synthetic-credential'))
if __name__=='__main__':unittest.main()

class NewDiagnosticTests(unittest.TestCase):
 def test_new_diagnostic_fields_survive_without_text_or_private_ids(self):
  line='10 I Ink [MuseProbe] '+json.dumps({'event':'reply_parse','task_status':'failed','task_kind':'chat','job_fp':'abcdef123456','seq':2,'private_job_id':'SECRET','assistant_text':'PRIVATE'})
  data=remote.events(line)[0]['data'];self.assertEqual(data['task_status'],'failed');self.assertEqual(data['seq'],2);self.assertNotIn('SECRET',json.dumps(data));self.assertNotIn('PRIVATE',json.dumps(data))
 def test_watch_saves_live_events_and_deduplicates_logcat_overlap(self):
  import tempfile
  from unittest.mock import patch
  line='10 I Ink [MuseProbe] '+json.dumps({'event':'reply_duplicate','seq':2,'profile':'official'})
  with tempfile.TemporaryDirectory() as directory:
   target=Path(directory)/'report';report={}
   with patch.object(remote.time,'monotonic',side_effect=[0,0,2,121]),patch.object(remote.time,'sleep'),patch.object(remote,'capture',return_value=line):
    remote.watch_events(object(),target,report,120)
   self.assertEqual(len(report['events']),1);self.assertTrue(target.with_suffix('.zip').exists());self.assertEqual(json.loads((target/'report.json').read_text())['events'][0]['data']['seq'],2)
