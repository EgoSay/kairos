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
   with patch.object(gate,'ROOT',root),patch.object(gate,'command',return_value='container-id\n') as command:
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
    with patch.object(gate,'ROOT',root),patch.object(gate,'verify'),patch.object(gate,'command',return_value='container-id\n') as command:
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
  with patch.object(gate,'ROOT',self.root),patch.object(gate,'verify'),patch.object(gate,'command',return_value='container-id\n') as command,patch.object(gate,'Dokploy') as client:
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
  with patch.object(gate,'ROOT',self.root),patch.object(gate,'verify'),patch.object(gate,'command',return_value='container-id\n') as command,patch.object(gate,'Dokploy') as client:
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
  for operation in ('prepare','prepare_rollback'):
   with self.subTest(operation=operation),tempfile.TemporaryDirectory() as directory:
    root=pathlib.Path(directory);config=root/'config.json'
    config.write_text(json.dumps({'source':str(root/'live'),'instanceVersion':'before'}))
    replies=[json.dumps([{'Image':'previous'}]),json.dumps([{'RepoDigests':['ghcr.io/egosay/kairos@sha256:'+'c'*64]}])]
    with patch.object(gate,'ROOT',root),patch.object(gate,'CONFIG',config),patch.object(gate,'command',side_effect=replies) as command,patch.object(gate,'Dokploy') as client,patch.object(gate,'snapshot') as snapshot:
     getattr(client.return_value,operation).side_effect=RuntimeError('preflight unavailable')
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


