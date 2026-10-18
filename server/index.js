import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { loadConfig, IS_WINDOWS } from './lib/config.js';
import { openDb } from './lib/db.js';
import { EventLog } from './lib/eventlog.js';
import { getSettings } from './lib/settings.js';
import { MediaMtxClient, StreamSync } from './lib/mediamtx.js';
import { ArchiveManager } from './lib/archive.js';
import { createHandler } from './lib/app.js';
import { APP_VERSION } from './routes/system.js';

const config = loadConfig();
const db = openDb(path.join(config.dataDir, 'rtspatom.db'));
const log = new EventLog(db);
const client = new MediaMtxClient(config.mediamtx.apiUrl);
const settings = () => getSettings(db);
const sync = new StreamSync({ db, client, log, settings, archiveDir: config.archiveDir });
const archive = new ArchiveManager({ dir: config.archiveDir, log, settings });

const app = { db, config, log, sync, archive, startedAt: Date.now() };
const handler = createHandler(app);

let server;
if (config.tls?.enabled) {
  const tlsOpts = config.tls.pfx
    ? { pfx: fs.readFileSync(config.tls.pfx), passphrase: config.tls.passphrase || '' }
    : { cert: fs.readFileSync(config.tls.cert), key: fs.readFileSync(config.tls.key) };
  server = https.createServer(tlsOpts, handler);
} else {
  server = http.createServer(handler);
}
server.requestTimeout = 0; // LL-HLS использует долгие запросы плейлистов
server.headersTimeout = 30_000;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log.error('error', `Порт ${config.port} занят другой программой — панель не может запуститься. ` +
      'Освободите порт или запустите установщик ещё раз: он сам подберёт свободный порт.');
  } else {
    log.error('error', `Не удалось запустить сервер: ${err.message}`);
  }
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const proto = config.tls?.enabled ? 'https' : 'http';
  log.info('admin', `RTSP Atom ${APP_VERSION} запущен: ${proto}://${config.host}:${config.port}`);
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (users === 0) {
    console.log(IS_WINDOWS
      ? 'Пользователей нет. Создайте администратора: rtspatom-admin create-admin (командная строка от имени администратора)'
      : 'Пользователей нет. Создайте администратора: sudo rtspatom-admin create-admin');
  }
});

try {
  archive.start();
} catch (err) {
  log.error('error', `Каталог архива ${config.archiveDir} недоступен: ${err.message}`);
}
sync.start();

function housekeeping() {
  try {
    const removed = log.prune(getSettings(db).logRetentionDays);
    if (removed > 0) console.log(`Удалено старых записей журнала: ${removed}`);
    const now = new Date().toISOString();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    db.prepare('DELETE FROM login_attempts WHERE (blocked_until IS NULL OR blocked_until < ?) AND first_at < ?')
      .run(now, new Date(Date.now() - 86400_000).toISOString());
  } catch (err) {
    console.error('Ошибка обслуживания БД:', err.message);
  }
}
housekeeping();
setInterval(housekeeping, 6 * 3600 * 1000).unref();

function shutdown(signal) {
  log.info('admin', `Остановка сервера (${signal})`);
  sync.stop();
  archive.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// Windows: служба останавливается сигналом Ctrl+Break / закрытием консоли
process.on('SIGBREAK', () => shutdown('SIGBREAK'));
