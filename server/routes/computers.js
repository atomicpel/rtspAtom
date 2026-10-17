import { HttpError, badRequest, notFound } from '../lib/http.js';
import { newId } from '../lib/security.js';
import { nowIso } from '../lib/db.js';
import { canAccessComputer, hasRole } from '../lib/access.js';
import { detectProtocol, redactUrl, buildSourceUrl, SOURCE_PROTOCOLS } from '../lib/mediamtx.js';

const TRANSPORTS = ['auto', 'tcp', 'udp'];
const VIEWER_ACTIVE_MS = 20_000;

function str(v, max, field, { required = false } = {}) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (required && !s) throw badRequest(`Поле «${field}» обязательно`);
  if (s.length > max) throw badRequest(`Поле «${field}» слишком длинное`);
  return s;
}

function parseComputer(body, partial) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = str(body.name, 200, 'Название', { required: true });
  if (!partial || body.hostname !== undefined) out.hostname = str(body.hostname, 200, 'Hostname');
  if (!partial || body.ip !== undefined) out.ip = str(body.ip, 100, 'IP-адрес');
  if (!partial || body.description !== undefined) out.description = str(body.description, 2000, 'Описание');
  if (body.isActive !== undefined) out.isActive = !!body.isActive;
  return out;
}

/** Разбирает URL потока; логин/пароль, вписанные в URL, переносит в отдельные поля. */
function parseStream(body, partial) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = str(body.name, 200, 'Название потока', { required: true });
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

