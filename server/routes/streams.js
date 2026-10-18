import crypto from 'node:crypto';
import { HttpError, badRequest, notFound } from '../lib/http.js';
import { newId } from '../lib/security.js';
import { nowIso } from '../lib/db.js';
import { getSettings } from '../lib/settings.js';
import { canAccessStream, hasRole } from '../lib/access.js';
import { detectProtocol, redactUrl, buildSourceUrl, pathNameOf, SOURCE_PROTOCOLS } from '../lib/mediamtx.js';

const TRANSPORTS = ['auto', 'tcp', 'udp'];

/** Секретный ключ публикации для энкодера: 20 символов [a-z0-9] (~103 бита). */
export function newPushKey() {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  while (out.length < 20) {
    for (const b of crypto.randomBytes(32)) {
      if (b < 252 && out.length < 20) out += abc[b % 36]; // 252 = 7·36, без перекоса
    }
  }
  return out;
}

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
  if (body.mode !== undefined && body.mode !== 'push' && body.mode !== 'pull') throw badRequest('mode: pull или push');
  if (body.mode === 'push') {
    // Энкодер отправляет поток сам — адрес источника не нужен
    out.mode = 'push';
    out.url = '';
    out.protocol = 'push';
  } else if (!partial || body.url !== undefined || body.mode === 'pull') {
    if (body.mode === 'pull') out.mode = 'pull';
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
  if (body.record !== undefined) out.record = !!body.record;
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

  const viewersOf = (streamId) => app.viewersOf(streamId);

  function streamToApi(s, user) {
    const privileged = hasRole(user, 'operator');
    const st = app.sync?.statusOf(s.id);
    const m = app.config.mediamtx || {};
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      mode: s.push_key ? 'push' : 'pull',
      // Ключ публикации — только администратору: с ним можно подменить видео
      push: s.push_key && user.isAdmin
        ? { key: s.push_key, path: pathNameOf(s), rtmpPort: m.rtmpPort || 1935, srtPort: m.srtPort || 8890 }
        : null,
      url: privileged ? redactUrl(s.url) : '',
      protocol: s.protocol,
      transport: s.transport,
      sourceLogin: user.isAdmin ? s.source_login : '',
      hasPassword: !!s.source_password,
      isActive: !!s.is_active,
      record: !!s.record,
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
      `INSERT INTO streams (id, name, url, protocol, source_login, source_password, transport, description, is_active, sort, created_at, push_key, record)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, s.name, s.url, s.protocol, s.sourceLogin || '', s.sourcePassword || '',
      s.transport || 'auto', s.description || '', s.isActive === false ? 0 : 1, sort, nowIso(),
      s.mode === 'push' ? newPushKey() : null,
      (s.record ?? getSettings(db).archiveNewStreams) ? 1 : 0);
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
      // Смена режима: в push выдаём ключ (прежний сохраняется), в pull — убираем
      push_key: s.mode === 'push' ? cur.push_key || newPushKey() : s.url !== undefined ? null : cur.push_key,
      record: s.record === undefined ? cur.record : s.record ? 1 : 0,
    };
    if (s.mode === 'push') { next.source_login = ''; next.source_password = ''; }
    db.prepare(
      `UPDATE streams SET name = ?, description = ?, url = ?, protocol = ?, source_login = ?, source_password = ?,
       transport = ?, is_active = ?, push_key = ?, record = ? WHERE id = ?`,
    ).run(next.name, next.description, next.url, next.protocol, next.source_login, next.source_password,
      next.transport, next.is_active, next.push_key, next.record, cur.id);
    const only = Object.keys(s).length === 1;
    const what = s.isActive !== undefined && only ? (next.is_active ? 'Включён' : 'Отключён')
      : s.record !== undefined && only ? (next.record ? 'Включена запись в архив: поток' : 'Выключена запись в архив: поток')
        : 'Изменён';
    log.info('admin', `${what} поток «${next.name}»`, { user: ctx.user.login, ip: ctx.ip, stream: next.name });
    sync();
    return streamToApi(getStream(cur.id), ctx.user);
  }, { auth: 'admin' });

  // Новый ключ публикации (если старый попал не в те руки): энкодер нужно перенастроить
  router.post('/api/streams/:id/push-key', (ctx) => {
    const cur = getStream(ctx.params.id);
    if (!cur) throw notFound('Поток не найден');
    if (!cur.push_key) throw badRequest('Поток забирается по адресу — ключ публикации ему не нужен');
    db.prepare('UPDATE streams SET push_key = ? WHERE id = ?').run(newPushKey(), cur.id);
    log.warn('admin', `Сменён ключ публикации потока «${cur.name}»`, { user: ctx.user.login, ip: ctx.ip, stream: cur.name });
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
    log.info('admin', `Удалён поток «${cur.name}» вместе с архивом`, { user: ctx.user.login, ip: ctx.ip, stream: cur.name });
    sync();
    app.archive?.removeStream(cur.id);
  }, { auth: 'admin' });

  router.post('/api/streams/probe', async (ctx) => {
    const body = await ctx.json();
    if (body.mode === 'push') throw badRequest('Поток от энкодера проверять не нужно: он появится, когда энкодер начнёт передачу');
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
