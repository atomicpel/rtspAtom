import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../lib/db.js';
import { EventLog } from '../lib/eventlog.js';
import { getSettings, saveSettings } from '../lib/settings.js';
import { MediaMtxClient, StreamSync } from '../lib/mediamtx.js';
import { ArchiveManager, moveFile, segmentStart } from '../lib/archive.js';
import { forbiddenReason, mountOf, mountPoints, normalizeDir, startRelocation } from '../lib/archivedir.js';
import { getValue, setValue } from '../lib/settings.js';
import { createHandler } from '../lib/app.js';
import { startFakeMediaMtx } from './fake-mediamtx.js';

let server; let base; let fake; let app; let tmp;

class Client {
  constructor(ip = '127.0.0.1') { this.ip = ip; this.cookie = ''; }
  async req(method, url, body, { csrf = true } = {}) {
    const headers = { 'X-Forwarded-For': this.ip };
    if (this.cookie) headers.Cookie = this.cookie;
    if (csrf && method !== 'GET') headers['X-RTSPAtom'] = '1';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* текст */ }
    return { status: res.status, data, headers: res.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  put(u, b = {}) { return this.req('PUT', u, b); }
  del(u) { return this.req('DELETE', u); }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtspatom-test-'));
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><title>t</title>');
  fake = startFakeMediaMtx();
  const fakeUrl = await fake.listen();
  const db = openDb(path.join(tmp, 'test.db'));
  const log = new EventLog(db, { quiet: true });
  const config = {
    publicDir: tmp, trustProxy: true, tls: { enabled: false },
    mediamtx: { apiUrl: fakeUrl, hlsUrl: fakeUrl, webrtcUrl: fakeUrl, playbackUrl: fakeUrl, cdnSecret: 'test-cdn-secret' },
    archiveDir: path.join(tmp, 'archive'),
  };
  const sync = new StreamSync({ db, client: new MediaMtxClient(fakeUrl), log, settings: () => getSettings(db) });
  app = { db, config, log, sync, startedAt: Date.now() };
  server = http.createServer(createHandler(app));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await fake.close();
  app.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const admin = new Client('127.0.0.1');
const remoteAdmin = new Client('10.0.0.5');
let streamId; let otherStreamId;

test('первичная настройка разрешена только с localhost', async () => {
  const anon = new Client('10.0.0.9');
  let r = await anon.get('/api/auth/status');
  assert.equal(r.data.setupRequired, true);
  assert.equal(r.data.setupAllowedHere, false);
  r = await anon.post('/api/auth/setup', { login: 'admin', password: 'secret-pass' });
  assert.equal(r.status, 403);

  r = await admin.post('/api/auth/setup', { login: 'admin', password: 'short' });
  assert.equal(r.status, 400);
  r = await admin.post('/api/auth/setup', { login: 'admin', password: 'secret-pass' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.isAdmin, true);
  assert.match(r.headers.get('set-cookie'), /HttpOnly; ?|SameSite=Strict/);
  r = await admin.post('/api/auth/setup', { login: 'admin2', password: 'secret-pass' });
  assert.equal(r.status, 409);
});

test('статика и защита API без сессии', async () => {
  const anon = new Client();
  let r = await anon.get('/');
  assert.equal(r.status, 200);
  assert.ok(r.headers.get('content-security-policy'));
  r = await anon.get('/some/spa/route');
  assert.equal(r.status, 200);
  r = await anon.get('/api/streams');
  assert.equal(r.status, 401);
});

test('вход: неверный пароль, CSRF-заголовок, блокировка по IP', async () => {
  saveSettings(app.db, { rateLimitLogin: 3 });
  const c = new Client('10.0.0.7');
  let r = await c.req('POST', '/api/auth/login', { login: 'admin', password: 'secret-pass' }, { csrf: false });
  assert.equal(r.status, 403);
  for (let i = 0; i < 3; i++) {
    r = await c.post('/api/auth/login', { login: 'admin', password: 'wrong-pass' });
    assert.equal(r.status, 401);
  }
  r = await c.post('/api/auth/login', { login: 'admin', password: 'secret-pass' });
  assert.equal(r.status, 429, 'после 3 ошибок вход заблокирован даже с верным паролем');

  r = await remoteAdmin.post('/api/auth/login', { login: 'admin', password: 'secret-pass' });
  assert.equal(r.status, 200);
  r = await remoteAdmin.get('/api/auth/me');
  assert.equal(r.data.user.login, 'admin');
  saveSettings(app.db, { rateLimitLogin: 5 });
});

test('потоки: учётные данные из URL выносятся, пароль не отдаётся', async () => {
  let r = await admin.post('/api/streams', { name: 'Въезд', url: 'ftp://x' });
  assert.equal(r.status, 400);

  r = await admin.post('/api/streams', { name: 'Склад', url: 'rtsp://192.168.1.65/stream', description: 'Западный' });
  assert.equal(r.status, 200);
  otherStreamId = r.data.id;
  assert.equal(r.data.description, 'Западный');

  r = await admin.post('/api/streams', {
    name: 'Въезд', url: 'rtsp://cam:p%40ss@192.168.1.64:554/Streaming/Channels/101', transport: 'tcp',
  });
  assert.equal(r.status, 200);
  streamId = r.data.id;
  assert.equal(r.data.protocol, 'rtsp');
  assert.equal(r.data.sourceLogin, 'cam');
  assert.equal(r.data.hasPassword, true);
  assert.ok(!JSON.stringify(r.data).includes('p@ss'));
  assert.ok(!r.data.url.includes('cam:'));

  await app.sync.trigger();
  const conf = fake.paths.get(`s_${streamId}`);
  assert.ok(conf, 'путь создан в MediaMTX');
  assert.equal(conf.source, 'rtsp://cam:p%40ss@192.168.1.64:554/Streaming/Channels/101');
  assert.equal(conf.rtspTransport, 'tcp');
  assert.equal(conf.sourceOnDemand, false);
});

test('статус потока берётся из MediaMTX', async () => {
  let r = await admin.get('/api/streams');
  let s = r.data.find((x) => x.id === streamId);
  assert.equal(s.status, 'reconnecting');
  fake.ready.add(`s_${streamId}`);
  await app.sync.refreshStatus();
  r = await admin.get('/api/streams');
  s = r.data.find((x) => x.id === streamId);
  assert.equal(s.status, 'online');
  assert.deepEqual(s.tracks, ['H264']);
  // Порядок: новые потоки в конце, порядок меняется
  assert.deepEqual(r.data.map((x) => x.id), [otherStreamId, streamId]);
  await admin.put('/api/streams-order', { ids: [streamId, otherStreamId] });
  r = await admin.get('/api/streams');
  assert.deepEqual(r.data.map((x) => x.id), [streamId, otherStreamId]);
});

test('редактирование: пустой пароль сохраняет старый, отключение удаляет путь', async () => {
  let r = await admin.put(`/api/streams/${streamId}`, { name: 'Въезд-2', sourcePassword: '' });
  assert.equal(r.data.hasPassword, true);
  await app.sync.trigger();
  assert.match(fake.paths.get(`s_${streamId}`).source, /cam:p%40ss@/);

  r = await admin.put(`/api/streams/${streamId}`, { isActive: false });
  assert.equal(r.data.status, 'offline');
  await app.sync.trigger();
  assert.equal(fake.paths.has(`s_${streamId}`), false);
  await admin.put(`/api/streams/${streamId}`, { isActive: true });
  await app.sync.trigger();
  assert.equal(fake.paths.has(`s_${streamId}`), true);
});

test('старый MediaMTX: rtspTransport заменяется на sourceProtocol', async () => {
  fake.legacyTransport = true;
  fake.paths.delete(`s_${streamId}`);
  await app.sync.trigger();
  const conf = fake.paths.get(`s_${streamId}`);
  assert.equal(conf.sourceProtocol, 'tcp');
  assert.equal(conf.rtspTransport, undefined);
  fake.legacyTransport = false;
});

test('проверка источника через MediaMTX', async () => {
  const r = await admin.post('/api/streams/probe', { url: 'rtsp://192.168.1.64/stream', streamId });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.deepEqual(r.data.tracks, ['H264', 'MPEG-4 Audio']);
  assert.equal([...fake.paths.keys()].some((k) => k.startsWith('probe_')), false, 'временный путь удалён');
});

test('пользователи, права и доступ к потокам', async () => {
  let r = await admin.post('/api/users', {
    login: 'viewer1', password: 'viewer-pass', role: 'viewer', allowedStreamIds: [otherStreamId],
  });
  assert.equal(r.status, 200);
  const viewerId = r.data.id;
  r = await admin.post('/api/users', { login: 'viewer1', password: 'viewer-pass' });
  assert.equal(r.status, 409);

  const v = new Client('10.0.0.20');
  r = await v.post('/api/auth/login', { login: 'viewer1', password: 'viewer-pass' });
  assert.equal(r.status, 200);
  r = await v.get('/api/streams');
  assert.deepEqual(r.data.map((c) => c.id), [otherStreamId]);
  assert.equal(r.data[0].url, '', 'наблюдатель не видит адрес камеры');
  r = await v.get('/api/users');
  assert.equal(r.status, 403);
  r = await v.post('/api/streams', { name: 'x', url: 'rtsp://1.2.3.4/' });
  assert.equal(r.status, 403);
  r = await v.get('/api/logs');
  assert.equal(r.status, 403);
  r = await v.get(`/hls/${streamId}/index.m3u8`);
  assert.equal(r.status, 403, 'нет доступа к чужому потоку');

  // Доступ ко всем потокам — видео идёт через прокси
  fake.ready.add(`s_${streamId}`);
  await admin.put(`/api/users/${viewerId}`, { allowedStreamIds: [] });
  r = await v.get(`/hls/${streamId}/index.m3u8?_HLS_msn=3`);
  assert.equal(r.status, 200);
  assert.match(r.data, new RegExp(`#FAKE s_${streamId} index.m3u8\\?_HLS_msn=3`));
  r = await admin.get('/api/streams');
  assert.equal(r.data.find((x) => x.id === streamId).viewers, 1);

  // Ограничение по IP пользователя
  await admin.put(`/api/users/${viewerId}`, { allowedCidrs: ['10.1.0.0/16'] });
  r = await v.get('/api/streams');
  assert.equal(r.status, 401, 'сессия с неразрешённого адреса не действует');
  r = await v.post('/api/auth/login', { login: 'viewer1', password: 'viewer-pass' });
  assert.equal(r.status, 401);

  // Отключение пользователя завершает его сессии
  const v2 = new Client('10.1.2.3');
  r = await v2.post('/api/auth/login', { login: 'viewer1', password: 'viewer-pass' });
  assert.equal(r.status, 200);
  await admin.put(`/api/users/${viewerId}`, { isActive: false });
  r = await v2.get('/api/streams');
  assert.equal(r.status, 401);
});

test('защита последнего администратора и самоудаления', async () => {
  const me = (await admin.get('/api/auth/me')).data.user;
  let r = await admin.put(`/api/users/${me.id}`, { isAdmin: false });
  assert.equal(r.status, 400);
  r = await admin.del(`/api/users/${me.id}`);
  assert.equal(r.status, 400);
  r = await admin.put(`/api/users/${me.id}`, { isActive: false });
  assert.equal(r.status, 400);
});

test('без общего секрета MediaMTX прокси сообщает понятную ошибку', async () => {
  app.config.mediamtx.cdnSecret = '';
  const r = await admin.get(`/hls/${streamId}/index.m3u8`);
  assert.equal(r.status, 502);
  assert.match(r.data.error, /hlsCDNSecret/);
  app.config.mediamtx.cdnSecret = 'test-cdn-secret';
});

test('WebRTC (WHEP): сигнализация через панель с проверкой прав и учётом зрителей', async () => {
  fake.ready.add(`s_${streamId}`);
  const sdp = { method: 'POST', headers: { 'Content-Type': 'application/sdp', 'X-RTSPAtom': '1', Cookie: admin.cookie }, body: 'v=0 offer' };
  // без входа и без CSRF-заголовка — отказ
  let r = await fetch(`${base}/webrtc/${streamId}/whep`, { ...sdp, headers: { 'Content-Type': 'application/sdp', 'X-RTSPAtom': '1' } });
  assert.equal(r.status, 401);
  r = await fetch(`${base}/webrtc/${streamId}/whep`, { ...sdp, headers: { 'Content-Type': 'application/sdp', Cookie: admin.cookie } });
  assert.equal(r.status, 403);

  r = await fetch(`${base}/webrtc/${streamId}/whep`, sdp);
  assert.equal(r.status, 201);
  assert.equal(r.headers.get('content-type'), 'application/sdp');
  const loc = r.headers.get('location');
  assert.match(loc, new RegExp(`^/webrtc/${streamId}/whep/sess`));
  assert.match(await r.text(), /answer for offer/);

  await app.sync.refreshStatus();
  r = await admin.get('/api/streams');
  assert.equal(r.data.find((x) => x.id === streamId).viewers >= 1, true, 'зритель WebRTC учтён');

  // чужой сеанс удалить нельзя
  const other = new Client('10.0.0.5');
  other.cookie = remoteAdmin.cookie;
  r = await fetch(base + loc, { method: 'DELETE', headers: { 'X-RTSPAtom': '1', Cookie: remoteAdmin.cookie } });
  assert.equal(r.status, 404);
  r = await fetch(base + loc, { method: 'DELETE', headers: { 'X-RTSPAtom': '1', Cookie: admin.cookie } });
  assert.equal(r.status, 200);
  assert.equal(fake.whep.size, 0);

  // отключённый поток
  await admin.put(`/api/streams/${otherStreamId}`, { isActive: false });
  r = await fetch(`${base}/webrtc/${otherStreamId}/whep`, sdp);
  assert.equal(r.status, 409);
  await admin.put(`/api/streams/${otherStreamId}`, { isActive: true });

  // настройка lowLatency видна до входа
  r = await new Client().get('/api/auth/status');
  assert.equal(r.data.lowLatency, true);
});

test('лимит одновременных подключений к видео', async () => {
  saveSettings(app.db, { maxConnections: 1 });
  app.viewers.clear();
  let r = await admin.get(`/hls/${streamId}/index.m3u8`);
  assert.equal(r.status, 200);
  r = await remoteAdmin.get(`/hls/${streamId}/index.m3u8`);
  assert.equal(r.status, 503);
  saveSettings(app.db, { maxConnections: 100 });
});

test('IP-фильтр: нельзя заблокировать себя, чужой адрес блокируется', async () => {
  let r = await remoteAdmin.post('/api/ip-rules', { cidr: '10.0.0.0/8', type: 'black', comment: 'сеть' });
  assert.equal(r.status, 400, 'правило заблокировало бы текущий адрес');
  r = await remoteAdmin.post('/api/ip-rules', { cidr: '10.0.0.5/32', type: 'white', priority: 1, comment: 'мой ПК' });
  assert.equal(r.status, 200);
  assert.equal(r.data.yourIp, '10.0.0.5');
  const other = new Client('10.0.0.99');
  r = await other.get('/');
  assert.equal(r.status, 403);
  r = await other.post('/api/auth/login', { login: 'admin', password: 'secret-pass' });
  assert.equal(r.status, 403);
  // localhost доступен всегда
  r = await admin.get('/api/auth/me');
  assert.equal(r.status, 200);
  const ruleId = r && (await admin.get('/api/ip-rules')).data.rules[0].id;
  r = await admin.del(`/api/ip-rules/${ruleId}`);
  assert.equal(r.status, 200);
});

test('журнал: фильтры и экспорт CSV', async () => {
  let r = await admin.get('/api/logs?category=auth&level=warning');
  assert.equal(r.status, 200);
  assert.ok(r.data.total >= 3);
  assert.ok(r.data.items.every((l) => l.category === 'auth' && l.level === 'warning'));
  r = await admin.get('/api/logs?q=' + encodeURIComponent('Въезд'));
  assert.ok(r.data.items.length > 0);
  r = await admin.get('/api/logs/export?category=admin');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.data, /^\uFEFF?"Дата\/время"/);
});

test('настройки: проверка значений', async () => {
  let r = await admin.put('/api/settings', { sessionTtl: 10 });
  assert.equal(r.status, 400);
  r = await admin.put('/api/settings', { sessionTtl: 7200, camerasAlwaysOn: false, logFormat: 'syslog' });
  assert.equal(r.status, 200);
  assert.equal(r.data.sessionTtl, 7200);
  await app.sync.trigger();
  assert.equal(fake.paths.get(`s_${streamId}`).sourceOnDemand, true);
});

test('поток от энкодера (push): секретный путь, ключ только администратору, смена ключа', async () => {
  let r = await admin.post('/api/streams', { name: 'Энкодер HDMI', mode: 'push' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = r.data.id;
  assert.equal(r.data.mode, 'push');
  assert.equal(r.data.status, 'reconnecting');
  const key = r.data.push.key;
  assert.match(key, /^[a-z0-9]{20}$/);
  assert.equal(r.data.push.path, `live/${key}`);
  assert.equal(r.data.push.rtmpPort, 1935);
  assert.equal(r.data.push.srtPort, 8890);
  await app.sync.trigger();
  assert.deepEqual(fake.paths.get(`live/${key}`), { source: 'publisher' });
  assert.equal(fake.paths.has(`s_${id}`), false);

  // энкодер начал передачу — поток в сети, видео через панель по секретному пути
  fake.ready.add(`live/${key}`);
  await app.sync.refreshStatus();
  r = await admin.get('/api/streams');
  assert.equal(r.data.find((x) => x.id === id).status, 'online');
  r = await admin.get(`/hls/${id}/index.m3u8`);
  assert.equal(r.status, 200);
  assert.match(r.data, new RegExp(`#FAKE live/${key} index.m3u8`));
  const sdp = { method: 'POST', headers: { 'Content-Type': 'application/sdp', 'X-RTSPAtom': '1', Cookie: admin.cookie }, body: 'v=0 offer' };
  const w = await fetch(`${base}/webrtc/${id}/whep`, sdp);
  assert.equal(w.status, 201);
  assert.doesNotMatch(w.headers.get('location'), new RegExp(key), 'ключ не утекает в адрес сеанса');
  await fetch(base + w.headers.get('location'), { method: 'DELETE', headers: { 'X-RTSPAtom': '1', Cookie: admin.cookie } });

  // проверять push-поток нельзя
  r = await admin.post('/api/streams/probe', { mode: 'push' });
  assert.equal(r.status, 400);

  // новый ключ — новый путь, старый удалён
  r = await admin.post(`/api/streams/${id}/push-key`);
  assert.equal(r.status, 200);
  const key2 = r.data.push.key;
  assert.notEqual(key2, key);
  await app.sync.trigger();
  assert.equal(fake.paths.has(`live/${key}`), false);
  assert.equal(fake.paths.has(`live/${key2}`), true);

  // переключение в режим «по адресу» убирает ключ
  r = await admin.put(`/api/streams/${id}`, { mode: 'pull', url: 'rtsp://10.1.1.9/main' });
  assert.equal(r.data.mode, 'pull');
  assert.equal(r.data.push, null);
  await app.sync.trigger();
  assert.equal(fake.paths.has(`live/${key2}`), false);
  assert.equal(fake.paths.get(`s_${id}`).source, 'rtsp://10.1.1.9/main');
  r = await admin.put(`/api/streams/${id}`, { mode: 'push' });
  assert.equal(r.data.mode, 'push');
  assert.equal(r.data.url, '');
  r = await admin.post(`/api/streams/${streamId}/push-key`);
  assert.equal(r.status, 400);
  await admin.del(`/api/streams/${id}`);
});

test('архив: запись в MediaMTX, архивный путь отключённого потока, промежутки, видео, закладки', async () => {
  const dir = app.config.archiveDir;
  app.sync.archiveDir = dir;
  let free = 500 * 1024 ** 3;
  app.archive = new ArchiveManager({
    dir, log: app.log, settings: () => getSettings(app.db),
    statfs: async () => ({ bavail: free / 4096, bsize: 4096, blocks: 1e9 }),
  });
  fs.mkdirSync(dir, { recursive: true });

  let r = await admin.post('/api/streams', { name: 'Архивная', url: 'rtsp://10.9.9.9/main' });
  const id = r.data.id;
  assert.equal(r.data.record, true, 'новым потокам запись включается (настройка по умолчанию)');
  await app.sync.trigger();
  let conf = fake.paths.get(`s_${id}`);
  assert.equal(conf.record, true);
  assert.equal(conf.recordPath, `${dir.replace(/\\/g, '/')}/%path/%Y-%m-%d_%H-%M-%S-%f`);
  assert.equal(conf.recordDeleteAfter, '336h');
  assert.equal(conf.recordSegmentDuration, '10m');

  // срок хранения из настроек
  r = await admin.put('/api/settings', { archiveDays: 3 });
  assert.equal(r.status, 200);
  await app.sync.trigger();
  assert.equal(fake.paths.get(`s_${id}`).recordDeleteAfter, '72h');
  // запись выключена — путь хранения остаётся (старые записи смотрятся и удаляются по сроку)
  r = await admin.put(`/api/streams/${id}`, { record: false });
  assert.equal(r.data.record, false);
  await app.sync.trigger();
  conf = fake.paths.get(`s_${id}`);
  assert.equal(conf.record, false);
  assert.match(conf.recordPath, /%path/);
  await admin.put(`/api/streams/${id}`, { record: true });

  // поток от энкодера: архив пишет путь s_<id>, который забирает поток live/<ключ> через локальный RTSP
  r = await admin.post('/api/streams', { name: 'Энкодер в архив', mode: 'push' });
  const pid = r.data.id;
  const pkey = r.data.push.key;
  await app.sync.trigger();
  assert.deepEqual(fake.paths.get(`live/${pkey}`), { source: 'publisher' });
  const relay = fake.paths.get(`s_${pid}`);
  assert.equal(relay.source, `rtsp://127.0.0.1:8554/live/${pkey}`);
  assert.equal(relay.record, true);
  assert.equal(relay.sourceOnDemand, false);
  // смена ключа: архивный путь тот же, источник новый
  r = await admin.post(`/api/streams/${pid}/push-key`);
  await app.sync.trigger();
  assert.equal(fake.paths.get(`s_${pid}`).source, `rtsp://127.0.0.1:8554/live/${r.data.push.key}`);
  // запись выключена и записей нет — архивного пути нет
  await admin.put(`/api/streams/${pid}`, { record: false });
  await app.sync.trigger();
  assert.equal(fake.paths.has(`s_${pid}`), false);
  await admin.del(`/api/streams/${pid}`);

  // режим «по запросу»: камера с записью всё равно подключена постоянно
  await admin.put('/api/settings', { camerasAlwaysOn: false });
  await app.sync.trigger();
  assert.equal(fake.paths.get(`s_${id}`).sourceOnDemand, false, 'запись не работает в режиме по запросу');
  await admin.put('/api/settings', { camerasAlwaysOn: true });
  await app.sync.trigger();

  // промежутки записи
  fake.recordings.set(`s_${id}`, [{ start: '2026-10-18T10:00:00Z', duration: 600 }, { start: '2026-10-18T10:15:00Z', duration: 120.5 }]);
  r = await admin.get(`/api/archive/${id}/spans?start=2026-10-18T00:00:00Z&end=2026-10-19T00:00:00Z`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, [{ start: '2026-10-18T10:00:00Z', duration: 600 }, { start: '2026-10-18T10:15:00Z', duration: 120.5 }]);
  r = await admin.get(`/api/archive/${streamId}/spans?start=2026-10-18T00:00:00Z&end=2026-10-19T00:00:00Z`);
  assert.deepEqual(r.data, [], 'нет записей — пустой список');
  r = await admin.get(`/api/archive/${id}/spans?start=x&end=y`);
  assert.equal(r.status, 400);

  // видео: плеер (fMP4) и выгрузка (MP4)
  let v = await fetch(`${base}/archive/${id}/video?start=2026-10-18T10:05:00Z&duration=600`, { headers: { Cookie: admin.cookie } });
  assert.equal(v.status, 200);
  assert.equal(v.headers.get('content-type'), 'video/mp4');
  assert.equal(await v.text(), `ftypFAKE s_${id} 2026-10-18T10:05:00.000Z 600 fmp4`);
  v = await fetch(`${base}/archive/${id}/video?start=2026-10-18T10:05:00Z&duration=60&download=1`, { headers: { Cookie: admin.cookie } });
  assert.match(v.headers.get('content-disposition'), /attachment; filename=".*\.mp4"; filename\*=UTF-8''%D0%90%D1%80%D1%85/);
  assert.match(await v.text(), / mp4$/);
  v = await fetch(`${base}/archive/${id}/video?start=2026-10-18T10:05:00Z&duration=60`);
  assert.equal(v.status, 401);
  v = await fetch(`${base}/archive/${id}/video?start=2026-10-18T10:05:00Z&duration=99999`, { headers: { Cookie: admin.cookie } });
  assert.equal(v.status, 400);
  v = await fetch(`${base}/archive/${streamId}/video?start=2026-10-18T10:05:00Z&duration=60`, { headers: { Cookie: admin.cookie } });
  assert.equal(v.status, 404);
  r = await admin.get('/api/logs?category=access&limit=50');
  const logs = (r.data.items || r.data.logs || r.data).map((e) => e.message).join('\n');
  assert.match(logs, /Выгрузка из архива «Архивная»/);
  assert.match(logs, /Просмотр архива «Архивная»/);

  // наблюдателю архив недоступен
  await admin.post('/api/users', { login: 'viewer-arch', password: 'viewer-pass', role: 'viewer' });
  const viewer = new Client('10.0.0.31');
  await viewer.post('/api/auth/login', { login: 'viewer-arch', password: 'viewer-pass' });
  r = await viewer.get(`/api/archive/${id}/spans?start=2026-10-18T00:00:00Z&end=2026-10-19T00:00:00Z`);
  assert.equal(r.status, 403);
  v = await fetch(`${base}/archive/${id}/video?start=2026-10-18T10:05:00Z&duration=60`, { headers: { Cookie: viewer.cookie, 'X-Forwarded-For': '10.0.0.31' } });
  assert.equal(v.status, 403);

  // закладки
  await admin.post('/api/users', { login: 'oper-arch', password: 'oper-pass1', role: 'operator' });
  const op = new Client('10.0.0.32');
  await op.post('/api/auth/login', { login: 'oper-arch', password: 'oper-pass1' });
  r = await op.post('/api/bookmarks', { streamId: id, ts: '2026-10-18T10:07:30Z', note: 'Машина у ворот' });
  assert.equal(r.status, 200);
  const bm = r.data;
  assert.equal(bm.canDelete, true);
  r = await admin.post('/api/bookmarks', { streamId: id, ts: '2026-10-18T10:16:00Z', note: 'Смена караула' });
  const bm2 = r.data;
  r = await op.get(`/api/bookmarks?streamId=${id}&q=машина`);
  assert.deepEqual(r.data.map((b) => b.id), [bm.id]);
  r = await op.get(`/api/bookmarks?from=2026-10-18T10:00:00Z&to=2026-10-18T11:00:00Z`);
  assert.equal(r.data.length, 2);
  r = await op.del(`/api/bookmarks/${bm2.id}`);
  assert.equal(r.status, 403, 'чужую закладку оператор не удаляет');
  r = await op.del(`/api/bookmarks/${bm.id}`);
  assert.equal(r.status, 204);

  // сводка архива
  fs.mkdirSync(path.join(dir, `s_${id}`), { recursive: true });
  fs.writeFileSync(path.join(dir, `s_${id}`, '2026-10-18_10-00-00-000000.mp4'), Buffer.alloc(2048));
  r = await admin.get('/api/archive');
  assert.equal(r.status, 200);
  const st = r.data.streams.find((s) => s.id === id);
  assert.equal(st.bytes, 2048);
  assert.equal(r.data.days, 3);
  assert.equal(r.data.disk.free, free);

  // отключённый поток с записями: архивный путь без источника
  await admin.put(`/api/streams/${id}`, { isActive: false });
  await app.sync.trigger();
  conf = fake.paths.get(`s_${id}`);
  assert.equal(conf.source, 'publisher');
  assert.equal(conf.record, false);
  r = await admin.get(`/api/archive/${id}/spans?start=2026-10-18T00:00:00Z&end=2026-10-19T00:00:00Z`);
  assert.equal(r.data.length, 2, 'архив отключённого потока виден');
  assert.equal((await admin.get('/api/streams')).data.find((s) => s.id === id).status, 'offline');

  // удаление потока удаляет архив и закладки
  await admin.del(`/api/streams/${id}`);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(fs.existsSync(path.join(dir, `s_${id}`)), false);
  await app.sync.trigger();
  assert.equal(fake.paths.has(`s_${id}`), false);
  await admin.put('/api/settings', { archiveDays: 14 });
  app.sync.archiveDir = '';
});

test('архив: при нехватке места удаляются самые старые записи, идущая запись не трогается', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtspatom-arch-'));
  const mk = (stream, name, size, ageMin) => {
    fs.mkdirSync(path.join(dir, `s_${stream}`), { recursive: true });
    const f = path.join(dir, `s_${stream}`, name);
    fs.writeFileSync(f, Buffer.alloc(size));
    const t = new Date(Date.now() - ageMin * 60_000);
    fs.utimesSync(f, t, t);
    return f;
  };
  const GB = 1024 ** 3;
  const a1 = mk('a', '2026-10-01_10-00-00-000000.mp4', 1000, 600);
  const b1 = mk('b', '2026-10-01_11-00-00-000000.mp4', 1000, 500);
  const a2 = mk('a', '2026-10-02_10-00-00-000000.mp4', 1000, 400);
  const live = mk('b', '2026-10-01_09-00-00-000000.mp4', 1000, 0); // старое имя, но файл пишется сейчас
  let free = 20 * GB - 1500; // не хватает 1 ГБ запаса + 1500 байт
  const warns = [];
  const m = new ArchiveManager({
    dir, log: { warn: (c, msg) => warns.push(msg), error: () => {} },
    settings: () => ({ archiveMinFreeGb: 20 }),
    statfs: async () => ({ bavail: free, bsize: 1, blocks: 100 * GB }),
  });
  assert.equal(segmentStart('2026-10-01_10-00-00-000000.mp4'), new Date(2026, 9, 1, 10).getTime());
  assert.equal(segmentStart('notes.txt'), null);
  // нужно освободить 1 ГБ + 1500 байт — удалятся все старые, кроме идущей записи
  const removed = await m.guard();
  assert.equal(removed, 3);
  assert.equal(fs.existsSync(a1) || fs.existsSync(b1) || fs.existsSync(a2), false);
  assert.equal(fs.existsSync(live), true, 'файл, который пишется, не удалён');
  assert.match(warns[0], /мало места/);
  // места хватает — ничего не удаляется
  free = 100 * GB;
  mk('a', '2026-10-03_10-00-00-000000.mp4', 1000, 300);
  assert.equal(await m.guard(), 0);
  const st = await m.refresh();
  assert.equal(st.streams.a.files, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('папка архива: проверка, список дисков, смена с переносом, удалением и без переноса', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtspatom-dir-'));
  const A = path.join(root, 'a');
  fs.mkdirSync(A);
  app.config.dataDir = path.join(root, 'data');
  fs.mkdirSync(app.config.dataDir);
  app.sync.archiveDir = A;
  app.archive = new ArchiveManager({ dir: A, log: app.log, settings: () => getSettings(app.db), quietMs: 300 });
  let r = await admin.post('/api/streams', { name: 'Перенос', url: 'rtsp://10.9.9.8/main' });
  const id = r.data.id;
  await app.sync.trigger();
  assert.equal(fake.paths.get(`s_${id}`).recordPath, `${A}/%path/%Y-%m-%d_%H-%M-%S-%f`);
  const seg = (dir, name, size, ageMin) => {
    fs.mkdirSync(path.join(dir, `s_${id}`), { recursive: true });
    const f = path.join(dir, `s_${id}`, name);
    fs.writeFileSync(f, Buffer.alloc(size, 7));
    const t = new Date(Date.now() - ageMin * 60_000);
    fs.utimesSync(f, t, t);
    return f;
  };
  seg(A, '2026-10-19_10-00-00-000000.mp4', 3000, 120);
  seg(A, '2026-10-19_10-10-00-000000.mp4', 2000, 110);
  seg(A, '2026-10-19_10-20-00-000000.mp4', 1000, 0); // только что дописан — переносится после паузы

  // проверка папки
  const check = async (p) => (await admin.post('/api/archive/check-dir', { path: p })).data;
  assert.match((await check('archive')).problem, /полный путь/);
  assert.match((await check('/usr/local/archive')).problem, /системный каталог/);
  assert.match((await check('/proc/archive')).problem, /служебная/);
  assert.match((await check('/')).problem, /Корень/);
  assert.match((await check(`${root}/a%b`)).problem, /%/);
  assert.match((await check(app.config.dataDir)).problem, /база и настройки/);
  assert.match((await check(root)).problem, /база и настройки/, 'папка, внутри которой лежит база, тоже не подходит');
  fs.writeFileSync(path.join(root, 'file'), 'x');
  assert.match((await check(path.join(root, 'file', 'sub'))).problem, /файл, а не папка/);
  assert.match((await check(path.join(A, `s_${id}`))).problem, /записей одной из камер/);
  const B = path.join(root, 'b', 'archive');
  let c = await check(`  "${B}/"  `);
  assert.equal(c.ok, true);
  assert.equal(c.path, B);
  assert.equal(c.exists, false, 'проверка ничего не создаёт');
  assert.equal(fs.existsSync(path.join(root, 'b')), false);
  assert.equal(c.sameFs, true);
  assert.ok(c.free > 0 && c.size > 0);
  assert.equal((await check(A)).current, true);
  r = await remoteAdmin.post('/api/archive/check-dir', { path: B });
  assert.equal(r.status, 200, 'администратору с другого адреса тоже можно');
  const viewer = new Client('10.0.0.41');
  await admin.post('/api/users', { login: 'dirviewer', password: 'viewer-pass', role: 'operator' });
  await viewer.post('/api/auth/login', { login: 'dirviewer', password: 'viewer-pass' });
  assert.equal((await viewer.post('/api/archive/check-dir', { path: B })).status, 403);
  assert.equal((await viewer.put('/api/archive/dir', { path: B, records: 'move' })).status, 403);
  assert.equal((await viewer.get('/api/archive')).data.dir, undefined, 'папку видит только администратор');

  r = await admin.get('/api/archive/disks');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data));
  if (process.platform === 'linux') assert.ok(r.data.some((d) => d.mount === '/'), 'системный диск в списке');

  // смена с переносом
  r = await admin.put('/api/archive/dir', { path: B, records: 'bad' });
  assert.equal(r.status, 400);
  r = await admin.put('/api/archive/dir', { path: A, records: 'move' });
  assert.match(r.data.error, /текущая папка/);
  r = await admin.put('/api/archive/dir', { path: B, records: 'move' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.files, 3);
  assert.equal(r.data.bytes, 6000);
  assert.equal(app.archive.dir, B);
  assert.equal(getValue(app.db, 'archiveDir'), B);
  assert.equal(fake.paths.get(`s_${id}`).recordPath, `${B}/%path/%Y-%m-%d_%H-%M-%S-%f`, 'MediaMTX пишет в новую папку');
  r = await admin.get('/api/archive');
  assert.equal(r.data.dir, B);
  assert.equal(r.data.relocation.state, 'running');
  assert.deepEqual(getValue(app.db, 'archiveMove'), { from: A, mode: 'move' });
  r = await admin.put('/api/archive/dir', { path: path.join(root, 'c'), records: 'move' });
  assert.equal(r.status, 409, 'пока идёт перенос, папку не меняем');
  await app.archive.relocation.promise;
  r = await admin.get('/api/archive');
  assert.equal(r.data.relocation.state, 'done');
  assert.equal(r.data.relocation.filesDone, 3);
  assert.equal(r.data.relocation.bytesDone, 6000);
  assert.equal(r.data.relocation.promise, undefined);
  assert.equal(fs.readdirSync(path.join(B, `s_${id}`)).length, 3);
  assert.equal(fs.existsSync(path.join(A, `s_${id}`)), false, 'пустой каталог камеры убран');
  assert.equal(fs.existsSync(A), true, 'сама прежняя папка остаётся (может быть точкой монтирования)');
  assert.equal(getValue(app.db, 'archiveMove'), undefined);
  r = await admin.get(`/api/logs?category=admin&q=${encodeURIComponent('Папка архива изменена')}`);
  assert.equal(r.data.items.length, 1);

  // смена с удалением старых записей
  const C = path.join(root, 'c');
  r = await admin.put('/api/archive/dir', { path: C, records: 'delete' });
  assert.equal(r.status, 200);
  await app.archive.relocation.promise;
  assert.equal(app.archive.relocation.mode, 'delete');
  assert.equal(fs.existsSync(path.join(B, `s_${id}`)), false);
  assert.equal(fs.existsSync(path.join(C, `s_${id}`)), false, 'в новую папку ничего не переносилось');

  // без переноса: записи остаются, предупреждение в журнале
  seg(C, '2026-10-19_11-00-00-000000.mp4', 500, 60);
  const D = path.join(root, 'd');
  r = await admin.put('/api/archive/dir', { path: D, records: 'keep' });
  assert.equal(r.status, 200);
  assert.equal(app.archive.relocation.state, 'done', 'нового переноса нет');
  assert.equal(fs.existsSync(path.join(C, `s_${id}`, '2026-10-19_11-00-00-000000.mp4')), true);
  r = await admin.get(`/api/logs?q=${encodeURIComponent('остались записи')}`);
  assert.equal(r.data.items.length, 1);

  // прерванный остановкой перенос продолжается после запуска
  setValue(app.db, 'archiveMove', { from: C, mode: 'move' });
  app.archive.stopping = true;
  await startRelocation(app, C, 'move');
  assert.equal(app.archive.relocation.interrupted, true);
  assert.deepEqual(getValue(app.db, 'archiveMove'), { from: C, mode: 'move' }, 'задание сохранено');
  app.archive.stopping = false;
  await startRelocation(app, C, 'move');
  assert.equal(app.archive.relocation.state, 'done');
  assert.equal(fs.existsSync(path.join(D, `s_${id}`, '2026-10-19_11-00-00-000000.mp4')), true);
  assert.equal(getValue(app.db, 'archiveMove'), undefined);

  // недоступная для записи папка: понятная ошибка и команды для исправления (root права не проверяет)
  if (process.getuid && process.getuid() !== 0) {
    const ro = path.join(root, 'ro');
    fs.mkdirSync(ro, { mode: 0o555 });
    c = await check(path.join(ro, 'archive'));
    assert.equal(c.ok, false);
    assert.match(c.fix, /sudo mkdir -p .*\nsudo chown /);
    r = await admin.put('/api/archive/dir', { path: path.join(ro, 'archive'), records: 'keep' });
    assert.equal(r.status, 400);
    assert.match(r.data.fix, /sudo chown/);
    fs.chmodSync(ro, 0o755);
  }

  await admin.del(`/api/streams/${id}`);
  setValue(app.db, 'archiveDir', null);
  setValue(app.db, 'archiveMount', null);
  app.archive = undefined;
  app.sync.archiveDir = '';
  delete app.config.dataDir;
  fs.rmSync(root, { recursive: true, force: true });
});

test('папка архива: правила путей, точки монтирования, перенос между дисками', async () => {
  assert.match(normalizeDir('').problem, /Укажите/);
  if (process.platform !== 'win32') {
    assert.equal(normalizeDir('/srv/archive/../video/').dir, '/srv/video');
    assert.match(forbiddenReason('/home/user/archive', { sandboxed: true }), /ProtectHome/);
    assert.match(forbiddenReason('/tmp/archive', { sandboxed: true }), /временные/);
    assert.equal(forbiddenReason('/tmp/archive', { sandboxed: false }), null, 'вне службы /tmp допустим (тесты, разработка)');
    assert.match(forbiddenReason('/etc/rtspatom/archive', { sandboxed: false }), /системный/);
    assert.equal(forbiddenReason('/srv/archive', { sandboxed: true }), null);
    assert.equal(forbiddenReason('/var/lib/rtspatom/archive', { sandboxed: true, dataDir: '/var/lib/rtspatom' }), null);
    assert.match(forbiddenReason('/var/lib', { sandboxed: true, dataDir: '/var/lib/rtspatom' }), /база/);
  }
  const mounts = mountPoints('/dev/vda1 / ext4 rw 0 0\n/dev/sdb1 /srv/arch\\040ive ext4 rw 0 0\ntmpfs /run tmpfs rw 0 0\n');
  assert.equal(mounts[1].mount, '/srv/arch ive');
  assert.equal(mountOf('/srv/arch ive/s_1', mounts).device, '/dev/sdb1');
  assert.equal(mountOf('/srv/archive2', mounts).mount, '/', 'похожее имя — не та точка монтирования');

  // диск архива не подключён — предупреждение
  const errors = [];
  const m = new ArchiveManager({ dir: '/srv/arch ive', log: { error: (c, msg) => errors.push(msg), info: () => {} }, settings: () => ({}) });
  m.expectedMount = '/srv/arch ive';
  assert.equal(m.checkMount(mounts), '');
  assert.match(m.checkMount(mountPoints('/dev/vda1 / ext4 rw 0 0\n')), /не подключён/);
  assert.equal(errors.length, 1);
  m.checkMount(mountPoints('/dev/vda1 / ext4 rw 0 0\n'));
  assert.equal(errors.length, 1, 'не чаще раза в час');

  // перенос на другой диск: копирование через .part с сохранением времени файла
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'rtspatom-mv-'));
  const src = path.join(a, 'x.mp4');
  fs.writeFileSync(src, Buffer.alloc(4096, 1));
  const t = new Date(Date.now() - 3600_000);
  fs.utimesSync(src, t, t);
  let otherDisk = null;
  try {
    if (fs.statSync('/dev/shm').dev !== fs.statSync(a).dev) otherDisk = fs.mkdtempSync('/dev/shm/rtspatom-mv-');
  } catch { /* нет /dev/shm */ }
  const dstDir = otherDisk || path.join(a, 'same');
  const dst = path.join(dstDir, 's_1', 'x.mp4');
  assert.equal(await moveFile(src, dst), otherDisk ? 'copied' : 'renamed');
  assert.equal(fs.existsSync(src), false);
  assert.equal(fs.statSync(dst).size, 4096);
  assert.ok(Math.abs(fs.statSync(dst).mtimeMs - t.getTime()) < 2000, 'время файла сохранено');
  assert.equal(fs.readdirSync(path.dirname(dst)).some((f) => f.endsWith('.part')), false);
  // такой же файл уже есть — дубль удаляется; другой — ошибка, исходный цел
  fs.writeFileSync(src, Buffer.alloc(4096, 1));
  assert.equal(await moveFile(src, dst), 'duplicate');
  fs.writeFileSync(src, Buffer.alloc(10, 1));
  await assert.rejects(moveFile(src, dst), /другой файл/);
  assert.equal(fs.existsSync(src), true);
  fs.rmSync(a, { recursive: true, force: true });
  if (otherDisk) fs.rmSync(otherDisk, { recursive: true, force: true });
});

test('удаление потока удаляет путь MediaMTX', async () => {
  let r = await admin.del(`/api/streams/${streamId}`);
  assert.equal(r.status, 204);
  await app.sync.trigger();
  assert.equal(fake.paths.has(`s_${streamId}`), false);
  r = await admin.get(`/hls/${streamId}/index.m3u8`);
  assert.equal(r.status, 404);
});

test('обрыв связи браузера записывается в журнал (не чаще раза в 10 с на сеанс)', async () => {
  let r = await admin.post('/api/client-event', { kind: 'connection-lost', since: new Date(Date.now() - 12000).toISOString(), downMs: 12000 });
  assert.equal(r.status, 200);
  r = await admin.post('/api/client-event', { kind: 'connection-lost', since: new Date().toISOString(), downMs: 5000 });
  assert.equal(r.status, 200);
  r = await admin.get('/api/logs?category=error&limit=20');
  const msgs = (r.data.items || r.data.logs || r.data).map((e) => e.message).filter((m) => /терял связь/.test(m));
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /на 12 с/);
  r = await admin.post('/api/client-event', { kind: 'x' });
  assert.equal(r.status, 400);
  r = await new Client('10.0.0.99').post('/api/client-event', { kind: 'connection-lost', since: new Date().toISOString(), downMs: 1 });
  assert.equal(r.status, 401);
});

test('адрес клиента: X-Forwarded-For только от 127.0.0.1 и последний адрес цепочки', () => {
  const prev = app.config.trustProxy;
  app.config.trustProxy = 'loopback';
  const req = (sock, xff) => ({ socket: { remoteAddress: sock }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(app.clientIp(req('127.0.0.1', '203.0.113.7')), '203.0.113.7', 'туннель: настоящий адрес гостя');
  assert.equal(app.clientIp(req('127.0.0.1', '127.0.0.1, 203.0.113.7')), '203.0.113.7', 'подделанный первый адрес не учитывается');
  assert.equal(app.clientIp(req('192.168.0.50', '127.0.0.1')), '192.168.0.50', 'из локальной сети заголовку не верим');
  assert.equal(app.clientIp(req('::ffff:127.0.0.1')), '127.0.0.1');
  app.config.trustProxy = false;
  assert.equal(app.clientIp(req('127.0.0.1', '203.0.113.7')), '127.0.0.1');
  app.config.trustProxy = prev;
});

test('раскладки стены: сохранение, перезапись, переименование', async () => {
  let r = await admin.post('/api/wall/configs', { name: 'Пост 1', layout: '2x2', cells: [{ streamId: 'a' }, { streamId: 'b' }] });
  assert.equal(r.status, 200);
  const id = r.data.find((c) => c.name === 'Пост 1').id;
  r = await admin.put(`/api/wall/configs/${id}`, { layout: '3x3', cells: [{ streamId: 'c' }, null, { streamId: 'a' }] });
  assert.equal(r.status, 200);
  let c = r.data.find((x) => x.id === id);
  assert.equal(c.name, 'Пост 1', 'название сохраняется');
  assert.equal(c.layout, '3x3');
  assert.deepEqual(c.cells.map((x) => x.streamId), ['c', null, 'a']);
  r = await admin.put(`/api/wall/configs/${id}`, { name: 'Пост 1 (ночь)' });
  c = r.data.find((x) => x.id === id);
  assert.equal(c.name, 'Пост 1 (ночь)');
  assert.equal(c.layout, '3x3', 'без layout раскладка не меняется');
  assert.equal(r.data.length, 1, 'двойник не создан');
  assert.equal((await admin.put(`/api/wall/configs/${id}`, { layout: '5x5' })).status, 400);
  assert.equal((await admin.put('/api/wall/configs/nope', { layout: '2x2' })).status, 404);
  await admin.del(`/api/wall/configs/${id}`);
});

test('состояние системы: нагрузка, потоки, проверки', async () => {
  const { Monitor } = await import('../lib/monitor.js');
  app.monitor = new Monitor({ app });
  app.monitor.sample();
  await new Promise((r) => setTimeout(r, 150));
  app.monitor.sample();
  const r = await admin.get('/api/monitor');
  assert.equal(r.status, 200);
  assert.ok(r.data.cores >= 1);
  assert.ok(Array.isArray(r.data.history) && r.data.history.length >= 1);
  assert.ok(Array.isArray(r.data.streams));
  assert.ok(Array.isArray(r.data.checks));
  assert.ok(r.data.checks.every((c) => ['error', 'warn', 'info'].includes(c.level) && c.title));
  // два потока с одного энкодера — предупреждение
  await admin.post('/api/streams', { name: 'Энк А', url: 'rtsp://10.1.1.1:8554/10' });
  await admin.post('/api/streams', { name: 'Энк Б', url: 'rtsp://10.1.1.1:8554/11' });
  app.monitor.sample();
  const c = (await admin.get('/api/monitor')).data.checks;
  assert.ok(c.some((x) => /С одного энкодера 10\.1\.1\.1/.test(x.title)), JSON.stringify(c.map((x) => x.title)));
  // общие настройки энкодеров и включение автоподстройки для всех
  let d = await admin.put('/api/encoders/defaults', { login: 'admin', password: 'p1', minKbps: 500, maxKbps: 1500 });
  assert.equal(d.data.hasPassword, true);
  assert.equal(d.data.password, undefined, 'пароль не отдаётся');
  d = await admin.post('/api/encoders/auto', { auto: true });
  assert.ok(d.data.count >= 2);
  const st = (await admin.get('/api/streams')).data.find((x) => x.name === 'Энк А');
  assert.equal(st.encoder.auto, true);
  assert.equal(st.encoder.minKbps, 500);
  assert.equal(st.encoder.hasPassword, true);
  await admin.post('/api/encoders/auto', { auto: false });
  for (const s of (await admin.get('/api/streams')).data.filter((x) => x.name.startsWith('Энк '))) await admin.del(`/api/streams/${s.id}`);
  app.monitor = undefined;
});

test('выход завершает сессию', async () => {
  let r = await admin.post('/api/auth/logout');
  assert.equal(r.status, 200);
  r = await admin.get('/api/auth/me');
  assert.equal(r.status, 401);
});