export function registerComputers(router, app) {
  const { db, log } = app;
  const sync = () => app.sync?.trigger().catch(() => {});
  const getComputer = (id) => db.prepare('SELECT * FROM computers WHERE id = ?').get(id);
  const getStream = (id) => db.prepare('SELECT * FROM streams WHERE id = ?').get(id);

  function viewersOf(streamId) {
    const now = Date.now();
    let n = 0;
    for (const [k, t] of app.viewers) if (k.endsWith(`|${streamId}`) && now - t < VIEWER_ACTIVE_MS) n++;
    return n;
  }

  function streamToApi(s, computerActive, user) {
    const privileged = hasRole(user, 'operator');
    const st = app.sync?.status.get(`s_${s.id}`);
    return {
      id: s.id,
      computerId: s.computer_id,
      name: s.name,
      url: privileged ? redactUrl(s.url) : '',
      protocol: s.protocol,
      transport: s.transport,
      sourceLogin: user.isAdmin ? s.source_login : '',
      hasPassword: !!s.source_password,
      isActive: !!s.is_active,
      status: app.sync ? app.sync.streamState(s, computerActive) : 'offline',
      tracks: st?.tracks || [],
      viewers: viewersOf(s.id),
    };
  }

  function computerToApi(c, user) {
    const streams = db
      .prepare('SELECT * FROM streams WHERE computer_id = ? ORDER BY sort, created_at')
      .all(c.id)
      .map((s) => streamToApi(s, !!c.is_active, user));
    // Компьютер «в сети», если все его включённые потоки работают (или ждут зрителя),
    // «частично» (reconnecting) — если работает только часть.
    const active = streams.filter((s) => s.isActive);
    const up = active.filter((s) => s.status === 'online' || s.status === 'idle').length;
    let status = 'offline';
    if (c.is_active && active.length > 0) {
      if (up === active.length) status = 'online';
      else if (up > 0 || active.some((s) => s.status === 'reconnecting')) status = 'reconnecting';
    }
    return {
      id: c.id,
      name: c.name,
      hostname: c.hostname,
      ip: hasRole(user, 'operator') ? c.ip : '',
      description: c.description,
      isActive: !!c.is_active,
      status,
      createdAt: c.created_at,
      streams,
    };
  }
  app.computerToApi = computerToApi;

  router.get('/api/computers', (ctx) =>
    db.prepare('SELECT * FROM computers ORDER BY name').all()
      .filter((c) => canAccessComputer(ctx.user, c.id))
      .map((c) => computerToApi(c, ctx.user)));

  router.post('/api/computers', async (ctx) => {
    const c = parseComputer(await ctx.json(), false);
    const id = newId();
    db.prepare(
      'INSERT INTO computers (id, name, hostname, ip, description, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, c.name, c.hostname, c.ip, c.description, c.isActive === false ? 0 : 1, nowIso());
    log.info('admin', `Добавлен компьютер «${c.name}»`, { user: ctx.user.login, ip: ctx.ip });
    return computerToApi(getComputer(id), ctx.user);
  }, { auth: 'admin' });

  router.put('/api/computers/:id', async (ctx) => {
    const cur = getComputer(ctx.params.id);
    if (!cur) throw notFound('Компьютер не найден');
    const c = parseComputer(await ctx.json(), true);
    const next = {
      name: c.name ?? cur.name,
      hostname: c.hostname ?? cur.hostname,
      ip: c.ip ?? cur.ip,
      description: c.description ?? cur.description,
      is_active: c.isActive === undefined ? cur.is_active : c.isActive ? 1 : 0,
    };
    db.prepare('UPDATE computers SET name = ?, hostname = ?, ip = ?, description = ?, is_active = ? WHERE id = ?')
      .run(next.name, next.hostname, next.ip, next.description, next.is_active, cur.id);
    if (next.is_active !== cur.is_active) {
      log.info('admin', `Компьютер «${next.name}» ${next.is_active ? 'включён' : 'отключён'}`, { user: ctx.user.login, ip: ctx.ip });
      sync();
    } else {
      log.info('admin', `Изменён компьютер «${next.name}»`, { user: ctx.user.login, ip: ctx.ip });
    }
    return computerToApi(getComputer(cur.id), ctx.user);
  }, { auth: 'admin' });

  router.delete('/api/computers/:id', (ctx) => {
    const cur = getComputer(ctx.params.id);
    if (!cur) throw notFound('Компьютер не найден');
    db.prepare('DELETE FROM computers WHERE id = ?').run(cur.id);
    log.info('admin', `Удалён компьютер «${cur.name}» со всеми потоками`, { user: ctx.user.login, ip: ctx.ip });
    sync();
  }, { auth: 'admin' });

  router.post('/api/computers/:id/streams', async (ctx) => {
    const comp = getComputer(ctx.params.id);
    if (!comp) throw notFound('Компьютер не найден');
    const s = parseStream(await ctx.json(), false);
    const id = newId();
    const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM streams WHERE computer_id = ?').get(comp.id).n;
    db.prepare(
      `INSERT INTO streams (id, computer_id, name, url, protocol, source_login, source_password, transport, is_active, sort, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, comp.id, s.name, s.url, s.protocol, s.sourceLogin || '', s.sourcePassword || '',
      s.transport || 'auto', s.isActive === false ? 0 : 1, sort, nowIso());
    log.info('admin', `Добавлен поток «${s.name}» (${comp.name})`, { user: ctx.user.login, ip: ctx.ip, stream: s.name });
    sync();
    return streamToApi(getStream(id), !!comp.is_active, ctx.user);
  }, { auth: 'admin' });

  router.put('/api/streams/:id', async (ctx) => {
    const cur = getStream(ctx.params.id);
    if (!cur) throw notFound('Поток не найден');
    const s = parseStream(await ctx.json(), true);
    const next = {
      name: s.name ?? cur.name,
      url: s.url ?? cur.url,
      protocol: s.protocol ?? cur.protocol,
      source_login: s.sourceLogin ?? cur.source_login,
      source_password: s.sourcePassword ?? cur.source_password,
      transport: s.transport ?? cur.transport,
      is_active: s.isActive === undefined ? cur.is_active : s.isActive ? 1 : 0,
    };
    db.prepare(
      `UPDATE streams SET name = ?, url = ?, protocol = ?, source_login = ?, source_password = ?, transport = ?, is_active = ?
       WHERE id = ?`,
    ).run(next.name, next.url, next.protocol, next.source_login, next.source_password, next.transport, next.is_active, cur.id);
    log.info('admin', `Изменён поток «${next.name}»`, { user: ctx.user.login, ip: ctx.ip, stream: next.name });
    sync();
    const comp = getComputer(cur.computer_id);
    return streamToApi(getStream(cur.id), !!comp.is_active, ctx.user);
  }, { auth: 'admin' });

  router.delete('/api/streams/:id', (ctx) => {
    const cur = getStream(ctx.params.id);
    if (!cur) throw notFound('Поток не найден');
    db.prepare('DELETE FROM streams WHERE id = ?').run(cur.id);
    log.info('admin', `Удалён поток «${cur.name}»`, { user: ctx.user.login, ip: ctx.ip, stream: cur.name });
    sync();
  }, { auth: 'admin' });

  // Проверка источника через MediaMTX: временно подключаемся и ждём видео.
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
