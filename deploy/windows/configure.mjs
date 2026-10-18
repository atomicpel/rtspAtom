// Настройка RTSP Atom при установке на Windows (вызывается из install.ps1).
// Создаёт/обновляет config.json, общий секрет панели и MediaMTX, файл mediamtx.yml.
// Всё пишется в UTF-8 без BOM: Блокнот и PowerShell 5.1 по умолчанию добавляют BOM,
// который ломает JSON и YAML.
//
//   node configure.mjs --config <config.json> --template <mediamtx.yml> --yml <mediamtx.yml>
//                     --data <каталог данных> --public <каталог фронтенда>
//                     [--port N] [--mtx-api-port N] [--mtx-hls-port N] [--mtx-whep-port N] [--ice-port N]
//                     [--rtmp-port N] [--srt-port N] [--playback-port N] [--rtsp-port N] [--archive-dir <каталог>]
//                     [--tls-pfx <файл> --tls-pass <пароль>]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
for (const k of ['config', 'template', 'yml', 'data', 'public']) {
  if (!args[k]) {
    console.error(`configure.mjs: не указан --${k}`);
    process.exit(2);
  }
}

const write = (file, text) => fs.writeFileSync(file, text, { encoding: 'utf8' });
const readText = (file) => fs.readFileSync(file, 'utf8').replace(/^﻿/, '');

let cfg = {};
if (fs.existsSync(args.config)) {
  cfg = JSON.parse(readText(args.config));
} else {
  cfg = {
    host: '0.0.0.0',
    port: 8080,
    trustProxy: false,
    tls: { enabled: false, pfx: '', passphrase: '' },
    mediamtx: { apiUrl: 'http://127.0.0.1:9997', hlsUrl: 'http://127.0.0.1:8888' },
  };
}
cfg.dataDir = args.data;
cfg.publicDir = args.public;
if (args.port) cfg.port = Number(args.port);
cfg.tls = cfg.tls || { enabled: false };
if (args['tls-pfx']) {
  cfg.tls.enabled = true;
  cfg.tls.pfx = args['tls-pfx'];
  if (args['tls-pass']) cfg.tls.passphrase = args['tls-pass'];
}
cfg.mediamtx = cfg.mediamtx || {};
cfg.mediamtx.apiUrl = cfg.mediamtx.apiUrl || 'http://127.0.0.1:9997';
cfg.mediamtx.hlsUrl = cfg.mediamtx.hlsUrl || 'http://127.0.0.1:8888';
if (args['mtx-api-port']) cfg.mediamtx.apiUrl = `http://127.0.0.1:${Number(args['mtx-api-port'])}`;
if (args['mtx-hls-port']) cfg.mediamtx.hlsUrl = `http://127.0.0.1:${Number(args['mtx-hls-port'])}`;
if (args['mtx-whep-port']) cfg.mediamtx.webrtcUrl = `http://127.0.0.1:${Number(args['mtx-whep-port'])}`;
cfg.mediamtx.webrtcUrl = cfg.mediamtx.webrtcUrl || 'http://127.0.0.1:8890';
if (args['ice-port']) cfg.mediamtx.icePort = Number(args['ice-port']);
cfg.mediamtx.icePort = cfg.mediamtx.icePort || 8189;
if (args['rtmp-port']) cfg.mediamtx.rtmpPort = Number(args['rtmp-port']);
cfg.mediamtx.rtmpPort = cfg.mediamtx.rtmpPort || 1935;
if (args['srt-port']) cfg.mediamtx.srtPort = Number(args['srt-port']);
cfg.mediamtx.srtPort = cfg.mediamtx.srtPort || 8890;
if (args['playback-port']) cfg.mediamtx.playbackUrl = `http://127.0.0.1:${Number(args['playback-port'])}`;
cfg.mediamtx.playbackUrl = cfg.mediamtx.playbackUrl || 'http://127.0.0.1:9996';
const playbackAddr = new URL(cfg.mediamtx.playbackUrl).host;
if (args['rtsp-port']) cfg.mediamtx.rtspUrl = `rtsp://127.0.0.1:${Number(args['rtsp-port'])}`;
cfg.mediamtx.rtspUrl = cfg.mediamtx.rtspUrl || 'rtsp://127.0.0.1:8554';
const rtspPort = Number(new URL(cfg.mediamtx.rtspUrl.replace(/^rtsp:/, 'http:')).port) || 8554;
if (args['archive-dir']) cfg.archiveDir = args['archive-dir'];
if (!cfg.archiveDir) cfg.archiveDir = path.join(args.data, 'archive');
const whepAddr = new URL(cfg.mediamtx.webrtcUrl).host;
const apiAddr = new URL(cfg.mediamtx.apiUrl).host;
const hlsAddr = new URL(cfg.mediamtx.hlsUrl).host;
if (!cfg.mediamtx.cdnSecret) cfg.mediamtx.cdnSecret = crypto.randomBytes(24).toString('hex');
write(args.config, JSON.stringify(cfg, null, 2) + '\n');

