import importlib.util,pathlib,sqlite3,tempfile,sys,unittest
from contextlib import closing
SCRIPTS=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(SCRIPTS))
spec=importlib.util.spec_from_file_location('gate',SCRIPTS/'journal_release_gate.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
class ReleaseGateTest(unittest.TestCase):
 def test_only_fixed_registry_content_identifiers_are_accepted(self):
  good={'commit':'a'*40,'digest':'sha256:'+'b'*64};self.assertEqual(gate.validate(good),good)
  kairos={**good,'repository':'ghcr.io/egosay/kairos'};self.assertEqual(gate.validate(kairos),kairos)
  for value in ({**good,'commit':'main'}, {**good,'digest':'sha256:abc; echo bad'}, {**good,'command':'anything'}, {**good,'repository':'ghcr.io/other/kairos'}):
   with self.assertRaises(ValueError):gate.validate(value)
 def test_new_content_or_a_changed_data_shape_blocks_snapshot_replacement(self):
  with tempfile.TemporaryDirectory() as directory:
   p=pathlib.Path(directory)/'memos_prod.db'
   with closing(sqlite3.connect(p)) as db,db:
    for table in ('memo','attachment','journal_document'):db.execute('CREATE TABLE '+table+'(id INTEGER, content TEXT)')
    db.execute("INSERT INTO memo VALUES(1,'before')")
   first=gate.fingerprint(p)
   with closing(sqlite3.connect(p)) as db,db:db.execute("UPDATE memo SET content='new memory'")
   self.assertNotEqual(first,gate.fingerprint(p))
   with closing(sqlite3.connect(p)) as db,db:db.execute('ALTER TABLE memo ADD COLUMN extra TEXT')
   self.assertNotEqual(first,gate.fingerprint(p))

class InterruptedPreparationTest(unittest.TestCase):
 def test_unfinished_backup_does_not_trigger_data_replacement(self):
  import json
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory)
   (root/'pending.json').write_text(json.dumps({'status':'preparing','previousImage':'previous-image'}))
   with patch.object(gate,'ROOT',root),patch.object(gate,'command',return_value='') as command:
    self.assertEqual(gate.rollback()['status'],'preparation-aborted')
   self.assertFalse((root/'pending.json').exists())
   command.assert_any_call('docker','start',gate.CONTAINER)
   command.assert_any_call('systemctl','start','memos-backup.timer')

class BackupOverlapTest(unittest.TestCase):
 def test_oneshot_activating_and_stopping_states_are_not_treated_as_finished(self):
  from unittest.mock import patch
  with patch.object(gate,'command',side_effect=['activating\n','deactivating\n','inactive\n']),patch.object(gate.time,'sleep') as sleep:
   gate.wait_for_backup()
  self.assertEqual(sleep.call_count,2)

class ReleaseReadinessTest(unittest.TestCase):
 def test_http_ready_release_waits_for_docker_health_before_confirmation(self):
  import json
  from unittest.mock import patch
  release={'digest':'sha256:'+'a'*64,'repository':'ghcr.io/egosay/kairos'}
  def inspect(*args):
   if args[:3]==('docker','image','inspect'):return json.dumps([{'RepoDigests':['ghcr.io/egosay/kairos@'+release['digest']]}])
   health=states.pop(0)
   return json.dumps([{'Image':'new-image','State':{'Health':{'Status':health}}}])
  states=['starting','healthy']
  with patch.object(gate,'command',side_effect=inspect),patch.object(gate.time,'sleep') as sleep:
   self.assertEqual(gate.wait_for_release(release)['State']['Health']['Status'],'healthy')
  sleep.assert_called_once_with(2)

 def test_already_published_legacy_workflow_keeps_its_exact_registry(self):
  import json
  from unittest.mock import patch
  release={'digest':'sha256:'+'c'*64}
  replies=[json.dumps([{'Image':'legacy','State':{'Health':{'Status':'healthy'}}}]),json.dumps([{'RepoDigests':['ghcr.io/egosay/memos-journal@'+release['digest']]}])]
  with patch.object(gate,'command',side_effect=replies):
   self.assertEqual(gate.wait_for_release(release)['Image'],'legacy')

