import { HttpError, badRequest } from '../lib/http.js';
import {
  hashPassword, verifyPassword, dummyVerify, newId, newToken, sha256, isLoopback, userIpAllowed,
} from '../lib/security.js';
import { getSettings } from '../lib/settings.js';
import { nowIso } from '../lib/db.js';
import { userFromRow } from '../lib/access.js';
import { PLATFORM } from '../lib/config.js';

export const MIN_PASSWORD = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) {
    throw badRequest(`Пароль должен быть не короче ${MIN_PASSWORD} символов`);
  }
  if (pw.length > 256) throw badRequest('Слишком длинный пароль');
}

export function validateLogin(login) {
  if (typeof login !== 'string' || !/^[\p{L}\p{N}._@-]{2,64}$/u.test(login)) {
    throw badRequest('Логин: 2–64 символа — буквы, цифры, точка, дефис, подчёркивание, @');
  }
}

function createSession(app, ctx, userRow) {
  const token = newToken();
  const ttl = getSettings(app.db).sessionTtl;
  const now = Date.now();
  app.db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, ip, user_agent, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sha256(token), userRow.id, ctx.ip, String(ctx.req.headers['user-agent'] || '').slice(0, 300),
      new Date(now).toISOString(), new Date(now).toISOString(), new Date(now + ttl * 1000).toISOString(),
    );
  app.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), userRow.id);
  // Cookie живёт неделю, фактический срок контролирует сервер (скользящий TTL).
  ctx.res.setHeader('Set-Cookie', app.cookie(token, 7 * 86400));
}

export function registerAuth(router, app) {
  const { db, log } = app;
  const countUsers = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  router.get('/api/auth/status', (ctx) => ({
    setupRequired: countUsers() === 0,
    setupAllowedHere: isLoopback(ctx.ip),
    authenticated: !!ctx.user,
    platform: PLATFORM,
  }), { auth: 'public' });

  // Первичное создание администратора — только когда пользователей нет
  // и только с самого сервера (localhost). Иначе — командой rtspatom-admin.
  router.post('/api/auth/setup', async (ctx) => {
    if (countUsers() > 0) throw new HttpError(409, 'Администратор уже создан');
    if (!isLoopback(ctx.ip)) {
      throw new HttpError(403, 'Первичная настройка доступна только с самого сервера или командой rtspatom-admin');
    }
    const { login, password } = await ctx.json();
    validateLogin(login);
    validatePassword(password);
    const row = {
      id: newId(), login, password_hash: await hashPassword(password), role: 'admin', is_admin: 1,
      allowed_cidrs: '[]', allowed_stream_ids: '[]', is_active: 1, created_at: nowIso(),
    };
    db.prepare(
      `INSERT INTO users (id, login, password_hash, role, is_admin, allowed_cidrs, allowed_stream_ids, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.id, row.login, row.password_hash, row.role, row.is_admin, row.allowed_cidrs,
      row.allowed_stream_ids, row.is_active, row.created_at);
    log.info('admin', `Создан первый администратор: ${login}`, { user: login, ip: ctx.ip });
    createSession(app, ctx, row);
    return { user: userFromRow(row) };
  }, { auth: 'public' });

  router.post('/api/auth/login', async (ctx) => {
    const { login, password } = await ctx.json();
    if (typeof login !== 'string' || typeof password !== 'string' || !login || !password) {
      throw badRequest('Укажите логин и пароль');
    }
    const settings = getSettings(db);
    const now = Date.now();
    const attempt = db.prepare('SELECT * FROM login_attempts WHERE ip = ?').get(ctx.ip);
    if (attempt?.blocked_until && Date.parse(attempt.blocked_until) > now) {
      const mins = Math.ceil((Date.parse(attempt.blocked_until) - now) / 60000);
      throw new HttpError(429, `Превышено число попыток входа. Повторите через ${mins} мин.`);
    }

    const row = db.prepare('SELECT * FROM users WHERE login = ?').get(login);
    const ok = row ? await verifyPassword(password, row.password_hash) : await dummyVerify(password);

    const fail = (reason, message = 'Неверный логин или пароль') => {
      let count = 1;
      let firstAt = new Date(now).toISOString();
      if (attempt && now - Date.parse(attempt.first_at) < LOGIN_WINDOW_MS) {
        count = attempt.count + 1;
        firstAt = attempt.first_at;
      }
      const blocked = count >= settings.rateLimitLogin
        ? new Date(now + LOGIN_WINDOW_MS).toISOString() : null;
      db.prepare(
        `INSERT INTO login_attempts (ip, count, first_at, blocked_until) VALUES (?, ?, ?, ?)
         ON CONFLICT(ip) DO UPDATE SET count = excluded.count, first_at = excluded.first_at,
         blocked_until = excluded.blocked_until`,
      ).run(ctx.ip, count, firstAt, blocked);
      log.warn('auth', `Неудачный вход «${login}»: ${reason}`, { user: login, ip: ctx.ip });
      if (blocked) {
        log.warn('auth', `IP ${ctx.ip} заблокирован на 15 минут после ${count} неудачных попыток`, { ip: ctx.ip });
      }
      throw new HttpError(401, message);
    };

    if (!row || !ok) return fail(row ? 'неверный пароль' : 'пользователь не найден');
    if (!row.is_active) return fail('учётная запись отключена', 'Учётная запись отключена');
    const user = userFromRow(row);
    if (!userIpAllowed(user.allowedCidrs, ctx.ip)) {
      return fail(`вход с ${ctx.ip} запрещён для пользователя`, 'Вход с этого IP-адреса запрещён');
    }

    db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ctx.ip);
    createSession(app, ctx, row);
    log.info('auth', `Успешный вход: ${login}`, { user: login, ip: ctx.ip });
    return { user };
  }, { auth: 'public' });

  router.post('/api/auth/logout', (ctx) => {
    if (ctx.session) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(ctx.session.tokenHash);
      log.info('auth', `Выход: ${ctx.user.login}`, { user: ctx.user.login, ip: ctx.ip });
    }
    ctx.res.setHeader('Set-Cookie', app.cookie('', 0));
    return { ok: true };
  }, { auth: 'public' });

  router.get('/api/auth/me', (ctx) => ({ user: ctx.user }));

  router.post('/api/auth/password', async (ctx) => {
    const { currentPassword, newPassword } = await ctx.json();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
    if (!(await verifyPassword(String(currentPassword || ''), row.password_hash))) {
      throw badRequest('Текущий пароль указан неверно');
    }
    validatePassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(newPassword), row.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(row.id, ctx.session.tokenHash);
    log.info('auth', `Пользователь сменил свой пароль: ${row.login}`, { user: row.login, ip: ctx.ip });
    return { ok: true };
  });
}
