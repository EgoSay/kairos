-- system_setting
CREATE TABLE system_setting (
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  UNIQUE(name)
);

-- user
CREATE TABLE user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  row_status TEXT NOT NULL CHECK (row_status IN ('NORMAL', 'ARCHIVED')) DEFAULT 'NORMAL',
  username TEXT COLLATE BINARY NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'USER',
  email TEXT COLLATE BINARY DEFAULT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX idx_user_email ON user(email);

-- user_setting
CREATE TABLE user_setting (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(user_id, key)
);

-- space
CREATE TABLE space (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}'
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  creator_id INTEGER NOT NULL,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  row_status TEXT NOT NULL CHECK (row_status IN ('NORMAL', 'ARCHIVED')) DEFAULT 'NORMAL',
  content TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL CHECK (visibility IN ('PUBLIC', 'PROTECTED', 'PRIVATE', 'SPACE')) DEFAULT 'PRIVATE',
  pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)) DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '{}',
  space_id INTEGER DEFAULT NULL
);

CREATE INDEX idx_memo_creator_id ON memo(creator_id);
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  creator_id INTEGER NOT NULL,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  filename TEXT NOT NULL DEFAULT '',
  blob BLOB DEFAULT NULL,
  type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  memo_id INTEGER,
  storage_type TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}'
);

-- idp
CREATE TABLE idp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  identifier_filter TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL DEFAULT '{}'
);

-- inbox
CREATE TABLE inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  sender_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '{}'
);

-- memo reaction
CREATE TABLE reaction (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  creator_id INTEGER NOT NULL,
  memo_id INTEGER NOT NULL,
  reaction_type TEXT NOT NULL,
  UNIQUE(creator_id, memo_id, reaction_type)
);

-- memo_share
CREATE TABLE memo_share (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT    NOT NULL UNIQUE,
  memo_id    INTEGER NOT NULL,
  creator_id INTEGER NOT NULL,
  created_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
  expires_ts BIGINT  DEFAULT NULL,
  FOREIGN KEY (memo_id) REFERENCES memo(id) ON DELETE CASCADE
);

CREATE INDEX idx_memo_share_memo_id ON memo_share(memo_id);

-- user_identity
CREATE TABLE user_identity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  provider   TEXT    NOT NULL,
  extern_uid TEXT    NOT NULL,
  created_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
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