class RollbackPreservationTest(unittest.TestCase):
 def test_new_content_and_unreadable_schemas_restart_service_without_replacing_data(self):
  import json
  from unittest.mock import patch
  for unreadable in (False,True):
   with self.subTest(unreadable=unreadable),tempfile.TemporaryDirectory() as directory:
    root=pathlib.Path(directory);source=root/'live';source.mkdir();database=source/'memos_prod.db'
    with closing(sqlite3.connect(database)) as db,db:
     for table in ('memo','attachment','journal_document'):db.execute('CREATE TABLE '+table+'(id INTEGER, content TEXT)')
     db.execute("INSERT INTO memo VALUES(1,'before')")
    before=gate.fingerprint(database)
    with closing(sqlite3.connect(database)) as db,db:
     db.execute("UPDATE memo SET content='a new memory'")
     if unreadable:db.execute('DROP TABLE attachment')
    (root/'pending.json').write_text(json.dumps({'status':'prepared','source':str(source),'stage':str(root/'snapshot'),'fingerprint':before}))
    with patch.object(gate,'ROOT',root),patch.object(gate,'verify'),patch.object(gate,'command',return_value='') as command:
     with self.assertRaisesRegex(RuntimeError,'preserved'):gate.rollback()
    with closing(sqlite3.connect(database)) as db:self.assertEqual(db.execute('SELECT content FROM memo').fetchone()[0],'a new memory')
    self.assertTrue((root/'pending.json').exists())
    command.assert_any_call('docker','start',gate.CONTAINER)
    command.assert_any_call('systemctl','start','memos-backup.timer')



class DirectDeploymentTest(unittest.TestCase):
 def setUp(self):
  import json
  self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
  self.root=pathlib.Path(self.directory.name);self.source=self.root/'live';self.source.mkdir()
  self.stage=self.root/'snapshot';(self.stage/'data').mkdir(parents=True)
  for database in (self.source/'memos_prod.db',self.stage/'data/memos_prod.db'):
   with closing(sqlite3.connect(database)) as db,db:
    db.execute('CREATE TABLE memo(content TEXT)');db.execute("INSERT INTO memo VALUES('before')")
  self.pending={'commit':'a'*40,'digest':'sha256:'+'b'*64,'repository':'ghcr.io/egosay/kairos',
   'status':'prepared','source':str(self.source),'stage':str(self.stage),
   'fingerprint':gate.fingerprint(self.source/'memos_prod.db'),
   'previousImage':'ghcr.io/egosay/kairos@sha256:'+'c'*64,'previousVersion':'previous',
   'dokploy':{'previousCompose':'before','candidateCompose':'candidate','protectedDigest':'guard'}}
  self.config=self.root/'config.json';self.config.write_text(json.dumps({'instanceVersion':'previous'}))
  self.write()
 def write(self):
  import json
  (self.root/'pending.json').write_text(json.dumps(self.pending))
 def test_post_timeout_keeps_identity_for_safe_recovery_and_cannot_be_reenqueued(self):
  import json
  from unittest.mock import patch
  with patch.object(gate,'ROOT',self.root),patch.object(gate,'Dokploy') as client:
   client.return_value.deploy.side_effect=TimeoutError('ambiguous POST')
   with self.assertRaises(TimeoutError):gate.deploy()
   pending=json.loads((self.root/'pending.json').read_text())
   self.assertEqual(pending['status'],'deploying');self.assertIn('deploymentTitle',pending)
   with self.assertRaisesRegex(RuntimeError,'prepared'):gate.deploy()
   self.assertEqual(client.return_value.deploy.call_count,1)
 def test_unobserved_or_running_deployment_does_not_stop_or_replace_data(self):
  from unittest.mock import patch
  self.pending['deploymentTitle']='uncertain';self.write()
  with patch.object(gate,'ROOT',self.root),patch.object(gate,'verify'),patch.object(gate,'command') as command,patch.object(gate,'Dokploy') as client:
   client.return_value.wait_terminal.side_effect=RuntimeError('outcome unknown')
   with self.assertRaisesRegex(RuntimeError,'unknown'):gate.rollback()
   command.assert_called_once_with('systemctl','start','memos-backup.timer');client.return_value.restore.assert_not_called()
  self.assertTrue((self.root/'pending.json').exists())
 def test_new_writes_leave_both_current_image_and_dokploy_declaration_intact(self):
  from unittest.mock import patch
  with closing(sqlite3.connect(self.source/'memos_prod.db')) as db,db:db.execute("UPDATE memo SET content='new memory'")
  with patch.object(gate,'ROOT',self.root),patch.object(gate,'verify'),patch.object(gate,'command',return_value='') as command,patch.object(gate,'Dokploy') as client:
   with self.assertRaisesRegex(RuntimeError,'preserved'):gate.rollback()
   client.return_value.restore.assert_not_called()
   self.assertFalse(any(call.args[:2]==('docker','compose') for call in command.call_args_list))
  with closing(sqlite3.connect(self.source/'memos_prod.db')) as db:self.assertEqual(db.execute('SELECT content FROM memo').fetchone()[0],'new memory')
 def test_safe_rollback_restores_declaration_checks_old_image_and_resumes_backups(self):
  import json
  from unittest.mock import patch
  self.pending['deploymentTitle']='finished';self.write();events=[]
  def command(*args):events.append(args);return ''
  with patch.object(gate,'ROOT',self.root),patch.object(gate,'CONFIG',self.config),patch.object(gate,'verify'),patch.object(gate,'os') as os_mock,patch.object(gate,'command',side_effect=command),patch.object(gate,'Dokploy') as client,patch.object(gate,'wait_for_release') as healthy:
   client.return_value.restore.side_effect=lambda _:events.append(('restore-declaration',))
   self.assertEqual(gate.rollback()['status'],'rolled-back')
   client.return_value.wait_terminal.assert_called_once_with('finished')
   healthy.assert_called_once_with({'repository':'ghcr.io/egosay/kairos','digest':'sha256:'+'c'*64})
   self.assertLess(events.index(('restore-declaration',)),next(i for i,event in enumerate(events) if event[:2]==('docker','compose')))
   self.assertIn(('systemctl','start','memos-backup.timer'),events)
  self.assertFalse((self.root/'pending.json').exists())
  self.assertEqual(json.loads((self.root/'last-rollback.json').read_text())['status'],'rolled-back')
  self.assertEqual(json.loads(self.config.read_text())['instanceVersion'],'previous')
 def test_configuration_restore_failure_restarts_current_service_and_preserves_pending(self):
  from unittest.mock import patch
  with patch.object(gate,'ROOT',self.root),patch.object(gate,'verify'),patch.object(gate,'command',return_value='') as command,patch.object(gate,'Dokploy') as client:
   client.return_value.restore.side_effect=RuntimeError('API unavailable')
   with self.assertRaisesRegex(RuntimeError,'API unavailable'):gate.rollback()
   command.assert_any_call('docker','start',gate.CONTAINER)
   command.assert_any_call('systemctl','start','memos-backup.timer')
   self.assertFalse(any(call.args[:2]==('docker','compose') for call in command.call_args_list))
  self.assertTrue((self.root/'pending.json').exists())

