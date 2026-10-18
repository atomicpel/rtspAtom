import os from 'node:os';
import { badRequest, notFound } from '../lib/http.js';
import { checkIpRules, isValidCidr, newId } from '../lib/security.js';
import { nowIso } from '../lib/db.js';
import { getSettings, saveSettings, validateSettings } from '../lib/settings.js';
import { PLATFORM } from '../lib/config.js';

export const APP_VERSION = '1.5.0';
const LOG_LEVELS = ['info', 'warning', 'error', 'debug'];
const LOG_CATEGORIES = ['auth', 'access', 'stream', 'error', 'admin'];

function logFilter(q) {
  const where = [];
  const args = [];
  const cat = q.get('category');
  if (cat && LOG_CATEGORIES.includes(cat)) { where.push('category = ?'); args.push(cat); }
  const level = q.get('level');
  if (level && LOG_LEVELS.includes(level)) { where.push('level = ?'); args.push(level); }
  const user = q.get('user');
  if (user) { where.push('user LIKE ? ESCAPE \'\\\''); args.push(`%${likeEscape(user)}%`); }
  const text = q.get('q');
  if (text) { where.push('message LIKE ? ESCAPE \'\\\''); args.push(`%${likeEscape(text)}%`); }
  const from = q.get('from');
  if (from && /^\d{4}-\d{2}-\d{2}/.test(from)) { where.push('ts >= ?'); args.push(new Date(from).toISOString()); }
  const to = q.get('to');
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    where.push('ts < ?');
    args.push(new Date(Date.parse(to) + 86400_000).toISOString());
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);

function logToApi(r) {
  return { id: String(r.id), timestamp: r.ts, level: r.level, category: r.category, user: r.user, ip: r.ip, stream: r.stream, message: r.message };
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function registerSystem(router, app) {
  const { db, log } = app;

  // ---------- Настройки ----------
  router.get('/api/settings', () => ({
    ...getSettings(db),
    tlsEnabled: !!app.config.tls?.enabled,
  }), { auth: 'admin' });

  router.put('/api/settings', async (ctx) => {
    const { clean, errors } = validateSettings(await ctx.json());
    if (errors.length) throw badRequest(errors.join('; '));
    const before = getSettings(db);
    saveSettings(db, clean);
    log.info('admin', `Обновлены настройки: ${Object.keys(clean).join(', ') || 'без изменений'}`, { user: ctx.user.login, ip: ctx.ip });
    if (clean.camerasAlwaysOn !== undefined && clean.camerasAlwaysOn !== before.camerasAlwaysOn) {
      app.sync?.trigger().catch(() => {});
    }
    return { ...getSettings(db), tlsEnabled: !!app.config.tls?.enabled };
  }, { auth: 'admin' });

  // ---------- IP-фильтр ----------
  const listRules = () => db.prepare('SELECT * FROM ip_rules ORDER BY priority, created_at').all()
    .map((r) => ({ id: r.id, cidr: r.cidr, type: r.type, priority: r.priority, comment: r.comment, createdAt: r.created_at }));

  router.get('/api/ip-rules', (ctx) => ({ rules: listRules(), yourIp: ctx.ip }), { auth: 'admin' });

  router.post('/api/ip-rules', async (ctx) => {
    const b = await ctx.json();
    const cidr = String(b.cidr || '').trim();
    if (!isValidCidr(cidr)) throw badRequest('Неверный формат CIDR (пример: 192.168.1.0/24)');
    if (!['white', 'black'].includes(b.type)) throw badRequest('Тип правила: white или black');
    const priority = Number.isInteger(Number(b.priority)) ? Number(b.priority) : 1;
    const comment = String(b.comment || '').trim().slice(0, 500);
    if (!comment) throw badRequest('Добавьте комментарий');

    // Не даём администратору заблокировать самого себя.
    const after = [...db.prepare('SELECT * FROM ip_rules').all(), { cidr, type: b.type, priority }];
    if (!checkIpRules(after, ctx.ip).allowed) {
      throw badRequest(`Это правило заблокирует ваш текущий адрес ${ctx.ip}. Сначала добавьте разрешающее правило для него.`);
    }
    db.prepare('INSERT INTO ip_rules (id, cidr, type, priority, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId(), cidr, b.type, priority, comment, nowIso());
    log.info('admin', `Добавлено IP-правило: ${b.type === 'white' ? 'разрешить' : 'запретить'} ${cidr}`, { user: ctx.user.login, ip: ctx.ip });
    return { rules: listRules(), yourIp: ctx.ip };
  }, { auth: 'admin' });

  router.delete('/api/ip-rules/:id', (ctx) => {
    const r = db.prepare('SELECT * FROM ip_rules WHERE id = ?').get(ctx.params.id);
    if (!r) throw notFound('Правило не найдено');
    const after = db.prepare('SELECT * FROM ip_rules WHERE id != ?').all(r.id);
    if (!checkIpRules(after, ctx.ip).allowed) {
      throw badRequest(`После удаления правила ваш адрес ${ctx.ip} окажется заблокирован`);
    }
    db.prepare('DELETE FROM ip_rules WHERE id = ?').run(r.id);
    log.info('admin', `Удалено IP-правило ${r.cidr}`, { user: ctx.user.login, ip: ctx.ip });
    return { rules: listRules(), yourIp: ctx.ip };
  }, { auth: 'admin' });

  // ---------- Журналы ----------
  router.get('/api/logs', (ctx) => {
    const { sql, args } = logFilter(ctx.query);
    const limit = Math.min(1000, Math.max(1, Number(ctx.query.get('limit')) || 200));
    const offset = Math.max(0, Number(ctx.query.get('offset')) || 0);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM logs ${sql}`).get(...args).n;
    const items = db.prepare(`SELECT * FROM logs ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, offset).map(logToApi);
    return { total, items };
  }, { auth: 'operator' });

  router.get('/api/logs/export', (ctx) => {
    const { sql, args } = logFilter(ctx.query);
    const rows = db.prepare(`SELECT * FROM logs ${sql} ORDER BY id DESC LIMIT 100000`).all(...args);
    const header = ['Дата/время', 'Уровень', 'Категория', 'Пользователь', 'IP', 'Поток', 'Сообщение'];
    const lines = [header.map(csvCell).join(';')];
    for (const r of rows) {
      lines.push([new Date(r.ts).toLocaleString('ru-RU'), r.level, r.category, r.user, r.ip, r.stream, r.message]
        .map(csvCell).join(';'));
    }
    const body = '﻿' + lines.join('\r\n');
    ctx.res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="logs_${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    });
    ctx.res.end(body);
    log.info('access', `Экспорт журнала: ${rows.length} записей`, { user: ctx.user.login, ip: ctx.ip });
  }, { auth: 'operator' });

  // ---------- Сведения о системе ----------
  router.get('/api/system', (ctx) => ({
    version: APP_VERSION,
    node: process.version,
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    os: PLATFORM,
    tlsEnabled: !!app.config.tls?.enabled,
    // Адреса сервера в сети — чтобы показать администратору, что вписать в энкодер
    addresses: ctx.user?.isAdmin
      ? Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address)
      : undefined,
    mediamtx: {
      reachable: !!app.sync?.reachable,
      version: app.sync?.version || null,
      lastError: app.sync?.lastError || '',
      lastSyncAt: app.sync?.lastSyncAt || null,
    },
  }));
}
