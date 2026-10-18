import http from 'node:http';
import { HttpError, badRequest, notFound } from '../lib/http.js';
import { canAccessStream, hasRole } from '../lib/access.js';
import { getSettings } from '../lib/settings.js';
import { pathNameFor } from '../lib/mediamtx.js';
import { newId } from '../lib/security.js';
import { nowIso } from '../lib/db.js';

const MAX_VIDEO_SEC = 4 * 3600; // один запрос видео — не длиннее 4 часов
const VIEW_LOG_MS = 30 * 60_000; // просмотр архива пишем в журнал не чаще раза в 30 минут на поток и сеанс

function parseTime(v, field) {
  const t = Date.parse(String(v || ''));
  if (!Number.isFinite(t)) throw badRequest(`${field}: ожидается дата и время (ISO 8601)`);
  return t;
}

/** Записи потока всегда выдаются из пути s_<id>; null — такого пути в MediaMTX сейчас нет. */
function playbackPath(app, row) {
  const name = pathNameFor(row.id);
  return app.sync?.lastWanted?.has(name) ? name : null;
}

function playbackRequest(app, endpoint, params) {
  const url = new URL(endpoint, app.config.mediamtx.playbackUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Promise((resolve, reject) => {
    const r = http.get(url, { headers: { 'user-agent': 'rtspatom-proxy' } }, (up) => {
      // ответ пришёл — дальше видео может долго не читаться (плеер на паузе), это не ошибка
      r.setTimeout(0);
      resolve(up);
    });
    r.on('error', () => reject(new HttpError(503, 'Сервер архива MediaMTX недоступен')));
    r.setTimeout(30_000, () => r.destroy(new Error('timeout')));
  });
}

async function readAll(res) {
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

/** Имя файла для выгрузки: «Въезд_2026-10-18_14-05-00.mp4» (RFC 5987 для кириллицы). */
function attachmentName(name, startMs) {
  const d = new Date(startMs);
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  const base = `${String(name).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80)}_${stamp}.mp4`;
  const ascii = base.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base)}`;
}

export function registerArchive(router, app) {
  const { db, log } = app;
  const getStream = (id) => db.prepare('SELECT * FROM streams WHERE id = ?').get(id);
  const accessible = (ctx, id) => {
    const row = getStream(id);
    if (!row || !canAccessStream(ctx.user, row.id)) throw notFound('Поток не найден');
    return row;
  };

  // Сводка архива: объём, место на диске, по потокам
  router.get('/api/archive', async (ctx) => {
    const st = app.archive ? await app.archive.stats() : null;
    const s = getSettings(db);
    const rows = db.prepare('SELECT * FROM streams ORDER BY sort, created_at').all()
      .filter((r) => canAccessStream(ctx.user, r.id));
    return {
      enabled: !!app.archive,
      days: s.archiveDays,
      minFreeGb: s.archiveMinFreeGb,
      dir: ctx.user.isAdmin ? app.config.archiveDir : undefined,
      totalBytes: st?.totalBytes || 0,
      bytesPerDay: st?.bytesPerDay || 0,
      capacityDays: st?.capacityDays ?? null,
      disk: st?.disk || null,
      streams: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        record: !!r.record,
        isActive: !!r.is_active,
        bytes: st?.streams[r.id]?.bytes || 0,
        oldest: st?.streams[r.id] ? new Date(st.streams[r.id].oldest).toISOString() : null,
      })),
    };
  }, { auth: 'operator' });

  // Промежутки записи потока: [{ start, duration }] (секунды)
  router.get('/api/archive/:id/spans', async (ctx) => {
    const row = accessible(ctx, ctx.params.id);
    const start = parseTime(ctx.query.get('start'), 'start');
    const end = parseTime(ctx.query.get('end'), 'end');
    if (end <= start || end - start > 32 * 86400_000) throw badRequest('Промежуток — от минуты до 32 суток');
    const name = playbackPath(app, row);
    if (!name) return [];
    const up = await playbackRequest(app, '/list', {
      path: name, start: new Date(start).toISOString(), end: new Date(end).toISOString(),
    });
    const text = await readAll(up);
    if (up.statusCode === 404) return [];
    if (up.statusCode !== 200) {
      let msg = text;
      try { msg = JSON.parse(text).error || text; } catch { /* не JSON */ }
      // путь ещё не создан в MediaMTX (только что включили запись) — записей просто нет
      if (up.statusCode === 400 && /path|not found|configuration/i.test(msg)) return [];
      throw new HttpError(502, `Архив: ${msg}`);
    }
    let list = [];
    try { list = JSON.parse(text); } catch { throw new HttpError(502, 'Архив: неверный ответ MediaMTX'); }
    return (Array.isArray(list) ? list : []).map((e) => ({ start: e.start, duration: Number(e.duration) || 0 }));
  }, { auth: 'operator' });

  // ---------- Закладки ----------
  const bookmarkToApi = (b, user) => ({
    id: b.id, streamId: b.stream_id, ts: b.ts, note: b.note, user: b.user_login, createdAt: b.created_at,
    canDelete: user.isAdmin || user.login === b.user_login,
  });

  router.get('/api/bookmarks', (ctx) => {
    const where = [];
    const args = [];
    const sid = ctx.query.get('streamId');
    if (sid) { where.push('stream_id = ?'); args.push(sid); }
    const from = ctx.query.get('from');
    const to = ctx.query.get('to');
    if (from) { where.push('ts >= ?'); args.push(new Date(parseTime(from, 'from')).toISOString()); }
    if (to) { where.push('ts <= ?'); args.push(new Date(parseTime(to, 'to')).toISOString()); }
    const q = (ctx.query.get('q') || '').trim().toLowerCase();
    const rows = db.prepare(`SELECT * FROM bookmarks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ts DESC LIMIT 2000`).all(...args);
    return rows
      .filter((b) => canAccessStream(ctx.user, b.stream_id))
      .filter((b) => !q || b.note.toLowerCase().includes(q) || b.user_login.toLowerCase().includes(q))
      .slice(0, 500)
      .map((b) => bookmarkToApi(b, ctx.user));
  }, { auth: 'operator' });

  router.post('/api/bookmarks', async (ctx) => {
    const body = await ctx.json();
    const row = accessible(ctx, String(body.streamId || ''));
    const ts = new Date(parseTime(body.ts, 'ts')).toISOString();
    const note = String(body.note || '').trim().slice(0, 500);
    const id = newId();
    db.prepare('INSERT INTO bookmarks (id, stream_id, ts, note, user_login, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, row.id, ts, note, ctx.user.login, nowIso());
    log.info('access', `Закладка в архиве «${row.name}» на ${new Date(ts).toLocaleString('ru-RU')}${note ? `: ${note}` : ''}`,
      { user: ctx.user.login, ip: ctx.ip, stream: row.name });
    return bookmarkToApi(db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id), ctx.user);
  }, { auth: 'operator' });

  router.delete('/api/bookmarks/:id', (ctx) => {
    const b = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(ctx.params.id);
    if (!b || !canAccessStream(ctx.user, b.stream_id)) throw notFound('Закладка не найдена');
    if (!ctx.user.isAdmin && b.user_login !== ctx.user.login) throw new HttpError(403, 'Удалять можно только свои закладки');
    db.prepare('DELETE FROM bookmarks WHERE id = ?').run(b.id);
  }, { auth: 'operator' });
}

/**
 * Видео из архива: /archive/<streamId>/video?start=<ISO>&duration=<сек>[&download=1]
 * Отдаётся потоком fMP4 (для плеера) или MP4 (для выгрузки) через сервер выдачи записей MediaMTX.
 * GET без заголовка CSRF: адрес ставится в <video src> и в ссылку на скачивание;
 * cookie сессии SameSite=Strict не уходит с чужих сайтов.
 */
export async function handleArchiveVideo(app, req, res, url, session, ip) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Метод не поддерживается');
  if (!session) throw new HttpError(401, 'Требуется вход в систему');
  if (!hasRole(session.user, 'operator')) throw new HttpError(403, 'Архив доступен операторам и администраторам');
  const m = /^\/archive\/([A-Za-z0-9_-]{1,64})\/video$/.exec(url.pathname);
  if (!m) throw new HttpError(404, 'Не найдено');
  const row = app.db.prepare('SELECT * FROM streams WHERE id = ?').get(m[1]);
  if (!row || !canAccessStream(session.user, row.id)) throw new HttpError(404, 'Поток не найден');

  const start = parseTime(url.searchParams.get('start'), 'start');
  const duration = Number(url.searchParams.get('duration'));
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_SEC) {
    throw badRequest(`duration: от 1 до ${MAX_VIDEO_SEC} секунд`);
  }
  const download = url.searchParams.get('download') === '1';
  const name = pathNameFor(row.id);

  const key = `${session.tokenHash.slice(0, 16)}|${row.id}`;
  app.archiveViews ??= new Map();
  const now = Date.now();
  if (download) {
    app.log.info('access', `Выгрузка из архива «${row.name}»: ${new Date(start).toLocaleString('ru-RU')}, ${Math.round(duration / 60)} мин`,
      { user: session.user.login, ip, stream: row.name });
  } else if (!app.archiveViews.has(key) || now - app.archiveViews.get(key) > VIEW_LOG_MS) {
    app.log.info('access', `Просмотр архива «${row.name}» с ${new Date(start).toLocaleString('ru-RU')}`,
      { user: session.user.login, ip, stream: row.name });
    if (app.archiveViews.size > 5000) app.archiveViews.clear();
  }
  if (!download) app.archiveViews.set(key, now);

  const up = await playbackRequest(app, '/get', {
    path: name, start: new Date(start).toISOString(), duration: String(duration), format: download ? 'mp4' : 'fmp4',
  });
  if (up.statusCode !== 200) {
    const text = await readAll(up);
    let msg = text;
    try { msg = JSON.parse(text).error || text; } catch { /* не JSON */ }
    if (up.statusCode === 404) throw new HttpError(404, 'В это время записи нет');
    throw new HttpError(502, `Архив: ${msg || `код ${up.statusCode}`}`);
  }
  const headers = { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (download) headers['Content-Disposition'] = attachmentName(row.name, start);
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { up.destroy(); res.end(); return; }
  // зритель ушёл или перемотал — прекращаем чтение из MediaMTX; сбой MediaMTX посреди передачи — обрываем ответ
  res.on('close', () => up.destroy());
  up.on('error', () => res.destroy());
  up.pipe(res);
  await new Promise((resolve) => { up.on('end', resolve); up.on('close', resolve); up.on('error', resolve); });
}