class RollbackRecoveryRegressionTest(unittest.TestCase):
 setUp=DirectDeploymentTest.setUp
 write=DirectDeploymentTest.write
 def run_rollback(self, *, exists=True, failure=None, healthy_failure=None, check_failure=None, backup_failure=None, release=None):
  import json
  from unittest.mock import patch
  self.events=[]
  def command(*args):
   self.events.append(args)
   if args[:3]==('docker','container','ls'):
    if failure:raise failure
    return 'container-id\n' if exists else ''
   if args[:2]==('docker','stop') and not exists:
    import subprocess
    raise subprocess.CalledProcessError(1,args,stderr='No such container')
   if args==('systemctl','start','memos-backup.timer') and backup_failure:raise backup_failure
   return ''
  with patch.object(gate,'ROOT',self.root),patch.object(gate,'CONFIG',self.config),patch.object(gate,'verify'),patch.object(gate.os,'chown'),patch.object(gate,'command',side_effect=command),patch.object(gate,'Dokploy') as client,patch.object(gate,'wait_for_release') as healthy:
   self.client=client.return_value
   self.client.restore.side_effect=lambda _:self.events.append(('restore-declaration',))
   self.client.check.side_effect=check_failure
   healthy.side_effect=healthy_failure
   result=gate.rollback() if release is None else gate.rollback(release)
   return result
 def release(self):
  return {key:self.pending[key] for key in ('commit','digest','repository')}
 def test_unchanged_database_is_not_replaced_or_deleted_during_rollback(self):
  from unittest.mock import patch
  database=self.source/'memos_prod.db'
  before=database.read_bytes();inode=database.stat().st_ino
  # A rollback with an identical logical DB does not need any file copying.
  # This also avoids a disk/copy interruption deleting the only live DB.
  with patch.object(gate.shutil,'copy2',side_effect=OSError('copy unavailable')) as copy:
   self.assertEqual(self.run_rollback()['status'],'rolled-back')
   copy.assert_not_called()
  self.assertEqual(database.read_bytes(),before)
  self.assertEqual(database.stat().st_ino,inode)
  self.assertEqual(self.run_rollback(release=self.release())['status'],'already-rolled-back')
 def test_rollback_preserves_paused_backup_schedule(self):
  self.pending['backupEnabled']=False;self.write()
  self.assertEqual(self.run_rollback()['status'],'rolled-back')
  self.assertNotIn(('systemctl','start','memos-backup.timer'),self.events)
  self.assertIn(('systemctl','stop','memos-backup.timer'),self.events)
 def test_blocked_rollback_does_not_enable_a_paused_backup_schedule(self):
  self.pending['backupEnabled']=False;self.write()
  with closing(sqlite3.connect(self.source/'memos_prod.db')) as db,db:db.execute("UPDATE memo SET content='new memory'")
  with self.assertRaises(gate.RollbackBlocked):self.run_rollback()
  self.assertNotIn(('systemctl','start','memos-backup.timer'),self.events)
  self.assertIn(('systemctl','stop','memos-backup.timer'),self.events)
 def test_preparation_abort_preserves_paused_backup_schedule(self):
  self.pending.update(status='preparing',backupEnabled=False);self.write()
  self.assertEqual(self.run_rollback()['status'],'preparation-aborted')
  self.assertNotIn(('systemctl','start','memos-backup.timer'),self.events)
  self.assertIn(('systemctl','stop','memos-backup.timer'),self.events)
 def test_preparation_persists_the_administrators_paused_schedule(self):
  import json
  from unittest.mock import patch
  config={'source':str(self.source),'logicalRoot':'/var/opt/memos','instanceVersion':'previous','enabled':False}
  self.config.write_text(json.dumps(config));(self.root/'pending.json').unlink()
  def command(*args):
   if args[:2]==('docker','inspect'):return json.dumps([{'Image':'old','NetworkSettings':{'Networks':{'memos-journal-ci55cj_default':{}}}}])
   if args[:3]==('docker','image','inspect'):return json.dumps([{'RepoDigests':[self.pending['previousImage']]}])
   return ''
  with patch.object(gate,'ROOT',self.root),patch.object(gate,'CONFIG',self.config),patch.object(gate,'command',side_effect=command),patch.object(gate,'Dokploy') as client,patch.object(gate,'wait_for_backup'),patch.object(gate,'snapshot'),patch.object(gate,'backup',return_value={'status':'success','snapshotId':'a'*64}),patch.object(gate,'fingerprint',return_value=self.pending['fingerprint']),patch.object(gate.signal,'signal'),patch.object(gate.signal,'alarm'):
   client.return_value.prepare.return_value=self.pending['dokploy']
   self.assertEqual(gate.prepare(self.release())['status'],'prepared')
  saved=json.loads((self.root/'pending.json').read_text())
  self.assertIs(saved['backupEnabled'],False)
  self.assertEqual(self.run_rollback()['status'],'rolled-back')
  self.assertNotIn(('systemctl','start','memos-backup.timer'),self.events)
 def test_rollback_keeps_existing_wal_and_does_not_unlink_unrelated_db_prefixed_files(self):
  database=self.source/'memos_prod.db'
  with closing(sqlite3.connect(database)) as db:
   db.execute('PRAGMA journal_mode=WAL')
   db.execute("UPDATE memo SET content='before'");db.commit()
   self.pending['fingerprint']=gate.fingerprint(database);self.write()
   retained=self.source/'memos_prod.db.pre-existing-recovery-copy'
   retained.write_bytes(b'keep administrative recovery artifacts')
   self.assertEqual(self.run_rollback()['status'],'rolled-back')
   self.assertTrue((self.source/'memos_prod.db-wal').exists())
   self.assertEqual(db.execute('SELECT content FROM memo').fetchone()[0],'before')
   self.assertEqual(retained.read_bytes(),b'keep administrative recovery artifacts')
 def test_confirmation_keeps_pending_and_watchdog_when_backup_timer_cannot_resume(self):
  import json
  from unittest.mock import patch
  self.pending.update(deploymentTitle='test-deployment',snapshotId='a'*64);self.write()
  events=[]
  def command(*args):
   events.append(args)
   if args[0]=='curl':return json.dumps({'commit':self.pending['commit'],'needsSetup':False,'accessMode':'INSTANCE_ACCESS_MODE_PRIVATE'})
   if args==('systemctl','start','memos-backup.timer'):raise RuntimeError('timer unavailable')
   return ''
  with patch.object(gate,'ROOT',self.root),patch.object(gate,'CONFIG',self.config),patch.object(gate,'command',side_effect=command),patch.object(gate,'Dokploy') as client,patch.object(gate,'wait_for_release',return_value={'NetworkSettings':{'Networks':{'test':{'IPAddress':'127.0.0.1'}}}}):
   client.return_value.wait_terminal.return_value={'status':'done'}
   with self.assertRaisesRegex(RuntimeError,'timer unavailable'):gate.confirm()
  self.assertTrue((self.root/'pending.json').exists())
  self.assertFalse((self.root/'last-deployment.json').exists())
  self.assertNotIn(('systemctl','stop','memos-release-rollback.timer'),events)
  self.assertEqual(json.loads(self.config.read_text())['instanceVersion'],'previous')
  self.assertEqual(self.run_rollback(release=self.release())['status'],'rolled-back')
 def test_confirmation_preserves_paused_backup_schedule(self):
  import json
  from unittest.mock import patch
  self.pending.update(deploymentTitle='test-deployment',snapshotId='a'*64,backupEnabled=False);self.write()
  def command(*args):
   if args[0]=='curl':return json.dumps({'commit':self.pending['commit'],'needsSetup':False,'accessMode':'INSTANCE_ACCESS_MODE_PRIVATE'})
   return ''
  with patch.object(gate,'ROOT',self.root),patch.object(gate,'CONFIG',self.config),patch.object(gate,'command',side_effect=command) as commands,patch.object(gate,'Dokploy') as client,patch.object(gate,'wait_for_release',return_value={'NetworkSettings':{'Networks':{'test':{'IPAddress':'127.0.0.1'}}}}):
   client.return_value.wait_terminal.return_value={'status':'done'}
   self.assertEqual(gate.confirm()['status'],'confirmed')
   events=[item.args for item in commands.call_args_list]
  self.assertNotIn(('systemctl','start','memos-backup.timer'),events)
  self.assertIn(('systemctl','stop','memos-backup.timer'),events)
  self.assertFalse((self.root/'pending.json').exists())
 def test_confirmation_can_retry_after_backup_timer_recovers(self):
  import json
  from unittest.mock import patch
  self.pending.update(deploymentTitle='test-deployment',snapshotId='a'*64);self.write()
  attempts=0
  def command(*args):
   nonlocal attempts
   if args[0]=='curl':return json.dumps({'commit':self.pending['commit'],'needsSetup':False,'accessMode':'INSTANCE_ACCESS_MODE_PRIVATE'})
   if args==('systemctl','start','memos-backup.timer'):
    attempts+=1
    if attempts==1:raise RuntimeError('temporary timer failure')
   return ''
  with patch.object(gate,'ROOT',self.root),patch.object(gate,'CONFIG',self.config),patch.object(gate,'command',side_effect=command),patch.object(gate,'Dokploy') as client,patch.object(gate,'wait_for_release',return_value={'NetworkSettings':{'Networks':{'test':{'IPAddress':'127.0.0.1'}}}}):
   client.return_value.wait_terminal.return_value={'status':'done'}
   with self.assertRaisesRegex(RuntimeError,'temporary timer failure'):gate.confirm()
   self.assertEqual(gate.confirm()['status'],'confirmed')
  self.assertFalse((self.root/'pending.json').exists())
  self.assertEqual(json.loads((self.root/'last-deployment.json').read_text())['status'],'confirmed')
 def test_missing_container_restores_old_service_and_backup_schedule(self):
  self.assertEqual(self.run_rollback(exists=False)['status'],'rolled-back')
  self.assertTrue(any(event[:2]==('docker','compose') for event in self.events))
  self.assertIn(('systemctl','start','memos-backup.timer'),self.events)
  self.assertFalse((self.root/'pending.json').exists())
 def test_missing_container_with_new_writes_preserves_data_and_requires_intervention(self):
  import json
  with closing(sqlite3.connect(self.source/'memos_prod.db')) as db,db:db.execute("UPDATE memo SET content='keep this new memory'")
  with self.assertRaisesRegex(RuntimeError,'new content'):self.run_rollback(exists=False)
  with closing(sqlite3.connect(self.source/'memos_prod.db')) as db:self.assertEqual(db.execute('SELECT content FROM memo').fetchone()[0],'keep this new memory')
  self.client.restore.assert_not_called()
  self.assertFalse(any(event[:2] in (('docker','compose'),('docker','start')) for event in self.events))
  self.assertIn(('systemctl','start','memos-backup.timer'),self.events)
  self.assertTrue((self.root/'pending.json').exists())
  receipt=json.loads((self.root/'last-rollback-attempt.json').read_text())
  self.assertEqual(receipt['status'],'blocked');self.assertTrue(receipt['requiresIntervention'])
 def test_docker_daemon_failure_is_not_treated_as_a_missing_container(self):
  import subprocess
  error=subprocess.CalledProcessError(1,['docker'],stderr='Cannot connect to Docker daemon')
  with self.assertRaises(subprocess.CalledProcessError):self.run_rollback(failure=error)
  self.client.restore.assert_not_called()
  self.assertFalse(any(event[:2]==('docker','compose') for event in self.events))
  self.assertTrue((self.root/'pending.json').exists())
 def test_missing_container_with_unreadable_database_never_replaces_it(self):
  original=b'not a readable sqlite database'
  (self.source/'memos_prod.db').write_bytes(original)
  with self.assertRaisesRegex(RuntimeError,'unreadable'):self.run_rollback(exists=False)
  self.assertEqual((self.source/'memos_prod.db').read_bytes(),original)
  self.client.restore.assert_not_called()
  self.assertIn(('systemctl','start','memos-backup.timer'),self.events)
 def test_failed_health_verification_keeps_pending_and_never_records_success(self):
  with self.assertRaisesRegex(RuntimeError,'unhealthy'):self.run_rollback(healthy_failure=RuntimeError('unhealthy'))
  self.assertTrue((self.root/'pending.json').exists())
  self.assertFalse((self.root/'last-rollback.json').exists())
  self.assertIn(('systemctl','start','memos-backup.timer'),self.events)
 def test_retry_after_interrupted_health_check_restores_consistent_state(self):
  with self.assertRaisesRegex(RuntimeError,'interrupted'):self.run_rollback(healthy_failure=RuntimeError('interrupted'))
  self.assertEqual(self.run_rollback(release=self.release())['status'],'rolled-back')
  self.assertEqual(self.run_rollback(release=self.release())['status'],'already-rolled-back')
  self.client.restore.assert_not_called()
 def test_backup_resumption_failure_keeps_pending_and_failed_receipt(self):
  import json
  with self.assertRaisesRegex(RuntimeError,'timer unavailable'):self.run_rollback(backup_failure=RuntimeError('timer unavailable'))
  self.assertTrue((self.root/'pending.json').exists())
  self.assertFalse((self.root/'last-rollback.json').exists())
  receipt=json.loads((self.root/'last-rollback-attempt.json').read_text())
  self.assertEqual(receipt['status'],'failed');self.assertIn('timer unavailable',receipt['backupResumeError'])
 def test_watchdog_then_matching_ci_request_does_not_restore_twice(self):
  self.assertEqual(self.run_rollback()['status'],'rolled-back')
  self.assertEqual(self.run_rollback(release=self.release())['status'],'already-rolled-back')
  self.client.restore.assert_not_called()
  self.assertFalse(any(event[:2] in (('docker','compose'),('docker','stop')) for event in self.events))
  self.client.check.assert_called_once_with(self.pending['dokploy'],self.pending['dokploy']['previousCompose'])
 def test_ci_then_watchdog_and_repeated_ci_leave_the_completed_release_unchanged(self):
  self.assertEqual(self.run_rollback(release=self.release())['status'],'rolled-back')
  self.assertEqual(self.run_rollback()['status'],'no pending release')
  self.assertEqual(self.run_rollback(release=self.release())['status'],'already-rolled-back')
  self.client.restore.assert_not_called();self.assertEqual(self.events,[])
 def test_matching_historical_receipt_cannot_claim_a_later_declaration_is_restored(self):
  self.assertEqual(self.run_rollback()['status'],'rolled-back')
  with self.assertRaisesRegex(RuntimeError,'configuration changed'):
   self.run_rollback(release=self.release(),check_failure=RuntimeError('configuration changed'))
  self.client.restore.assert_not_called();self.assertEqual(self.events,[])
 def test_stale_ci_identity_cannot_roll_back_a_new_pending_release(self):
  release={**self.release(),'commit':'d'*40}
  with self.assertRaisesRegex(RuntimeError,'identity'):self.run_rollback(release=release)
  self.client.restore.assert_not_called()
  self.assertEqual(self.events,[])
  self.assertTrue((self.root/'pending.json').exists())
 def test_same_commit_with_different_image_or_template_is_not_the_same_release(self):
  for mismatch in ({'digest':'sha256:'+'e'*64},{'composeSha256':'f'*64}):
   with self.subTest(mismatch=mismatch),self.assertRaisesRegex(RuntimeError,'identity'):
    self.run_rollback(release={**self.release(),**mismatch})
   self.client.restore.assert_not_called();self.assertEqual(self.events,[])
 def test_missing_or_other_release_receipt_cannot_prove_success(self):
  import json
  (self.root/'pending.json').unlink()
  for receipt in (None,{**self.pending,'commit':'d'*40,'status':'rolled-back'}):
   with self.subTest(receipt=receipt is not None):
    if receipt:(self.root/'last-rollback.json').write_text(json.dumps(receipt))
    with self.assertRaisesRegex(RuntimeError,'receipt'):self.run_rollback(release=self.release())
    self.client.restore.assert_not_called()
    self.assertEqual(self.events,[])

