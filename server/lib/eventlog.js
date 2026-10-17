import os from 'node:os';
import { getSettings } from './settings.js';

const SYSLOG_SEVERITY = { error: 3, warning: 4, info: 6, debug: 7 };

/**
 * Журнал событий: запись в SQLite + дублирование в stdout (попадает в journald)
 * в выбранном формате — JSON или syslog (RFC 5424).
 */
export class EventLog {
  constructor(db, { quiet = false } = {}) {
    this.db = db;
    this.quiet = quiet;
    this.insert = db.prepare(
      'INSERT INTO logs (ts, level, category, user, ip, stream, message) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
  }

  write(level, category, message, { user = 'system', ip = '', stream = '' } = {}) {
    const ts = new Date().toISOString();
    try {
      this.insert.run(ts, level, category, user || '', ip || '', stream || '', String(message));
    } catch (err) {
      console.error('Ошибка записи журнала:', err.message);
    }
    if (this.quiet) return;
    let format = 'json';
    try {
      format = getSettings(this.db).logFormat;
    } catch {
      /* настройки недоступны — используем JSON */
    }
    if (format === 'syslog') {
      const pri = 8 + (SYSLOG_SEVERITY[level] ?? 6); // facility user(1)
      const sd = `[rtspatom category="${category}" user="${esc(user)}" ip="${esc(ip)}" stream="${esc(stream)}"]`;
      console.log(`<${pri}>1 ${ts} ${os.hostname()} rtspatom ${process.pid} - ${sd} ${message}`);
    } else {
      console.log(JSON.stringify({ ts, level, category, user, ip, stream, message }));
    }
  }

  info(category, message, meta) { this.write('info', category, message, meta); }
  warn(category, message, meta) { this.write('warning', category, message, meta); }
  error(category, message, meta) { this.write('error', category, message, meta); }

  prune(retentionDays) {
    const cutoff = new Date(Date.now() - retentionDays * 86400 * 1000).toISOString();
    return this.db.prepare('DELETE FROM logs WHERE ts < ?').run(cutoff).changes;
  }
}

function esc(s) {
  return String(s ?? '').replace(/["\\\]]/g, (c) => '\\' + c);
}
