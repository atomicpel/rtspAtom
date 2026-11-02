import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { openDb } from '../lib/db.js';
import { Watchdog, targetOf, tcpReachable } from '../lib/watchdog.js';
import { saveSettings } from '../lib/settings.js';

function setup() {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO streams (id, name, url, protocol, is_active, sort, created_at) VALUES ('a', 'КЖД', 'rtsp://10.0.0.2:8554/10', 'rtsp', 1, 1, '')`).run();
  db.prepare(`INSERT INTO streams (id, name, url, protocol, is_active, sort, created_at) VALUES ('b', 'Радар', 'rtsp://10.0.0.3:8554/10', 'rtsp', 1, 2, '')`).run();
  const logs = [];
  const log = { info: (c, m) => logs.push(m), warn: (c, m) => logs.push(`WARN ${m}`), error: (c, m) => logs.push(`ERR ${m}`) };
  const restarts = [];
  const sync = {
    reachable: true,
    status: new Map([['s_a', { ready: true, bytesReceived: 100 }], ['s_b', { ready: true, bytesReceived: 100 }]]),
    restartSource: async (id) => { restarts.push(id); },
  };
  let now = 1_000_000;
  const kills = [];
  const reach = { '10.0.0.2': true, '10.0.0.3': false };
  const app = { db, log, sync, startedAt: 0 };
  const w = new Watchdog({ app, now: () => now, reachable: async (h) => reach[h], killServer: () => { kills.push(now); return 1; } });
  return { db, logs, sync, restarts, kills, reach, w, app, tick: async (ms = 10_000) => { now += ms; await w.tick(); }, getNow: () => now };
}

test('самовосстановление: доступное устройство — переподключение, недоступное — только запись в журнал', async () => {
  const t = setup();
  await t.tick();
  assert.equal(t.restarts.length, 0, 'всё работает — ничего не делаем');
  t.sync.status.get('s_a').ready = false;
  t.sync.status.get('s_b').ready = false;
  await t.tick(); await t.tick(); // 20 с без потока
  await t.tick();
  assert.deepEqual(t.restarts, ['a'], 'переподключаем только доступное устройство');
  assert.ok(t.logs.some((m) => /«Радар»: устройство 10\.0\.0\.3:8554 не отвечает по сети/.test(m)));
  assert.ok(t.logs.some((m) => /«КЖД»: устройство доступно, но потока нет/.test(m)));
  for (let i = 0; i < 6; i++) await t.tick(); // меньше 2 минут — повторно не трогаем
  assert.equal(t.restarts.length, 1);
  t.sync.status.get('s_a').ready = true;
  t.sync.status.get('s_a').bytesReceived = 500;
  await t.tick();
  assert.ok(t.logs.some((m) => /«КЖД»: поток восстановился/.test(m)));
  assert.equal(t.logs.filter((m) => /не отвечает по сети/.test(m)).length, 1, 'о недоступном — не чаще раза в 30 минут');
});

test('самовосстановление: «в сети», но данные не идут; два неудачных переподключения — перезапуск видеосервера с ограничением', async () => {
  const t = setup();
  t.reach['10.0.0.3'] = true;
  t.sync.status.get('s_b').ready = false;
  await t.tick();
  // s_a «в сети», но байты не растут
  for (let i = 0; i < 4; i++) await t.tick();
  assert.ok(t.restarts.includes('a'), 'зависший поток переподключён');
  assert.ok(t.logs.some((m) => /«КЖД»: устройство доступно, но данные не идут/.test(m)));
  for (let i = 0; i < 13; i++) await t.tick(); // второе переподключение через 2 минуты
  for (let i = 0; i < 13; i++) await t.tick();
  assert.equal(t.kills.length, 1, 'видеосервер перезапущен');
  assert.ok(t.logs.some((m) => /перезапускаю видеосервер MediaMTX — не помогло переподключение/.test(m)));
  for (let i = 0; i < 100; i++) await t.tick(); // 17 минут — не чаще раза в 30 минут
  assert.equal(t.kills.length, 1);
  saveSettings(t.db, { selfHealServer: false });
  for (let i = 0; i < 400; i++) await t.tick();
  assert.equal(t.kills.length, 1, 'перезапуск сервера выключен в настройках');
});

test('самовосстановление: видеосервер не отвечает минуту — перезапуск; выключено — ничего', async () => {
  const t = setup();
  t.sync.reachable = false;
  for (let i = 0; i < 5; i++) await t.tick();
  assert.equal(t.kills.length, 0);
  await t.tick(); await t.tick();
  assert.equal(t.kills.length, 1);
  const t2 = setup();
  saveSettings(t2.db, { selfHeal: false });
  t2.sync.reachable = false;
  for (let i = 0; i < 20; i++) await t2.tick();
  assert.equal(t2.kills.length, 0);
});

test('самовосстановление: адрес устройства и проверка порта', async () => {
  assert.deepEqual(targetOf('rtsp://user:p@11.196.27.131:8554/10'), { host: '11.196.27.131', port: 8554 });
  assert.deepEqual(targetOf('rtsp://11.196.27.137/10'), { host: '11.196.27.137', port: 554 });
  assert.equal(targetOf('udp+mpegts://0.0.0.0:5004'), null);
  const srv = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  assert.equal(await tcpReachable('127.0.0.1', srv.address().port), true);
  srv.close();
  assert.equal(await tcpReachable('127.0.0.1', 1, 1000), false);
});

test('самовосстановление: запись выключена и камеры «по запросу» — проверяем, только пока смотрят', async () => {
  const t = setup();
  saveSettings(t.db, { camerasAlwaysOn: false });
  t.db.prepare("UPDATE streams SET record = 1 WHERE id = 'b'").run(); // запись включена, но папки архива нет
  t.sync.status.get('s_a').ready = false;
  t.sync.status.get('s_b').ready = false;
  for (let i = 0; i < 20; i++) await t.tick();
  assert.equal(t.restarts.length, 0, 'без зрителей и без записи поток и не должен идти');
  assert.equal(t.kills.length, 0);
  // кто-то открыл камеру, а картинка не идёт
  t.sync.status.set('s_a', { ready: true, readers: 1, bytesReceived: 100 });
  for (let i = 0; i < 6; i++) await t.tick();
  assert.deepEqual(t.restarts, ['a']);
  // с папкой архива камера с записью держится подключённой — проверяется и без зрителей
  t.sync.archiveDir = '/srv/archive';
  t.reach['10.0.0.3'] = true;
  for (let i = 0; i < 4; i++) await t.tick();
  assert.ok(t.restarts.includes('b'));
});
