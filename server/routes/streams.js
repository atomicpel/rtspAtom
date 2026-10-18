import { HttpError, badRequest, notFound } from '../lib/http.js';
import { newId } from '../lib/security.js';
import { nowIso } from '../lib/db.js';
import { canAccessStream, hasRole } from '../lib/access.js';
import { detectProtocol, redactUrl, buildSourceUrl, SOURCE_PROTOCOLS } from '../lib/mediamtx.js';

const TRANSPORTS = ['auto', 'tcp', 'udp'];
const VIEWER_ACTIVE_MS = 20_000;

function str(v, max, field, { required = false } = {}) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (required && !s) throw badRequest(`Поле «${field}» обязательно`);
  if (s.length > max) throw badRequest(`Поле «${field}» слишком длинное`);
  return s;
}

/** Разбирает URL потока; логин/пароль, вписанные в URL, переносит в отдельные поля. */
function parseStream(body, partial) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = str(body.name, 200, 'Название потока', { required: true });
  if (!partial || body.description !== undefined) out.description = str(body.description, 500, 'Примечание');
  if (!partial || body.url !== undefined) {
    const raw = str(body.url, 2000, 'URL', { required: true });
    let u;
    try {
      u = new URL(raw);
    } catch {
      throw badRequest('Некорректный URL потока');
    }
    const protocol = detectProtocol(raw);
    if (!protocol) {
      const schemes = Object.values(SOURCE_PROTOCOLS).flat().join(' ');
      throw badRequest(`Неподдерживаемый протокол. Допустимо: ${schemes}`);
    }
    if (u.username) {
      out.extractedLogin = decodeURIComponent(u.username);
      out.extractedPassword = decodeURIComponent(u.password);
      u.username = '';
      u.password = '';
    }
    out.url = u.toString();
    out.protocol = protocol;
  }
  if (body.transport !== undefined) {
    if (!TRANSPORTS.includes(body.transport)) throw badRequest('transport: auto, tcp или udp');
    out.transport = body.transport;
  }
  if (body.sourceLogin !== undefined) out.sourceLogin = str(body.sourceLogin, 200, 'Логин камеры');
  if (body.sourcePassword !== undefined && body.sourcePassword !== '') {
    out.sourcePassword = String(body.sourcePassword).slice(0, 500);
  }
  if (body.clearPassword) out.sourcePassword = '';
  if (body.isActive !== undefined) out.isActive = !!body.isActive;
  if (out.extractedLogin && !out.sourceLogin) out.sourceLogin = out.extractedLogin;
  if (out.extractedLogin && out.sourcePassword === undefined) out.sourcePassword = out.extractedPassword;
  delete out.extractedLogin;
  delete out.extractedPassword;
  return out;
}