class PreflightFailureTest(unittest.TestCase):
 def test_api_or_template_failure_occurs_before_snapshot_timer_or_container_mutation(self):
  import json
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);config=root/'config.json'
   config.write_text(json.dumps({'source':str(root/'live'),'instanceVersion':'before'}))
   replies=[json.dumps([{'Image':'previous'}]),json.dumps([{'RepoDigests':['ghcr.io/egosay/kairos@sha256:'+'c'*64]}])]
   with patch.object(gate,'ROOT',root),patch.object(gate,'CONFIG',config),patch.object(gate,'command',side_effect=replies) as command,patch.object(gate,'Dokploy') as client,patch.object(gate,'snapshot') as snapshot:
    client.return_value.prepare.side_effect=RuntimeError('preflight unavailable')
    with self.assertRaisesRegex(RuntimeError,'preflight'):gate.prepare({'commit':'a'*40,'digest':'sha256:'+'b'*64,'repository':'ghcr.io/egosay/kairos'})
    self.assertEqual(command.call_count,2);snapshot.assert_not_called()
    self.assertFalse((root/'pending.json').exists())

class WatchdogLockTest(unittest.TestCase):
 def test_watchdog_waits_for_in_progress_gate_instead_of_losing_recovery_attempt(self):
  import fcntl,os,subprocess,time
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory)
   with (root/'lock').open('a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX)
    code="import pathlib,sys;sys.path.insert(0,sys.argv[1]);import journal_release_gate as gate;gate.ROOT=pathlib.Path(sys.argv[2]);sys.argv=['gate','rollback'];gate.main()"
    env={key:value for key,value in os.environ.items() if key!='SSH_ORIGINAL_COMMAND'}
    child=subprocess.Popen([sys.executable,'-c',code,str(SCRIPTS),directory],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
    try:
     with self.assertRaises(subprocess.TimeoutExpired):child.wait(timeout=0.3)
     fcntl.flock(lock,fcntl.LOCK_UN)
     out,error=child.communicate(timeout=10)
     self.assertEqual(child.returncode,0,error);self.assertIn('no pending release',out)
    finally:
     if child.poll() is None:child.kill();child.communicate()

if __name__=='__main__':unittest.main()
