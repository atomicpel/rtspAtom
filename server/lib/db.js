import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  // 1 — начальная схема
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    login TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','operator','viewer')),
    is_admin INTEGER NOT NULL DEFAULT 0,
    allowed_cidrs TEXT NOT NULL DEFAULT '[]',
    allowed_computer_ids TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE TABLE computers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE streams (
    id TEXT PRIMARY KEY,
    computer_id TEXT NOT NULL REFERENCES computers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    protocol TEXT NOT NULL,
    source_login TEXT NOT NULL DEFAULT '',
    source_password TEXT NOT NULL DEFAULT '',
    transport TEXT NOT NULL DEFAULT 'auto',
    is_active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_streams_computer ON streams(computer_id);
  CREATE TABLE ip_rules (
    id TEXT PRIMARY KEY,
    cidr TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('white','black')),
    priority INTEGER NOT NULL DEFAULT 1,
    comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    level TEXT NOT NULL,
    category TEXT NOT NULL,
    user TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    stream TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL
  );
  CREATE INDEX idx_logs_ts ON logs(ts);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE login_attempts (
    ip TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    first_at TEXT NOT NULL,
    blocked_until TEXT
  );
  CREATE TABLE wall_state (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL
  );
  CREATE TABLE wall_configs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    layout TEXT NOT NULL,
    cells TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export const nowIso = () => new Date().toISOString();
