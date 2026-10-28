-- Preserve historical reservations; only their unit changes. An operator reset is separate.
ALTER TABLE record_graph_source ADD COLUMN stage VARCHAR(32) NOT NULL DEFAULT '';
ALTER TABLE record_graph_source ADD COLUMN failure_stage VARCHAR(32) NOT NULL DEFAULT '';
ALTER TABLE record_graph_source ADD COLUMN last_attempt_ts BIGINT NOT NULL DEFAULT 0;
ALTER TABLE record_graph_source ADD COLUMN status_version BIGINT NOT NULL DEFAULT 1;
UPDATE record_graph_budget SET reserved=reserved*1000000;

-- No original text, credentials, prompts or raw provider responses are retained.
CREATE TABLE record_graph_call (
  id VARCHAR(64) PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  memo_id INTEGER NOT NULL,
  revision BIGINT NOT NULL,
  stage VARCHAR(32) NOT NULL,
  account_key VARCHAR(64) NOT NULL,
  budget_day VARCHAR(10) NOT NULL,
  reserved_units BIGINT NOT NULL,
  charged_units BIGINT NOT NULL,
  usage_kind VARCHAR(24) NOT NULL DEFAULT 'unknown',
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  outcome VARCHAR(24) NOT NULL DEFAULT 'pending',
  error_code VARCHAR(64) NOT NULL DEFAULT '',
  http_status INTEGER NOT NULL DEFAULT 0,
  provider_code INTEGER NOT NULL DEFAULT 0,
  request_id VARCHAR(128) NOT NULL DEFAULT '',
  started_ts BIGINT NOT NULL,
  finished_ts BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX idx_graph_call_history ON record_graph_call(owner_id,memo_id,started_ts,id);
CREATE INDEX idx_graph_call_budget ON record_graph_call(account_key,budget_day);
CREATE TABLE record_graph_runtime (
  connection_key VARCHAR(64) PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  trips INTEGER NOT NULL DEFAULT 0,
  blocked_until BIGINT NOT NULL DEFAULT 0,
  error_code VARCHAR(64) NOT NULL DEFAULT ''
);
CREATE TABLE record_graph_retry (
  owner_id INTEGER NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  payload TEXT NOT NULL,
  created_ts BIGINT NOT NULL,
  PRIMARY KEY(owner_id,request_id)
);
CREATE TRIGGER graph_call_memo_delete AFTER DELETE ON memo FOR EACH ROW BEGIN DELETE FROM record_graph_call WHERE memo_id=OLD.id; END;
CREATE TRIGGER graph_call_owner_change AFTER UPDATE ON memo FOR EACH ROW BEGIN DELETE FROM record_graph_call WHERE memo_id=OLD.id AND OLD.creator_id<>NEW.creator_id; END;
CREATE TRIGGER graph_work_user_delete AFTER DELETE ON user FOR EACH ROW BEGIN DELETE FROM record_graph_call WHERE owner_id=OLD.id;DELETE FROM record_graph_retry WHERE owner_id=OLD.id; END;

-- Recover legacy terminal failures once, without inventing historical timestamps.
UPDATE record_graph_source SET state='retrying',error_code='legacy-unknown',attempts=0,next_attempt_ts=0,lease_until=0,lease_token='',status_version=status_version+1 WHERE dirty=1 AND state='failed';
