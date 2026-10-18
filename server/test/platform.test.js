import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseNetstatE } from '../lib/metrics.js';
import { loadConfig } from '../lib/config.js';

test('netstat -e: английская и русская Windows', () => {
  const en = `Interface Statistics\r\n\r\n                           Received            Sent\r\n\r\nBytes                    3995885574       382524620\r\nUnicast packets             5113164         2466614\r\n`;
  assert.deepEqual(parseNetstatE(en), { rx: 3995885574, tx: 382524620 });
  const ru = `Статистика интерфейса\r\n\r\n                            Получено      Отправлено\r\n\r\nБайт                         123456789        98765\r\nОдноадресные пакеты            1000           2000\r\n`;
  assert.deepEqual(parseNetstatE(ru), { rx: 123456789, tx: 98765 });
  assert.equal(parseNetstatE('мусор'), null);
});

test('config.json с BOM (Блокнот Windows) читается', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtspatom-cfg-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, '\uFEFF' + JSON.stringify({ port: 9123, tls: { enabled: false, pfx: 'C:\\x.pfx' } }));
  process.env.RTSPATOM_CONFIG = file;
  try {
    const cfg = loadConfig();
    assert.equal(cfg.port, 9123);
    assert.equal(cfg.tls.pfx, 'C:\\x.pfx');
    assert.equal(cfg.mediamtx.apiUrl, 'http://127.0.0.1:9997');
  } finally {
    delete process.env.RTSPATOM_CONFIG;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
