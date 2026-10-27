-- Derived graph data. Change intent is registered in the source transaction.
CREATE TABLE record_graph_owner (
  owner_id INTEGER PRIMARY KEY,
  epoch BIGINT NOT NULL DEFAULT 1
);
CREATE TABLE record_graph_source (
  memo_id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  processed_revision BIGINT NOT NULL DEFAULT 0,
  profile VARCHAR(128) NOT NULL DEFAULT '',
  representation TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  lease_until BIGINT NOT NULL DEFAULT 0,
  lease_token VARCHAR(64) NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_ts BIGINT NOT NULL DEFAULT 0,
  state VARCHAR(32) NOT NULL DEFAULT 'pending',
  error_code VARCHAR(64) NOT NULL DEFAULT '',
  updated_ts BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX idx_graph_source_owner_id ON record_graph_source(owner_id,memo_id);
CREATE INDEX idx_graph_source_due ON record_graph_source(owner_id,dirty,next_attempt_ts,lease_until,memo_id);
CREATE INDEX idx_graph_source_profile ON record_graph_source(owner_id,profile,memo_id);
CREATE TABLE record_graph_edge (
  owner_id INTEGER NOT NULL,
  a INTEGER NOT NULL,
  b INTEGER NOT NULL,
  revision_a BIGINT NOT NULL,
  revision_b BIGINT NOT NULL,
  profile VARCHAR(128) NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(owner_id,a,b)
);
CREATE INDEX idx_graph_edge_b ON record_graph_edge(owner_id,b,a);
INSERT INTO record_graph_source(memo_id,owner_id,representation) SELECT id,creator_id,'{}' FROM memo;
INSERT INTO record_graph_owner(owner_id,epoch) SELECT DISTINCT creator_id,1 FROM memo;
CREATE TRIGGER graph_memo_insert AFTER INSERT ON memo BEGIN INSERT INTO record_graph_source(memo_id,owner_id,representation) VALUES(NEW.id,NEW.creator_id,'{}');INSERT INTO record_graph_owner(owner_id,epoch) VALUES(NEW.creator_id,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=record_graph_owner.epoch+1; END;
CREATE TRIGGER graph_memo_update AFTER UPDATE ON memo BEGIN UPDATE record_graph_source SET owner_id=NEW.creator_id,revision=revision+1,dirty=1,lease_until=0,lease_token='',attempts=0,next_attempt_ts=0,state='pending',error_code='',representation=CASE WHEN OLD.creator_id=NEW.creator_id THEN representation ELSE '{}' END WHERE memo_id=NEW.id;INSERT INTO record_graph_owner(owner_id,epoch) VALUES(OLD.creator_id,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=record_graph_owner.epoch+1;INSERT INTO record_graph_owner(owner_id,epoch) VALUES(NEW.creator_id,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=record_graph_owner.epoch+1; END;
CREATE TRIGGER graph_memo_delete AFTER DELETE ON memo BEGIN DELETE FROM record_graph_edge WHERE a=OLD.id OR b=OLD.id;DELETE FROM record_graph_source WHERE memo_id=OLD.id;INSERT INTO record_graph_owner(owner_id,epoch) VALUES(OLD.creator_id,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=record_graph_owner.epoch+1; END;
CREATE TRIGGER graph_journal_insert AFTER INSERT ON journal_document WHEN NEW.kind IN ('preferences','trash','wander-config','wander-feedback') AND NEW.owner_id>0 BEGIN UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',attempts=0,next_attempt_ts=0 WHERE owner_id=NEW.owner_id AND NEW.kind<>'wander-feedback';INSERT INTO record_graph_owner(owner_id,epoch) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=record_graph_owner.epoch+1; END;
CREATE TRIGGER graph_journal_update AFTER UPDATE ON journal_document WHEN NEW.kind IN ('preferences','trash','wander-config','wander-feedback') AND NEW.owner_id>0 BEGIN UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',attempts=0,next_attempt_ts=0 WHERE owner_id=NEW.owner_id AND NEW.kind<>'wander-feedback';INSERT INTO record_graph_owner(owner_id,epoch) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=record_graph_owner.epoch+1; END;
CREATE TRIGGER graph_journal_delete AFTER DELETE ON journal_document WHEN OLD.kind IN ('preferences','trash','wander-config','wander-feedback') AND OLD.owner_id>0 BEGIN UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',attempts=0,next_attempt_ts=0 WHERE owner_id=OLD.owner_id AND OLD.kind<>'wander-feedback';INSERT INTO record_graph_owner(owner_id,epoch) VALUES(OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=record_graph_owner.epoch+1; END;
CREATE TRIGGER graph_user_delete AFTER DELETE ON user BEGIN DELETE FROM record_graph_edge WHERE owner_id=OLD.id;DELETE FROM record_graph_source WHERE owner_id=OLD.id;DELETE FROM record_graph_owner WHERE owner_id=OLD.id; END;

-- Account-wide conservative model reservations (no credentials or source content).
CREATE TABLE record_graph_budget (
  account_key VARCHAR(64) NOT NULL,
  budget_day VARCHAR(10) NOT NULL,
  reserved BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY(account_key,budget_day)
);

-- Invalidate in-flight work when eligibility or the configured service changes.
CREATE TRIGGER graph_access_space_member_insert AFTER INSERT ON space_member BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; END;
CREATE TRIGGER graph_access_space_member_update AFTER UPDATE ON space_member BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; END;
CREATE TRIGGER graph_access_space_member_delete AFTER DELETE ON space_member BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; END;
CREATE TRIGGER graph_access_space_update AFTER UPDATE ON space BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; END;
CREATE TRIGGER graph_access_space_delete AFTER DELETE ON space BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; END;
CREATE TRIGGER graph_access_user_update AFTER UPDATE ON user BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; END;
CREATE TRIGGER graph_access_memo_relation_insert AFTER INSERT ON memo_relation BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; END;
CREATE TRIGGER graph_access_memo_relation_delete AFTER DELETE ON memo_relation BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; END;
CREATE TRIGGER graph_access_system_setting_insert AFTER INSERT ON system_setting WHEN NEW.name='AI' BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; END;
CREATE TRIGGER graph_access_system_setting_update AFTER UPDATE ON system_setting WHEN NEW.name='AI' BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; END;
CREATE TRIGGER graph_access_system_setting_delete AFTER DELETE ON system_setting WHEN OLD.name='AI' BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; END;
