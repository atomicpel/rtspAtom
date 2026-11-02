import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../lib/db.js';

test('миграция 1 → 2: компьютеры превращаются в плоский список потоков, доступ сохраняется', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtspatom-mig-'));
  const file = path.join(dir, 'db.sqlite');
  // База версии 1.2 (схема миграции 1)
  const old = new DatabaseSync(file);
  const ddl = fs.readFileSync(new URL('../lib/db.js', import.meta.url), 'utf8');
  const m1 = ddl.slice(ddl.indexOf('CREATE TABLE users'), ddl.indexOf('`,', ddl.indexOf('CREATE TABLE users')));
  old.exec(m1);
  old.exec('PRAGMA user_version = 1');
  const now = new Date().toISOString();
  old.exec(`
    INSERT INTO computers VALUES ('c1','КПП',  '', '', '', 1, '${now}');
    INSERT INTO computers VALUES ('c2','Склад','', '', '', 0, '${now}');
    INSERT INTO computers VALUES ('c3','Пустой','', '', '', 1, '${now}');
    INSERT INTO streams VALUES ('s1','c1','Въезд','rtsp://a/','rtsp','u','p','tcp',1,1,'${now}');
    INSERT INTO streams VALUES ('s2','c2','Ворота','rtsp://b/','rtsp','','','auto',1,1,'${now}');
    INSERT INTO users VALUES ('u1','all','x','viewer',0,'[]','[]',1,'${now}',NULL);
    INSERT INTO users VALUES ('u2','kpp','x','viewer',0,'[]','["c1"]',1,'${now}',NULL);
    INSERT INTO users VALUES ('u3','empty','x','viewer',0,'[]','["c3"]',1,'${now}',NULL);
  `);
  old.close();

  const db = openDb(file);
  try {
    const streams = db.prepare('SELECT * FROM streams ORDER BY sort').all();
    assert.deepEqual(streams.map((s) => [s.id, s.name, s.description, s.is_active]), [
      ['s1', 'Въезд', 'КПП', 1],
      ['s2', 'Ворота', 'Склад', 0], // компьютер был отключён — поток тоже
    ]);
    assert.equal(streams[0].source_password, 'p');
    const acc = Object.fromEntries(db.prepare('SELECT login, allowed_stream_ids FROM users').all().map((u) => [u.login, JSON.parse(u.allowed_stream_ids)]));
    assert.deepEqual(acc.all, []);
    assert.deepEqual(acc.kpp, ['s1']);
    assert.deepEqual(acc.empty, ['-'], 'пользователь без потоков не получает доступ ко всем');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'computers'").get().n, 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
