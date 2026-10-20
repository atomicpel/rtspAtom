import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../lib/config.js';

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