export function registerStreams(router, app) {
  const { db, log } = app;
  const sync = () => app.sync?.trigger().catch(() => {});
  const getStream = (id) => db.prepare('SELECT * FROM streams WHERE id = ?').get(id);

  function viewersOf(streamId) {
    const now = Date.now();
    let n = 0;
    for (const [k, t] of app.viewers) if (k.endsWith(`|${streamId}`) && now - t < VIEWER_ACTIVE_MS) n++;
    return n;
  }

  function streamToApi(s, user) {
    const privileged = hasRole(user, 'operator');
    const st = app.sync?.status.get(`s_${s.id}`);
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      url: privileged ? redactUrl(s.url) : '',
      protocol: s.protocol,
      transport: s.transport,
      sourceLogin: user.isAdmin ? s.source_login : '',
      hasPassword: !!s.source_password,
      isActive: !!s.is_active,
      status: app.sync ? app.sync.streamState(s) : 'offline',
      tracks: st?.tracks || [],
      viewers: viewersOf(s.id),
      sort: s.sort,
    };
  }

  router.get('/api/streams', (ctx) =>
    db.prepare('SELECT * FROM streams ORDER BY sort, created_at').all()
      .filter((s) => canAccessStream(ctx.user, s.id))
      .map((s) => streamToApi(s, ctx.user)));

  router.post('/api/streams', async (ctx) => {
    const s = parseStream(await ctx.json(), false);
    const id = newId();
    const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM streams').get().n;
    db.prepare(
      `INSERT INTO streams (id, name, url, protocol, source_login, source_password, transport, description, is_active, sort, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, s.name, s.url, s.protocol, s.sourceLogin || '', s.sourcePassword || '',
      s.transport || 'auto', s.description || '', s.isActive === false ? 0 : 1, sort, nowIso());
    log.info('admin', `Добавлен поток «${s.name}»`, { user: ctx.user.login, ip: ctx.ip, stream: s.name });
    sync();
    return streamToApi(getStream(id), ctx.user);
  }, { auth: 'admin' });

  router.put('/api/streams/:id', async (ctx) => {
    const cur = getStream(ctx.params.id);
    if (!cur) throw notFound('Поток не найден');
    const s = parseStream(await ctx.json(), true);
    const next = {
      name: s.name ?? cur.name,
      description: s.description ?? cur.description,
      url: s.url ?? cur.url,
      protocol: s.protocol ?? cur.protocol,
      source_login: s.sourceLogin ?? cur.source_login,
      source_password: s.sourcePassword ?? cur.source_password,
      transport: s.transport ?? cur.transport,
      is_active: s.isActive === undefined ? cur.is_active : s.isActive ? 1 : 0,
    };
    db.prepare(
      `UPDATE streams SET name = ?, description = ?, url = ?, protocol = ?, source_login = ?, source_password = ?,
       transport = ?, is_active = ? WHERE id = ?`,
    ).run(next.name, next.description, next.url, next.protocol, next.source_login, next.source_password,
      next.transport, next.is_active, cur.id);
    const what = s.isActive !== undefined && Object.keys(s).length === 1
      ? (next.is_active ? 'Включён' : 'Отключён') : 'Изменён';
    log.info('admin', `${what} поток «${next.name}»`, { user: ctx.user.login, ip: ctx.ip, stream: next.name });
    sync();
    return streamToApi(getStream(cur.id), ctx.user);
  }, { auth: 'admin' });

  // Порядок потоков (перетаскивание в списке): { ids: [...] }
  router.put('/api/streams-order', async (ctx) => {
    const { ids } = await ctx.json();
    if (!Array.isArray(ids)) throw badRequest('ids должен быть списком');
    const stmt = db.prepare('UPDATE streams SET sort = ? WHERE id = ?');
    ids.forEach((id, i) => stmt.run(i + 1, String(id)));
    return { ok: true };
  }, { auth: 'admin' });

  router.delete('/api/streams/:id', (ctx) => {
    const cur = getStream(ctx.params.id);
    if (!cur) throw notFound('Поток не найден');
    db.prepare('DELETE FROM streams WHERE id = ?').run(cur.id);
    log.info('admin', `Удалён поток «${cur.name}»`, { user: ctx.user.login, ip: ctx.ip, stream: cur.name });
    sync();
  }, { auth: 'admin' });

  router.post('/api/streams/probe', async (ctx) => {
    const body = await ctx.json();
    const s = parseStream({ name: 'probe', ...body }, false);
    let login = s.sourceLogin || '';
    let password = s.sourcePassword;
    if (password === undefined && body.streamId) {
      const stored = getStream(String(body.streamId));
      if (stored) {
        password = stored.source_password;
        if (!login) login = stored.source_login;
      }
    }
    if (!app.sync?.reachable) {
      throw new HttpError(503, 'MediaMTX недоступен — проверка невозможна. Проверьте службу rtspatom-mediamtx.');
    }
    const source = buildSourceUrl(s.url, login, password || '');
    const result = await app.sync.client.probe(source, {
      transport: s.protocol === 'rtsp' ? s.transport || 'auto' : 'auto',
    });
    const browserOk = result.tracks.some((t) => /^(H264|AVC)/i.test(t));
    const hevc = result.tracks.some((t) => /H265|HEVC/i.test(t));
    return {
      ok: result.ok,
      tracks: result.tracks,
      protocol: s.protocol,
      warning: result.ok && !browserOk
        ? hevc
          ? 'Камера отдаёт H.265 — не все браузеры его воспроизводят. Для надёжности переключите камеру на H.264.'
          : 'Видеокодек может не поддерживаться браузером — рекомендуется H.264.'
        : '',
    };
  }, { auth: 'admin' });

}
