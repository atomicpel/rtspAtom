// Настройка RTSP Atom при установке на Windows (вызывается из install.ps1).
// Создаёт/обновляет config.json, общий секрет панели и MediaMTX, файл mediamtx.yml.
// Всё пишется в UTF-8 без BOM: Блокнот и PowerShell 5.1 по умолчанию добавляют BOM,
// который ломает JSON и YAML.
//
//   node configure.mjs --config <config.json> --template <mediamtx.yml> --yml <mediamtx.yml>
//                     --data <каталог данных> --public <каталог фронтенда>
//                     [--port N] [--tls-pfx <файл> --tls-pass <пароль>]
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
if (!cfg.mediamtx.cdnSecret) cfg.mediamtx.cdnSecret = crypto.randomBytes(24).toString('hex');
write(args.config, JSON.stringify(cfg, null, 2) + '\n');

const rendered = readText(args.template).replace('@CDN_SECRET@', cfg.mediamtx.cdnSecret).replace(/\r?\n/g, '\r\n');
let ymlNew = false;
if (!fs.existsSync(args.yml)) {
  write(args.yml, rendered);
} else {
  let current = readText(args.yml);
  if (!/^hlsCDNSecret:/m.test(current)) {
    current += `\r\n# Добавлено установщиком RTSP Atom\r\nhlsCDNSecret: "${cfg.mediamtx.cdnSecret}"\r\n`;
    write(args.yml, current);
  }
  if (current.replace(/\r\n/g, '\n') !== rendered.replace(/\r\n/g, '\n')) {
    write(args.yml + '.new', rendered);
    ymlNew = true;
  }
}

fs.mkdirSync(path.join(args.data), { recursive: true });
console.log(JSON.stringify({ port: cfg.port, tls: !!cfg.tls.enabled, ymlNew }));
