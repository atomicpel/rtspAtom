import { HttpError, badRequest, notFound } from '../lib/http.js';
import { hashPassword, newId, isValidCidr } from '../lib/security.js';
import { nowIso, tx } from '../lib/db.js';
import { userFromRow } from '../lib/access.js';
import { validateLogin, validatePassword } from './auth.js';

const ROLES = ['admin', 'operator', 'viewer'];

function parseUserInput(body, { requirePassword }) {
  const out = {};
  if (body.login !== undefined) {
    validateLogin(body.login);
    out.login = body.login;
  }
  if (requirePassword || body.password) {
    validatePassword(body.password);
    out.password = body.password;
  }
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) throw badRequest('Неизвестная роль');
    out.role = body.role;
  }
  if (body.isAdmin !== undefined) out.isAdmin = !!body.isAdmin;
  if (body.isActive !== undefined) out.isActive = !!body.isActive;
  if (body.allowedCidrs !== undefined) {
    if (!Array.isArray(body.allowedCidrs)) throw badRequest('allowedCidrs должен быть списком');
    const cidrs = body.allowedCidrs.map((c) => String(c).trim()).filter(Boolean);
    const bad = cidrs.find((c) => !isValidCidr(c));
    if (bad) throw badRequest(`Неверный CIDR: ${bad}`);
    // 0.0.0.0/0 означает «без ограничений» — храним как пустой список.
    out.allowedCidrs = cidrs.includes('0.0.0.0/0') ? [] : cidrs;
  }
  if (body.allowedComputerIds !== undefined) {
    if (!Array.isArray(body.allowedComputerIds)) throw badRequest('allowedComputerIds должен быть списком');
    out.allowedComputerIds = [...new Set(body.allowedComputerIds.map(String))];
  }
  return out;
}

export function registerUsers(router, app) {
  const { db, log } = app;
  const getRow = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const activeAdmins = (exceptId) =>
    db.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE is_active = 1 AND (is_admin = 1 OR role = 'admin') AND id != ?",
    ).get(exceptId ?? '').n;

  router.get('/api/users', () =>
    db.prepare('SELECT * FROM users ORDER BY login').all().map(userFromRow), { auth: 'admin' });

  router.post('/api/users', async (ctx) => {
    const input = parseUserInput(await ctx.json(), { requirePassword: true });
    if (!input.login) throw badRequest('Укажите логин');
    if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(input.login)) {
      throw new HttpError(409, 'Пользователь с таким логином уже существует');
    }
    const isAdmin = input.isAdmin ?? input.role === 'admin';
    const role = isAdmin ? 'admin' : input.role === 'admin' || !input.role ? 'viewer' : input.role;
    const id = newId();
    db.prepare(
      `INSERT INTO users (id, login, password_hash, role, is_admin, allowed_cidrs, allowed_computer_ids, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, input.login, await hashPassword(input.password), role,
      isAdmin ? 1 : 0, JSON.stringify(input.allowedCidrs || []),
      JSON.stringify(input.allowedComputerIds || []), input.isActive === false ? 0 : 1, nowIso(),
    );
    log.info('admin', `Создан пользователь ${input.login}`, { user: ctx.user.login, ip: ctx.ip });
    return userFromRow(getRow(id));
  }, { auth: 'admin' });

  router.put('/api/users/:id', async (ctx) => {
    const row = getRow(ctx.params.id);
    if (!row) throw notFound('Пользователь не найден');
    const input = parseUserInput(await ctx.json(), { requirePassword: false });
    const cur = userFromRow(row);
    const next = {
      login: input.login ?? cur.login,
      isAdmin: input.isAdmin ?? cur.isAdmin,
      role: input.role ?? cur.role,
      isActive: input.isActive ?? cur.isActive,
      allowedCidrs: input.allowedCidrs ?? cur.allowedCidrs,
      allowedComputerIds: input.allowedComputerIds ?? cur.allowedComputerIds,
    };
    // Явный флаг isAdmin важнее роли: снятие флага понижает до оператора.
    if (input.isAdmin === undefined && input.role === 'admin') next.isAdmin = true;
    if (next.isAdmin) next.role = 'admin';
    else if (next.role === 'admin') next.role = 'operator';

    const losesAdmin = cur.isAdmin && cur.isActive && (!next.isAdmin || !next.isActive);
    if (losesAdmin && activeAdmins(row.id) === 0) {
      throw badRequest('Нельзя лишить прав или отключить последнего администратора');
    }
    if (row.id === ctx.user.id && !next.isActive) throw badRequest('Нельзя отключить собственную учётную запись');
    if (next.login !== cur.login && db.prepare('SELECT 1 FROM users WHERE login = ? AND id != ?').get(next.login, row.id)) {
      throw new HttpError(409, 'Пользователь с таким логином уже существует');
    }

    tx(db, () => {
      db.prepare(
        `UPDATE users SET login = ?, role = ?, is_admin = ?, is_active = ?, allowed_cidrs = ?, allowed_computer_ids = ?
         WHERE id = ?`,
      ).run(next.login, next.role, next.isAdmin ? 1 : 0, next.isActive ? 1 : 0,
        JSON.stringify(next.allowedCidrs), JSON.stringify(next.allowedComputerIds), row.id);
      if (!next.isActive) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
    });
    log.info('admin', `Изменён пользователь ${next.login}`, { user: ctx.user.login, ip: ctx.ip });
    return userFromRow(getRow(row.id));
  }, { auth: 'admin' });

  router.post('/api/users/:id/password', async (ctx) => {
    const row = getRow(ctx.params.id);
    if (!row) throw notFound('Пользователь не найден');
    const { password } = await ctx.json();
    validatePassword(password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), row.id);
    // Сбрасываем сессии пользователя (кроме текущей, если админ меняет свой пароль).
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(row.id, ctx.session.tokenHash);
    log.info('admin', `Изменён пароль пользователя ${row.login}`, { user: ctx.user.login, ip: ctx.ip });
    return { ok: true };
  }, { auth: 'admin' });

  router.delete('/api/users/:id', (ctx) => {
    const row = getRow(ctx.params.id);
    if (!row) throw notFound('Пользователь не найден');
    if (row.id === ctx.user.id) throw badRequest('Нельзя удалить собственную учётную запись');
    const cur = userFromRow(row);
    if (cur.isAdmin && cur.isActive && activeAdmins(row.id) === 0) {
      throw badRequest('Нельзя удалить последнего администратора');
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
    log.info('admin', `Удалён пользователь ${row.login}`, { user: ctx.user.login, ip: ctx.ip });
  }, { auth: 'admin' });
}
