import { URL } from 'node:url';
import {
  HttpError, Router, sendJson, readJson, parseCookies, serializeCookie,
  serveStatic, SECURITY_HEADERS,
} from './http.js';
import { checkIpRules, normalizeIp, sha256, userIpAllowed } from './security.js';
import { getSettings } from './settings.js';
import { userFromRow, hasRole } from './access.js';
import { registerRoutes } from '../routes/index.js';
import { handleHls } from '../routes/hls.js';
import { handleWebrtc } from '../routes/webrtc.js';
import { handleArchiveVideo } from '../routes/archive.js';

export const SESSION_COOKIE = 'rtspatom_sid';
/**
 * Создаёт обработчик HTTP-запросов. Всё состояние приложения передаётся в app:
 * { db, config, log, sync, metrics }.
 */
export function createHandler(app) {
  const router = new Router();
  registerRoutes(router, app);

  app.viewers = new Map(); // `${sessionKey}|${streamId}` -> lastSeen
  app.apiHits = new Map(); // ip -> { start, count }
  app.startedAt = app.startedAt || Date.now();

  /** Зрителей сейчас: HLS (по недавним запросам плейлистов) + WebRTC (по данным MediaMTX). */
  app.viewersOf = (streamId) => {
    const now = Date.now();
    let n = 0;
    for (const [k, t] of app.viewers) if (k.endsWith(`|${streamId}`) && now - t < 20_000) n++;
    return n + (app.sync?.statusOf(streamId)?.webrtcReaders || 0);
  };
  app.activeViewerCount = () => {
    const now = Date.now();
    let n = 0;
    for (const t of app.viewers.values()) if (now - t < 20_000) n++;
    if (app.sync) for (const st of app.sync.status.values()) n += st.webrtcReaders || 0;
    return n;
  };

  const ruleStmt = app.db.prepare('SELECT * FROM ip_rules');
  const sessionStmt = app.db.prepare(
    `SELECT s.token_hash, s.expires_at, s.last_seen_at, s.ip AS session_ip, u.*
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  );
  const touchStmt = app.db.prepare(
    'UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?',
  );
  const dropSessionStmt = app.db.prepare('DELETE FROM sessions WHERE token_hash = ?');

  /**
   * Адрес клиента. trustProxy: true — панель стоит за прокси; 'loopback' (по умолчанию) — заголовку
   * X-Forwarded-For верим, только если соединение пришло с 127.0.0.1/::1 (SSH-туннель с внешнего
   * сервера, Caddy/nginx на этом же компьютере). Берётся последний адрес — его дописал ближайший
   * прокси; первый может подделать сам клиент.
   */
  app.clientIp = (req) => {
    const sock = normalizeIp(req.socket.remoteAddress);
    const mode = app.config.trustProxy;
    const trusted = mode === true || ((mode === 'loopback' || mode === undefined) && (sock === '127.0.0.1' || sock === '::1'));
    if (trusted) {
      const parts = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (parts.length) return normalizeIp(parts[parts.length - 1]);
    }
    return sock;
  };

  app.cookie = (token, maxAge) =>
    serializeCookie(SESSION_COOKIE, token, { maxAge, secure: !!app.config.tls?.enabled });

  function loadSession(req, ip) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const hash = sha256(token);
    const row = sessionStmt.get(hash);
    if (!row) return null;
    const now = Date.now();
    if (Date.parse(row.expires_at) <= now || !row.is_active) {
      dropSessionStmt.run(hash);
      return null;
    }
    const user = userFromRow(row);
    if (!userIpAllowed(user.allowedCidrs, ip)) return null;
    if (now - Date.parse(row.last_seen_at) > 60_000) {
      const ttl = getSettings(app.db).sessionTtl;
      touchStmt.run(new Date(now).toISOString(), new Date(now + ttl * 1000).toISOString(), hash);
    }
    return { user, tokenHash: hash };
  }

  function rateLimited(ip) {
    const limit = getSettings(app.db).rateLimitApi;
    const now = Date.now();
    let e = app.apiHits.get(ip);
    if (!e || now - e.start > 60_000) {
      e = { start: now, count: 0 };
      app.apiHits.set(ip, e);
    }
    e.count++;
    return e.count > limit;
  }

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [k, e] of app.apiHits) if (now - e.start > 60_000) app.apiHits.delete(k);
    for (const [k, t] of app.viewers) if (now - t > 30_000) app.viewers.delete(k);
  }, 60_000);
  cleanup.unref?.();

  return async function handle(req, res) {
    const ip = app.clientIp(req);
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const pathname = url.pathname;
    const isApi = pathname.startsWith('/api/');

    try {
      // Глобальный IP-фильтр применяется ко всем запросам.
      const ipCheck = checkIpRules(ruleStmt.all(), ip);
      if (!ipCheck.allowed) {
        throw new HttpError(403, `Доступ запрещён: ${ipCheck.reason}`);
      }

      if (pathname.startsWith('/webrtc/')) {
        if (rateLimited(ip)) throw new HttpError(429, 'Слишком много запросов, повторите позже');
        const session = loadSession(req, ip);
        return await handleWebrtc(app, req, res, url, session, ip);
      }

      if (pathname.startsWith('/archive/')) {
        if (rateLimited(ip)) throw new HttpError(429, 'Слишком много запросов, повторите позже');
        const session = loadSession(req, ip);
        return await handleArchiveVideo(app, req, res, url, session, ip);
      }

      if (pathname.startsWith('/hls/')) {
        const session = loadSession(req, ip);
        return await handleHls(app, req, res, url, session, ip);
      }

      if (!isApi) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Метод не поддерживается');
        return serveStatic(app.config.publicDir, req, res, pathname);
      }

      if (rateLimited(ip)) throw new HttpError(429, 'Слишком много запросов, повторите позже');

      const match = router.match(req.method, pathname);
      if (!match) throw new HttpError(404, 'Метод API не найден');
      if (match.methodNotAllowed) throw new HttpError(405, 'Метод не поддерживается');

      const { route, params } = match;
      const need = route.opts.auth ?? 'viewer';

      // Защита от CSRF: изменяющие запросы должны нести собственный заголовок,
      // который браузер не отправит с чужого сайта без CORS.
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-rtspatom'] !== '1') {
        throw new HttpError(403, 'Отсутствует заголовок X-RTSPAtom');
      }

      const session = loadSession(req, ip);
      if (need !== 'public') {
        if (!session) throw new HttpError(401, 'Требуется вход в систему');
        if (!hasRole(session.user, need)) throw new HttpError(403, 'Недостаточно прав');
      }

      let bodyCache;
      const ctx = {
        req, res, url, params, ip,
        query: url.searchParams,
        user: session?.user || null,
        session,
        json: async () => (bodyCache ??= await readJson(req)),
      };
      const result = await route.handler(ctx);
      if (res.writableEnded || res.headersSent) return;
      if (result === undefined) sendJson(res, 204);
      else sendJson(res, 200, result, SECURITY_HEADERS);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) {
        app.log.error('error', `Внутренняя ошибка ${req.method} ${pathname}: ${err.stack || err.message}`, { ip });
      }
      const message = status === 500 ? 'Внутренняя ошибка сервера' : err.message;
      if (isApi || /^\/(hls|webrtc|archive)\//.test(pathname)) {
        sendJson(res, status, { error: message, ...(err.extra || {}) });
      } else {
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
        res.end(message);
      }
    }
  };
}
