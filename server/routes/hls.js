import http from 'node:http';
import { HttpError } from '../lib/http.js';
import { canAccessComputer } from '../lib/access.js';
import { getSettings } from '../lib/settings.js';
import { pathNameFor } from '../lib/mediamtx.js';

const VIEWER_ACTIVE_MS = 20_000;
const PASS_HEADERS = ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified', 'accept-ranges', 'content-range'];

/**
 * Прокси HLS: /hls/<streamId>/<файл> -> MediaMTX (127.0.0.1:8888)/s_<streamId>/<файл>.
 * Проверяет сессию и доступ пользователя к компьютеру, считает зрителей
 * и соблюдает лимит одновременных подключений.
 */
export async function handleHls(app, req, res, url, session, ip) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Метод не поддерживается');
  if (!session) throw new HttpError(401, 'Требуется вход в систему');

  const m = /^\/hls\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_.-]{1,128})$/.exec(url.pathname);
  if (!m) throw new HttpError(404, 'Не найдено');
  const [, streamId, file] = m;

  const row = app.db.prepare(
    `SELECT s.id, s.name, s.is_active, c.id AS computer_id, c.is_active AS computer_active
     FROM streams s JOIN computers c ON c.id = s.computer_id WHERE s.id = ?`,
  ).get(streamId);
  if (!row) throw new HttpError(404, 'Поток не найден');
  if (!canAccessComputer(session.user, row.computer_id)) throw new HttpError(403, 'Нет доступа к этому потоку');
  if (!row.is_active || !row.computer_active) throw new HttpError(409, 'Поток отключён');

  const key = `${session.tokenHash.slice(0, 16)}|${streamId}`;
  const now = Date.now();
  if (file.endsWith('.m3u8')) {
    const last = app.viewers.get(key);
    const isNew = !last || now - last > VIEWER_ACTIVE_MS;
    if (isNew) {
      let active = 0;
      for (const t of app.viewers.values()) if (now - t < VIEWER_ACTIVE_MS) active++;
      if (active >= getSettings(app.db).maxConnections) {
        throw new HttpError(503, 'Достигнут лимит одновременных подключений');
      }
      if (!last) {
        app.log.info('access', `Просмотр потока «${row.name}»`, { user: session.user.login, ip, stream: row.name });
      }
    }
  }
  app.viewers.set(key, now);

  const target = new URL(`/${pathNameFor(streamId)}/${file}${url.search}`, app.config.mediamtx.hlsUrl);
  const headers = { 'user-agent': 'rtspatom-proxy' };
  // Запрос «от CDN»: MediaMTX ведёт одну общую сессию на поток без cookie и редиректов.
  if (app.config.mediamtx.cdnSecret) headers.authorization = `Bearer ${app.config.mediamtx.cdnSecret}`;
  await new Promise((resolve, reject) => {
    const upstream = http.request(
      target,
      { method: req.method, headers },
      (up) => {
        if (up.statusCode >= 300 && up.statusCode < 400) {
          up.resume();
          reject(new HttpError(502, 'MediaMTX требует cookie-сессию: задайте одинаковый секрет hlsCDNSecret в mediamtx.yml и mediamtx.cdnSecret в config.json'));
          return;
        }
        const headers = {};
        for (const h of PASS_HEADERS) if (up.headers[h]) headers[h] = up.headers[h];
        if (!headers['cache-control']) headers['cache-control'] = 'no-cache';
        res.writeHead(up.statusCode || 502, headers);
        up.pipe(res);
        up.on('end', resolve);
        up.on('error', reject);
      },
    );
    upstream.on('error', () => reject(new HttpError(502, 'MediaMTX недоступен')));
    res.on('close', () => {
      upstream.destroy();
      resolve();
    });
    upstream.end();
  });
}
