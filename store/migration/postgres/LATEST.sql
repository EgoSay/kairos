-- system_setting
CREATE TABLE system_setting (
  name TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT NOT NULL
);

-- user
CREATE TABLE "user" (
  id SERIAL PRIMARY KEY,
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  row_status TEXT NOT NULL DEFAULT 'NORMAL',
  username TEXT COLLATE "C" NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'USER',
  email TEXT COLLATE "C" DEFAULT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX idx_user_email ON "user" (email);

-- user_setting
CREATE TABLE user_setting (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(user_id, key)
);

-- space
CREATE TABLE space (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'
);

-- space membership
CREATE TABLE space_member (
  space_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'USER')),
  PRIMARY KEY (space_id, user_id)
);

CREATE INDEX idx_space_member_user_id ON space_member(user_id, space_id);

-- memo
CREATE TABLE memo (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  creator_id INTEGER NOT NULL,
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  row_status TEXT NOT NULL DEFAULT 'NORMAL',
  content TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'PRIVATE',
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL DEFAULT '{}',
  space_id INTEGER DEFAULT NULL
);

CREATE INDEX idx_memo_space_id ON memo(space_id, row_status, created_ts DESC, id DESC);

-- memo_relation
CREATE TABLE memo_relation (
  memo_id INTEGER NOT NULL,
  related_memo_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  UNIQUE(memo_id, related_memo_id, type)
);

CREATE INDEX idx_memo_relation_related_type_memo
  ON memo_relation(related_memo_id, type, memo_id);

-- attachment
CREATE TABLE attachment (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  creator_id INTEGER NOT NULL,
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  filename TEXT NOT NULL,
  blob BYTEA,
  type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  memo_id INTEGER DEFAULT NULL,
  storage_type TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}'
);

-- idp
CREATE TABLE idp (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  identifier_filter TEXT NOT NULL DEFAULT '',
  config JSONB NOT NULL DEFAULT '{}'
);

-- inbox
CREATE TABLE inbox (
  id SERIAL PRIMARY KEY,
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  sender_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL
);

-- memo reaction
CREATE TABLE reaction (
  id SERIAL PRIMARY KEY,
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  creator_id INTEGER NOT NULL,
  memo_id INTEGER NOT NULL,
  reaction_type TEXT NOT NULL,
  UNIQUE(creator_id, memo_id, reaction_type)
);

-- memo_share
CREATE TABLE memo_share (
  id         SERIAL  PRIMARY KEY,
  uid        TEXT    NOT NULL UNIQUE,
  memo_id    INTEGER NOT NULL,
  creator_id INTEGER NOT NULL,
  created_ts BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  expires_ts BIGINT  DEFAULT NULL,
  FOREIGN KEY (memo_id) REFERENCES memo(id) ON DELETE CASCADE
);

CREATE INDEX idx_memo_share_memo_id ON memo_share(memo_id);

-- user_identity
CREATE TABLE user_identity (
  id         SERIAL  PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  provider   TEXT    NOT NULL,
  extern_uid TEXT    NOT NULL,
  created_ts BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_ts BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  UNIQUE (provider, extern_uid),
  UNIQUE (user_id, provider)
);

CREATE INDEX idx_user_identity_user_id ON user_identity(user_id);