class MissingContainerRaceTest(unittest.TestCase):
 def test_removal_between_query_and_stop_is_only_accepted_after_successful_requery(self):
  import subprocess
  from unittest.mock import patch
  stop_error=subprocess.CalledProcessError(1,['docker','stop'],stderr='No such container')
  for final in ('', 'still-present', subprocess.CalledProcessError(1,['docker'],stderr='permission denied')):
   with self.subTest(final=final),patch.object(gate,'command',side_effect=['present',stop_error,final]):
    if final=='':self.assertFalse(gate.stop_for_rollback())
    else:
     with self.assertRaises(subprocess.CalledProcessError):gate.stop_for_rollback()

class RemoteRollbackIdentityTest(unittest.TestCase):
 def test_remote_entrypoint_requires_and_forwards_the_release_identity(self):
  import io,json,os
  from unittest.mock import patch
  release={'commit':'a'*40,'digest':'sha256:'+'b'*64,'repository':'ghcr.io/egosay/kairos'}
  with tempfile.TemporaryDirectory() as directory:
   with patch.object(gate,'ROOT',pathlib.Path(directory)),patch.dict(os.environ,{'SSH_ORIGINAL_COMMAND':'rollback'}),patch.object(gate.sys,'stdin',io.StringIO(json.dumps(release))),patch.object(gate,'rollback',return_value={'status':'rolled-back'}) as rollback,patch('builtins.print'):
    gate.main();rollback.assert_called_once_with(release)
   with patch.object(gate,'ROOT',pathlib.Path(directory)),patch.dict(os.environ,{'SSH_ORIGINAL_COMMAND':'rollback'}),patch.object(gate.sys,'stdin',io.StringIO('')),patch.object(gate,'rollback') as rollback:
    with self.assertRaises(json.JSONDecodeError):gate.main()
    rollback.assert_not_called()

if __name__=='__main__':unittest.main()
