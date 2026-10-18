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
    mediamtx: { apiUrl: fakeUrl, hlsUrl: fakeUrl, cdnSecret: 'test-cdn-secret' },
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

test('удаление потока удаляет путь MediaMTX', async () => {
  let r = await admin.del(`/api/streams/${streamId}`);
  assert.equal(r.status, 204);
  await app.sync.trigger();
  assert.equal(fake.paths.has(`s_${streamId}`), false);
  r = await admin.get(`/hls/${streamId}/index.m3u8`);
  assert.equal(r.status, 404);
});

test('выход завершает сессию', async () => {
  let r = await admin.post('/api/auth/logout');
  assert.equal(r.status, 200);
  r = await admin.get('/api/auth/me');
  assert.equal(r.status, 401);
});