-- Private journal resources: one row per preference, snapshot, share or delivery.
CREATE TABLE journal_document (
  owner_id INTEGER NOT NULL,
  kind VARCHAR(64) NOT NULL,
  document_key VARCHAR(128) NOT NULL,
  payload TEXT NOT NULL,
  version BIGINT NOT NULL,
  updated_ts BIGINT NOT NULL,
  PRIMARY KEY (owner_id, kind, document_key)
);
CREATE INDEX idx_journal_kind ON journal_document(kind, owner_id);

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
  updated_ts BIGINT NOT NULL DEFAULT 0,
  stage VARCHAR(32) NOT NULL DEFAULT '',
  failure_stage VARCHAR(32) NOT NULL DEFAULT '',
  last_attempt_ts BIGINT NOT NULL DEFAULT 0,
  status_version BIGINT NOT NULL DEFAULT 1
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
CREATE FUNCTION graph_memo_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO record_graph_source(memo_id,owner_id,representation) VALUES(NEW.id,NEW.creator_id,'{}');INSERT INTO record_graph_owner(owner_id,epoch) VALUES(NEW.creator_id,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=record_graph_owner.epoch+1; RETURN NULL; END; $$;
CREATE TRIGGER graph_memo_insert AFTER INSERT ON memo FOR EACH ROW EXECUTE FUNCTION graph_memo_insert_fn();
CREATE FUNCTION graph_memo_update_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE record_graph_source SET owner_id=NEW.creator_id,revision=revision+1,dirty=1,lease_until=0,lease_token='',attempts=0,next_attempt_ts=0,state='pending',error_code='',representation=CASE WHEN OLD.creator_id=NEW.creator_id THEN representation ELSE '{}' END WHERE memo_id=NEW.id;INSERT INTO record_graph_owner(owner_id,epoch) VALUES(OLD.creator_id,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=record_graph_owner.epoch+1;INSERT INTO record_graph_owner(owner_id,epoch) VALUES(NEW.creator_id,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=record_graph_owner.epoch+1; RETURN NULL; END; $$;
CREATE TRIGGER graph_memo_update AFTER UPDATE ON memo FOR EACH ROW EXECUTE FUNCTION graph_memo_update_fn();
CREATE FUNCTION graph_memo_delete_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM record_graph_edge WHERE a=OLD.id OR b=OLD.id;DELETE FROM record_graph_source WHERE memo_id=OLD.id;INSERT INTO record_graph_owner(owner_id,epoch) VALUES(OLD.creator_id,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=record_graph_owner.epoch+1; RETURN NULL; END; $$;
CREATE TRIGGER graph_memo_delete AFTER DELETE ON memo FOR EACH ROW EXECUTE FUNCTION graph_memo_delete_fn();
CREATE FUNCTION graph_journal_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind IN ('preferences','trash','wander-config','wander-feedback') AND NEW.owner_id>0 THEN UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',attempts=0,next_attempt_ts=0 WHERE owner_id=NEW.owner_id AND NEW.kind<>'wander-feedback';INSERT INTO record_graph_owner(owner_id,epoch) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=record_graph_owner.epoch+1; END IF; RETURN NULL; END; $$;
CREATE TRIGGER graph_journal_insert AFTER INSERT ON journal_document FOR EACH ROW EXECUTE FUNCTION graph_journal_insert_fn();
CREATE FUNCTION graph_journal_update_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind IN ('preferences','trash','wander-config','wander-feedback') AND NEW.owner_id>0 THEN UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',attempts=0,next_attempt_ts=0 WHERE owner_id=NEW.owner_id AND NEW.kind<>'wander-feedback';INSERT INTO record_graph_owner(owner_id,epoch) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=record_graph_owner.epoch+1; END IF; RETURN NULL; END; $$;
CREATE TRIGGER graph_journal_update AFTER UPDATE ON journal_document FOR EACH ROW EXECUTE FUNCTION graph_journal_update_fn();
CREATE FUNCTION graph_journal_delete_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.kind IN ('preferences','trash','wander-config','wander-feedback') AND OLD.owner_id>0 THEN UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',attempts=0,next_attempt_ts=0 WHERE owner_id=OLD.owner_id AND OLD.kind<>'wander-feedback';INSERT INTO record_graph_owner(owner_id,epoch) VALUES(OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET epoch=record_graph_owner.epoch+1; END IF; RETURN NULL; END; $$;
CREATE TRIGGER graph_journal_delete AFTER DELETE ON journal_document FOR EACH ROW EXECUTE FUNCTION graph_journal_delete_fn();
CREATE FUNCTION graph_user_delete_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM record_graph_edge WHERE owner_id=OLD.id;DELETE FROM record_graph_source WHERE owner_id=OLD.id;DELETE FROM record_graph_owner WHERE owner_id=OLD.id; RETURN NULL; END; $$;
CREATE TRIGGER graph_user_delete AFTER DELETE ON "user" FOR EACH ROW EXECUTE FUNCTION graph_user_delete_fn();

-- Account-wide conservative model reservations (no credentials or source content).
CREATE TABLE record_graph_budget (
  account_key VARCHAR(64) NOT NULL,
  budget_day VARCHAR(10) NOT NULL,
  reserved BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY(account_key,budget_day)
);

-- Invalidate in-flight work when eligibility or the configured service changes.
CREATE FUNCTION graph_access_space_member_insert_fn() RETURNS TRIGGER AS $$ BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER graph_access_space_member_insert AFTER INSERT ON "space_member" FOR EACH ROW EXECUTE FUNCTION graph_access_space_member_insert_fn();
CREATE FUNCTION graph_access_space_member_update_fn() RETURNS TRIGGER AS $$ BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER graph_access_space_member_update AFTER UPDATE ON "space_member" FOR EACH ROW EXECUTE FUNCTION graph_access_space_member_update_fn();
CREATE FUNCTION graph_access_space_member_delete_fn() RETURNS TRIGGER AS $$ BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER graph_access_space_member_delete AFTER DELETE ON "space_member" FOR EACH ROW EXECUTE FUNCTION graph_access_space_member_delete_fn();
CREATE FUNCTION graph_access_space_update_fn() RETURNS TRIGGER AS $$ BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER graph_access_space_update AFTER UPDATE ON "space" FOR EACH ROW EXECUTE FUNCTION graph_access_space_update_fn();
CREATE FUNCTION graph_access_space_delete_fn() RETURNS TRIGGER AS $$ BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER graph_access_space_delete AFTER DELETE ON "space" FOR EACH ROW EXECUTE FUNCTION graph_access_space_delete_fn();
CREATE FUNCTION graph_access_user_update_fn() RETURNS TRIGGER AS $$ BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER graph_access_user_update AFTER UPDATE ON "user" FOR EACH ROW EXECUTE FUNCTION graph_access_user_update_fn();
CREATE FUNCTION graph_access_memo_relation_insert_fn() RETURNS TRIGGER AS $$ BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER graph_access_memo_relation_insert AFTER INSERT ON "memo_relation" FOR EACH ROW EXECUTE FUNCTION graph_access_memo_relation_insert_fn();
CREATE FUNCTION graph_access_memo_relation_delete_fn() RETURNS TRIGGER AS $$ BEGIN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER graph_access_memo_relation_delete AFTER DELETE ON "memo_relation" FOR EACH ROW EXECUTE FUNCTION graph_access_memo_relation_delete_fn();
CREATE FUNCTION graph_access_system_setting_insert_fn() RETURNS TRIGGER AS $$ BEGIN IF NEW.name='AI' THEN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; END IF; RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER graph_access_system_setting_insert AFTER INSERT ON "system_setting" FOR EACH ROW EXECUTE FUNCTION graph_access_system_setting_insert_fn();
CREATE FUNCTION graph_access_system_setting_update_fn() RETURNS TRIGGER AS $$ BEGIN IF NEW.name='AI' THEN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; END IF; RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER graph_access_system_setting_update AFTER UPDATE ON "system_setting" FOR EACH ROW EXECUTE FUNCTION graph_access_system_setting_update_fn();
CREATE FUNCTION graph_access_system_setting_delete_fn() RETURNS TRIGGER AS $$ BEGIN IF OLD.name='AI' THEN UPDATE record_graph_owner SET epoch=epoch+1;UPDATE record_graph_source SET dirty=1,lease_until=0,lease_token='',next_attempt_ts=0,attempts=0; END IF; RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER graph_access_system_setting_delete AFTER DELETE ON "system_setting" FOR EACH ROW EXECUTE FUNCTION graph_access_system_setting_delete_fn();


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
CREATE FUNCTION graph_call_memo_delete_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM record_graph_call WHERE memo_id=OLD.id; RETURN NULL; END; $$;
CREATE TRIGGER graph_call_memo_delete AFTER DELETE ON memo FOR EACH ROW EXECUTE FUNCTION graph_call_memo_delete_fn();
CREATE FUNCTION graph_call_owner_change_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM record_graph_call WHERE memo_id=OLD.id AND OLD.creator_id<>NEW.creator_id; RETURN NULL; END; $$;
CREATE TRIGGER graph_call_owner_change AFTER UPDATE ON memo FOR EACH ROW EXECUTE FUNCTION graph_call_owner_change_fn();
CREATE FUNCTION graph_work_user_delete_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM record_graph_call WHERE owner_id=OLD.id;DELETE FROM record_graph_retry WHERE owner_id=OLD.id; RETURN NULL; END; $$;
CREATE TRIGGER graph_work_user_delete AFTER DELETE ON "user" FOR EACH ROW EXECUTE FUNCTION graph_work_user_delete_fn();
