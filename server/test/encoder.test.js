import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb } from '../lib/db.js';
import { EncoderTuner, SET_KEYS, buildSetQuery, parseOutput, setBitrate, detectOutput } from '../lib/encoder.js';

// Имитация энкодера (веб-интерфейс прошивки 6.x): get_output / set_output с Basic-авторизацией
function fakeEncoder() {
  const outputs = {
    0: { venc_framerate: '25', venc_gop: '25', venc_width: '0', venc_height: '0', venc_rc_mode: '0', venc_bitrate: '1500',
      http_ts_uri: '/0.ts', http_flv_uri: '/0.flv', rtsp_uri: '/10', rtmp_enable: '0', rtmp_uri: '/0',
      rtmp_publish_uri: 'rtmp://11.196.22.19:1935/stream/stream3', rtmp_publish_enable: '0', http_ts_enable: '0',
      http_flv_enable: '0', rtsp_enable: '1', venc_profile: '0', http_hls_uri: '/0.m3u8', http_hls_enable: '0',
      multicast_ip: '238.0.0.1', multicast_port: '1234', multicast_enable: '0', venc_codec: '96', venc_width_height_same_as_input: '1' },
  };
  outputs[1] = { ...outputs[0], rtsp_uri: '/11', venc_bitrate: '800', http_hls_uri: '/1.m3u8' };
  const sets = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.headers.authorization !== `Basic ${Buffer.from('admin:secret').toString('base64')}`) { res.writeHead(401); return res.end(); }
    const o = outputs[u.searchParams.get('output')];
    if (u.pathname === '/get_output') {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      return res.end(`<?xml version="1.0" encoding="utf-8"?><output>${Object.entries(o).map(([k, v]) => `<${k}>${v.replace(/&/g, '&amp;')}</${k}>`).join('')}</output>`);
    }
    if (u.pathname === '/set_output') {
      sets.push(Object.fromEntries(u.searchParams));
      for (const k of SET_KEYS) o[k] = u.searchParams.get(k);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }
    res.writeHead(404); res.end();
  });
  return { outputs, sets, server, listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`127.0.0.1:${server.address().port}`))) };
}

test('энкодер: разбор ответа, запрос со всеми полями, отказ при неполных данных', () => {
  const f = parseOutput('<?xml version="1.0"?><output><venc_bitrate>1500</venc_bitrate><rtmp_publish_uri>rtmp://a/b?x=1&amp;y=2</rtmp_publish_uri></output>');
  assert.equal(f.venc_bitrate, '1500');
  assert.equal(f.rtmp_publish_uri, 'rtmp://a/b?x=1&y=2');
  assert.equal(parseOutput('<o venc_bitrate="900" venc_gop="25"/>').venc_gop, '25');
  assert.throws(() => buildSetQuery(0, 0, { venc_bitrate: '1500' }, { venc_bitrate: 1000 }), /не сообщил поля/);
  const cur = Object.fromEntries(SET_KEYS.map((k) => [k, 'v']));
  cur.rtmp_publish_uri = 'rtmp://11.196.22.19:1935/stream/stream3';
  cur.http_ts_uri = '/0.ts';
  const q = buildSetQuery(0, 1, cur, { venc_bitrate: 1200 });
  assert.match(q, /^input=0&output=1&venc_framerate=v&/);
  assert.match(q, /venc_bitrate=1200&/);
  assert.match(q, /http_ts_uri=\/0\.ts&/, 'пути — как у страницы энкодера');
  assert.match(q, /rtmp_publish_uri=rtmp%3A%2F%2F11\.196\.22\.19%3A1935%2Fstream%2Fstream3&/);
});

test('энкодер: выход по rtsp_uri, смена битрейта не трогает остальные поля', async () => {
  const fe = fakeEncoder();
  const host = await fe.listen();
  const e = { host, login: 'admin', password: 'secret' };
  const d = await detectOutput(e, 'rtsp://11.196.27.131:8554/11');
  assert.equal(d.output, 1);
  assert.equal(d.matched, true);
  const before = { ...fe.outputs[1] };
  assert.equal(await setBitrate(e, 1, 600), 600);
  assert.equal(fe.sets.length, 1);
  for (const k of SET_KEYS) if (k !== 'venc_bitrate') assert.equal(fe.outputs[1][k], before[k], `поле ${k} не должно меняться`);
  assert.equal(fe.outputs[0].venc_bitrate, '1500', 'другой выход не тронут');
  await assert.rejects(detectOutput({ ...e, password: 'bad' }, 'rtsp://x/10'), /неверный логин или пароль/);
  fe.server.close();
});

