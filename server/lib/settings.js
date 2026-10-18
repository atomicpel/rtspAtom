import { parseJson } from './db.js';

export const SETTINGS_SCHEMA = {
  sessionTtl: { def: 3600, min: 300, max: 7 * 86400, int: true },
  maxConnections: { def: 100, min: 1, max: 1000, int: true },
  rateLimitLogin: { def: 5, min: 1, max: 50, int: true },
  rateLimitApi: { def: 600, min: 30, max: 6000, int: true },
  logRetentionDays: { def: 90, min: 1, max: 3650, int: true },
  logFormat: { def: 'json', values: ['json', 'syslog'] },
  camerasAlwaysOn: { def: true, bool: true },
  // Показ видео: WebRTC (минимальная задержка, с откатом на HLS) или только LL-HLS
  lowLatency: { def: true, bool: true },
};

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const stored = Object.fromEntries(rows.map((r) => [r.key, parseJson(r.value, undefined)]));
  const out = {};
  for (const [k, spec] of Object.entries(SETTINGS_SCHEMA)) {
    out[k] = stored[k] !== undefined ? stored[k] : spec.def;
  }
  return out;
}

export function validateSettings(input) {
  const clean = {};
  const errors = [];
  for (const [k, spec] of Object.entries(SETTINGS_SCHEMA)) {
    if (!(k in input)) continue;
    const v = input[k];
    if (spec.bool) {
      if (typeof v !== 'boolean') errors.push(`${k}: ожидается true/false`);
      else clean[k] = v;
    } else if (spec.values) {
      if (!spec.values.includes(v)) errors.push(`${k}: допустимо ${spec.values.join(', ')}`);
      else clean[k] = v;
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || (spec.int && !Number.isInteger(n)) || n < spec.min || n > spec.max) {
        errors.push(`${k}: число от ${spec.min} до ${spec.max}`);
      } else clean[k] = n;
    }
  }
  return { clean, errors };
}

export function saveSettings(db, values) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  for (const [k, v] of Object.entries(values)) stmt.run(k, JSON.stringify(v));
}
