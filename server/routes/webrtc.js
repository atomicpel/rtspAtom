import http from 'node:http';
import { HttpError } from '../lib/http.js';
import { canAccessStream } from '../lib/access.js';
import { getSettings } from '../lib/settings.js';
import { pathNameOf } from '../lib/mediamtx.js';

const MAX_SDP = 64 * 1024;
const SESSION_TTL_MS = 12 * 3600 * 1000;

/**
 * Прокси сигнализации WebRTC (WHEP) с проверкой прав:
 *   POST   /webrtc/<streamId>/whep            — предложение SDP, ответ 201 + SDP + Location
 *   PATCH  /webrtc/<streamId>/whep/<сеанс>    — дополнительные ICE-кандидаты
 *   DELETE /webrtc/<streamId>/whep/<сеанс>    — завершение просмотра
 * Само видео идёт напрямую от MediaMTX по порту ICE (8189 UDP/TCP).
 */
export async function handleWebrtc(app, req, res, url, session, ip) {
  if (!session) throw new HttpError(401, 'Требуется вход в систему');
  if (req.headers['x-rtspatom'] !== '1') throw new HttpError(403, 'Отсутствует заголовок X-RTSPAtom');

  const m = /^\/webrtc\/([A-Za-z0-9_-]{1,64})\/whep(?:\/([A-Za-z0-9_-]{1,80}))?$/.exec(url.pathname);
  if (!m) throw new HttpError(404, 'Не найдено');
  const [, streamId, sessionId] = m;

  const row = app.db.prepare('SELECT id, name, is_active, push_key FROM streams WHERE id = ?').get(streamId);
  if (!row) throw new HttpError(404, 'Поток не найден');
  if (!canAccessStream(session.user, row.id)) throw new HttpError(403, 'Нет доступа к этому потоку');

  app.webrtcSessions ??= new Map(); // сеанс MediaMTX -> { owner, streamId, at }
  const now = Date.now();
  for (const [k, v] of app.webrtcSessions) if (now - v.at > SESSION_TTL_MS) app.webrtcSessions.delete(k);

  if (!sessionId) {
    if (req.method !== 'POST') throw new HttpError(405, 'Метод не поддерживается');
    if (!row.is_active) throw new HttpError(409, 'Поток отключён');
    if (app.activeViewerCount() >= getSettings(app.db).maxConnections) {
      throw new HttpError(503, 'Достигнут лимит одновременных подключений');
    }
  } else {
    if (req.method !== 'PATCH' && req.method !== 'DELETE') throw new HttpError(405, 'Метод не поддерживается');
    const s = app.webrtcSessions.get(sessionId);
    if (!s || s.owner !== session.tokenHash || s.streamId !== streamId) throw new HttpError(404, 'Сеанс не найден');
  }

  const body = await readBody(req);
  const target = new URL(`/${pathNameOf(row)}/whep${sessionId ? `/${sessionId}` : ''}`, app.config.mediamtx.webrtcUrl);
  const headers = { 'user-agent': 'rtspatom-proxy' };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers['if-match']) headers['if-match'] = req.headers['if-match'];
  if (body.length) headers['content-length'] = body.length;

  const up = await new Promise((resolve, reject) => {
    const r = http.request(target, { method: req.method, headers }, resolve);
    r.on('error', () => reject(new HttpError(502, 'Видеосервер MediaMTX недоступен')));
    r.setTimeout(15000, () => r.destroy(new Error('timeout')));
    r.end(body);
  });
  const chunks = [];
  for await (const c of up) chunks.push(c);
  const answer = Buffer.concat(chunks);

  const out = { 'cache-control': 'no-store' };
  for (const h of ['content-type', 'etag', 'accept-patch']) if (up.headers[h]) out[h] = up.headers[h];

  if (!sessionId && up.statusCode === 201) {
    // /s_<id>/whep/<сеанс> → /webrtc/<id>/whep/<сеанс>
    const loc = String(up.headers.location || '');
    const sid = /\/whep\/([A-Za-z0-9_-]{1,80})$/.exec(loc)?.[1];
    if (sid) {
      app.webrtcSessions.set(sid, { owner: session.tokenHash, streamId, at: now });
      out.location = `/webrtc/${streamId}/whep/${sid}`;
      out['access-control-expose-headers'] = 'Location';
    }
    const key = `${session.tokenHash.slice(0, 16)}|${streamId}`;
    if (!app.webrtcLogged?.has(key)) {
      app.webrtcLogged ??= new Set();
      if (app.webrtcLogged.size > 10000) app.webrtcLogged.clear();
      app.webrtcLogged.add(key);
      app.log.info('access', `Просмотр потока «${row.name}» (WebRTC)`, { user: session.user.login, ip, stream: row.name });
    }
  }
  if (sessionId && req.method === 'DELETE') app.webrtcSessions.delete(sessionId);

  if (up.statusCode >= 400 && !out['content-type']?.includes('sdp')) {
    let msg = answer.toString('utf8');
    try { msg = JSON.parse(msg).error || msg; } catch { /* не JSON */ }
    throw new HttpError([400, 404].includes(up.statusCode) ? up.statusCode : 502, `WebRTC: ${msg || `код ${up.statusCode}`}`);
  }
  res.writeHead(up.statusCode, out);
  res.end(answer);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_SDP) throw new HttpError(413, 'Слишком большой запрос');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