test('автоподстройка: снижает при потерях, поднимает после тишины, помнит потолок', async () => {
  const fe = fakeEncoder();
  const host = await fe.listen();
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO streams (id, name, url, protocol, is_active, sort, created_at, encoder) VALUES ('a', 'Север-радар', ?, 'rtsp', 1, 1, '', ?)`)
    .run('rtsp://11.196.27.139:8554/10', JSON.stringify({ enabled: true, auto: true, host, login: 'admin', password: 'secret', minKbps: 600, maxKbps: 2000 }));
  const logs = [];
  let now = 1_000_000;
  const t = new EncoderTuner({ db, log: { info: (c, m) => logs.push(m), warn: (c, m) => logs.push(`WARN ${m}`) }, client: null, now: () => now });
  const row = db.prepare('SELECT * FROM streams').get();
  let err = 0;
  const step = async (addErr, ms = 30_000) => { now += ms; err += addErr; await t.tickOne(row, { inboundFramesInError: err }); };

  await step(0); // первый замер: узнаёт текущий битрейт 1500
  assert.equal(t.info('a').currentKbps, 1500);
  await step(10); // плохо, но одного замера мало
  assert.equal(fe.outputs[0].venc_bitrate, '1500');
  await step(10); // второй подряд — снижаем на 20 %
  assert.equal(fe.outputs[0].venc_bitrate, '1200');
  assert.match(logs.at(-1), /испорченных кадров 10 за 30 с — битрейт 1500 → 1200/);
  await step(10); await step(10); // сразу после изменения — пауза 3 минуты
  assert.equal(fe.outputs[0].venc_bitrate, '1200');
  for (let i = 0; i < 6; i++) await step(10); // потери продолжаются — ещё ниже
  assert.equal(fe.outputs[0].venc_bitrate, '950');
  for (let i = 0; i < 41; i++) await step(0); // 20 минут чисто — поднимаем на 15 %
  assert.equal(fe.outputs[0].venc_bitrate, '1100');
  assert.match(logs.at(-1), /потерь нет 20 минут — битрейт 950 → 1100/);
  for (let i = 0; i < 8; i++) await step(10); // подъём не потянул — назад и потолок 950
  assert.equal(fe.outputs[0].venc_bitrate, '900');
  assert.equal(t.info('a').ceilingKbps, 950);
  for (let i = 0; i < 90; i++) await step(0); // 45 минут чисто — не выше потолка
  assert.equal(fe.outputs[0].venc_bitrate, '950');
  // ниже минимума не опускается
  for (let i = 0; i < 200; i++) await step(10);
  assert.equal(fe.outputs[0].venc_bitrate, '600');
  assert.ok(fe.sets.every((s) => s.rtsp_uri === '/10' && s.venc_framerate === '25'), 'остальные поля всегда те же');
  fe.server.close();
});

test('энкодер: рекомендуемые настройки — GOP = частоте кадров, лишние выходы выключены, остальное не тронуто', async () => {
  const { applyRecommended } = await import('../lib/encoder.js');
  const fe = fakeEncoder();
  const host = await fe.listen();
  const e = { host, login: 'admin', password: 'secret' };
  Object.assign(fe.outputs[0], { venc_gop: '127', http_hls_enable: '1', rtmp_publish_enable: '1', venc_rc_mode: '1', venc_bitrate: '1000' });
  const r = await applyRecommended(e, 0);
  assert.deepEqual(Object.keys(r.changed).sort(), ['http_hls_enable', 'rtmp_publish_enable', 'venc_gop']);
  assert.equal(fe.outputs[0].venc_gop, '25');
  assert.equal(fe.outputs[0].http_hls_enable, '0');
  assert.equal(fe.outputs[0].venc_rc_mode, '1', 'режим кодирования не трогаем');
  assert.equal(fe.outputs[0].venc_bitrate, '1000');
  const again = await applyRecommended(e, 0);
  assert.deepEqual(again.changed, {}, 'повторно ничего не отправляется');
  assert.equal(fe.sets.length, 1);
  fe.server.close();
});

test('энкодер: общие логин, пароль и пределы подставляются, свои у потока важнее', async () => {
  const { encoderOf, setEncoderDefaults } = await import('../lib/encoder.js');
  setEncoderDefaults({ login: 'root', password: 'shared', minKbps: 500, maxKbps: 1500 });
  let e = encoderOf({ url: 'rtsp://11.196.27.139:8554/10', encoder: '{"auto":true}' });
  assert.deepEqual([e.host, e.login, e.password, e.minKbps, e.maxKbps], ['11.196.27.139', 'root', 'shared', 500, 1500]);
  e = encoderOf({ url: 'rtsp://x/10', encoder: '{"login":"op","password":"own","maxKbps":900}' });
  assert.deepEqual([e.login, e.password, e.minKbps, e.maxKbps], ['op', 'own', 500, 900]);
  setEncoderDefaults({});
});