// Адреса API и HLS в mediamtx.yml должны совпадать с выбранными портами.
const setAddrs = (text) => text
  .replace(/^apiAddress:.*$/m, `apiAddress: ${apiAddr}`)
  .replace(/^hlsAddress:.*$/m, `hlsAddress: ${hlsAddr}`)
  .replace(/^webrtcAddress:.*$/m, `webrtcAddress: ${whepAddr}`)
  .replace(/^webrtcLocalUDPAddress:.*$/m, `webrtcLocalUDPAddress: :${cfg.mediamtx.icePort}`)
  .replace(/^webrtcLocalTCPAddress:.*$/m, `webrtcLocalTCPAddress: :${cfg.mediamtx.icePort}`)
  .replace(/^rtmpAddress:.*$/m, `rtmpAddress: :${cfg.mediamtx.rtmpPort}`)
  .replace(/^srtAddress:.*$/m, `srtAddress: :${cfg.mediamtx.srtPort}`)
  .replace(/^playbackAddress:.*$/m, `playbackAddress: ${playbackAddr}`)
  .replace(/^rtspAddress:.*$/m, `rtspAddress: 127.0.0.1:${rtspPort}`);
const rendered = setAddrs(readText(args.template).replace('@CDN_SECRET@', cfg.mediamtx.cdnSecret)).replace(/\r?\n/g, '\r\n');
let ymlNew = false;
if (!fs.existsSync(args.yml)) {
  write(args.yml, rendered);
} else if (!/^playbackAddress:/m.test(readText(args.yml))) {
  // Файл от версии без архива / WebRTC / приёма от энкодеров — заменяем новым, прежний сохраняем
  fs.copyFileSync(args.yml, args.yml + '.bak');
  write(args.yml, rendered);
} else {
  const original = readText(args.yml);
  let current = setAddrs(original);
  if (!/^hlsCDNSecret:/m.test(current)) {
    current += `\r\n# Добавлено установщиком RTSP Atom\r\nhlsCDNSecret: "${cfg.mediamtx.cdnSecret}"\r\n`;
  }
  if (current !== original) write(args.yml, current);
  if (current.replace(/\r\n/g, '\n') !== rendered.replace(/\r\n/g, '\n')) {
    write(args.yml + '.new', rendered);
    ymlNew = true;
  }
}

fs.mkdirSync(path.join(args.data), { recursive: true });
console.log(JSON.stringify({ port: cfg.port, icePort: cfg.mediamtx.icePort, rtmpPort: cfg.mediamtx.rtmpPort, srtPort: cfg.mediamtx.srtPort, archiveDir: cfg.archiveDir, apiAddr, hlsAddr, whepAddr, tls: !!cfg.tls.enabled, ymlNew }));
