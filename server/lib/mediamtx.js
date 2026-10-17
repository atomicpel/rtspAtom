import { newId } from './security.js';

export const PATH_PREFIX = 's_';
export const pathNameFor = (streamId) => `${PATH_PREFIX}${streamId}`;

/** Протоколы источников, которые MediaMTX умеет забирать сам. */
export const SOURCE_PROTOCOLS = {
  rtsp: ['rtsp:', 'rtsps:'],
  rtmp: ['rtmp:', 'rtmps:'],
  hls: ['http:', 'https:'],
  srt: ['srt:'],
  udp: ['udp:', 'udp+mpegts:'],
};

export function detectProtocol(url) {
  const s = String(url || '').trim().toLowerCase();
  for (const [proto, schemes] of Object.entries(SOURCE_PROTOCOLS)) {
    if (schemes.some((sc) => s.startsWith(sc))) return proto;
  }
  return null;
}

/** Подставляет логин/пароль камеры в URL источника (если их там ещё нет). */
export function buildSourceUrl(url, login, password) {
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    return String(url).trim();
  }
  if (login && !u.username) {
    u.username = login;
    u.password = password || '';
  }
  return u.toString();
}

/** URL для показа в интерфейсе — без пароля. */
export function redactUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return String(url);
  }
}

function trackNames(item) {
  const t = item?.tracks ?? item?.tracks2 ?? [];
  if (!Array.isArray(t)) return [];
  return t.map((x) => (typeof x === 'string' ? x : x?.codec || x?.type || '?'));
}

export class MediaMtxClient {
  constructor(apiUrl, { timeoutMs = 5000 } = {}) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async request(method, path, body) {
    let res;
    try {
      res = await fetch(this.apiUrl + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const why = err.cause?.code || (err.name === 'TimeoutError' ? 'нет ответа' : err.message);
      throw new Error(`нет связи с ${this.apiUrl} (${why})`);
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        msg = JSON.parse(text).error || text;
      } catch {
        /* ответ не JSON */
      }
      const err = new Error(`MediaMTX ${method} ${path}: ${res.status} ${msg}`.trim());
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }

  async info() {
    try {
      return await this.request('GET', '/v3/info');
    } catch {
      return null;
    }
  }

  async listConfigPaths() {
    const r = await this.request('GET', '/v3/config/paths/list?itemsPerPage=100000');
    return r?.items ?? [];
  }

  async listPaths() {
    const r = await this.request('GET', '/v3/paths/list?itemsPerPage=100000');
    return r?.items ?? [];
  }

  getPath(name) {
    return this.request('GET', `/v3/paths/get/${encodeURIComponent(name)}`);
  }

  async addPath(name, conf) {
    return this.#withTransportFallback(conf, (c) =>
      this.request('POST', `/v3/config/paths/add/${encodeURIComponent(name)}`, c),
    );
  }

  async replacePath(name, conf) {
    // replace сбрасывает поля, которых нет в conf, — поэтому старые настройки не «залипают».
    return this.#withTransportFallback(conf, (c) =>
      this.request('POST', `/v3/config/paths/replace/${encodeURIComponent(name)}`, c),
    );
  }

  deletePath(name) {
    return this.request('DELETE', `/v3/config/paths/delete/${encodeURIComponent(name)}`);
  }

  /**
   * Поле выбора транспорта RTSP называлось sourceProtocol в старых версиях
   * MediaMTX и rtspTransport в новых — пробуем оба варианта.
   */
  async #withTransportFallback(conf, send) {
    if (!conf.rtspTransport) return send(conf);
    try {
      return await send(conf);
    } catch (err) {
      if (err.status !== 400) throw err;
      const { rtspTransport, ...rest } = conf;
      return send({ ...rest, sourceProtocol: rtspTransport });
    }
  }

  /** Проверка источника: временный путь, ждём готовности до timeoutMs. */
  async probe(sourceUrl, { transport = 'auto', timeoutMs = 12000 } = {}) {
    const name = `probe_${newId().replace(/[^a-zA-Z0-9]/g, '')}`;
    const conf = { source: sourceUrl, sourceOnDemand: false };
    if (transport !== 'auto') conf.rtspTransport = transport;
    await this.addPath(name, conf);
    try {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        let item;
        try {
          item = await this.getPath(name);
        } catch {
          continue;
        }
        if (item?.ready) return { ok: true, tracks: trackNames(item) };
      }
      return { ok: false, tracks: [] };
    } finally {
      await this.deletePath(name).catch(() => {});
    }
  }
}

/**
 * Держит конфигурацию путей MediaMTX в соответствии с базой и
 * кеширует их состояние (готовность, зрители, трафик).
 */
export class StreamSync {
  constructor({ db, client, log, settings }) {
    this.db = db;
    this.client = client;
    this.log = log;
    this.settings = settings; // () => текущие настройки
    this.status = new Map(); // pathName -> { ready, readers, bytesReceived, bytesSent, tracks }
    this.reachable = false;
    this.lastError = '';
    this.lastSyncAt = null;
    this.version = null;
    this.prevReady = new Map();
    this.syncing = null;
    this.pending = false;
    this.timers = [];
  }

  desired() {
    const rows = this.db
      .prepare(
        `SELECT s.*, c.name AS computer_name FROM streams s
         JOIN computers c ON c.id = s.computer_id
         WHERE s.is_active = 1 AND c.is_active = 1`,
      )
      .all();
    const alwaysOn = this.settings().camerasAlwaysOn;
    const map = new Map();
    for (const s of rows) {
      const conf = {
        source: buildSourceUrl(s.url, s.source_login, s.source_password),
        sourceOnDemand: !alwaysOn,
      };
      if (s.protocol === 'rtsp' && s.transport !== 'auto') conf.rtspTransport = s.transport;
      map.set(pathNameFor(s.id), { conf, stream: s });
    }
    return map;
  }

  /** Запустить синхронизацию (повторные вызовы во время работы объединяются). */
  trigger() {
    if (this.syncing) {
      this.pending = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      try {
        do {
          this.pending = false;
          await this.#syncOnce();
        } while (this.pending);
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }

  async #syncOnce() {
    const want = this.desired();
    let current;
    try {
      current = await this.client.listConfigPaths();
      if (!this.reachable) {
        const info = await this.client.info();
        this.version = info?.version ?? null;
        this.log.info('stream', `MediaMTX доступен${this.version ? ` (версия ${this.version})` : ''}`);
      }
      this.reachable = true;
      this.lastError = '';
    } catch (err) {
      if (this.reachable || !this.lastError) {
        this.log.error('error', `MediaMTX недоступен: ${err.message}`);
      }
      this.reachable = false;
      this.lastError = err.message;
      return;
    }

    const have = new Map(
      current.filter((p) => p.name?.startsWith(PATH_PREFIX)).map((p) => [p.name, p]),
    );
    for (const [name] of have) {
      if (!want.has(name)) {
        await this.client.deletePath(name).catch((e) => this.#fail(name, e));
      }
    }
    for (const [name, { conf, stream }] of want) {
      const cur = have.get(name);
      try {
        if (!cur) {
          await this.client.addPath(name, conf);
        } else if (needsUpdate(cur, conf)) {
          await this.client.replacePath(name, conf);
        }
      } catch (e) {
        this.#fail(name, e, stream);
      }
    }
    this.lastSyncAt = new Date().toISOString();
    await this.refreshStatus();
  }

  #fail(name, err, stream) {
    this.log.error('stream', `Ошибка настройки потока в MediaMTX: ${err.message}`, {
      stream: stream?.name || name,
    });
  }

  async refreshStatus() {
    let items;
    const wasReachable = this.reachable;
    try {
      items = await this.client.listPaths();
      this.reachable = true;
      // MediaMTX появился (запустился позже панели) — сразу передаём ему камеры.
      if (!wasReachable && !this.syncing) this.trigger();
    } catch (err) {
      this.reachable = false;
      this.lastError = err.message;
      this.status.clear();
      return;
    }
    const next = new Map();
    for (const it of items) {
      next.set(it.name, {
        ready: !!it.ready,
        readers: Array.isArray(it.readers) ? it.readers.length : 0,
        bytesReceived: Number(it.bytesReceived) || 0,
        bytesSent: Number(it.bytesSent) || 0,
        tracks: trackNames(it),
      });
    }
    this.status = next;
    this.#logTransitions();
  }

  #logTransitions() {
    const want = this.desired();
    const onDemand = !this.settings().camerasAlwaysOn;
    for (const [name, { stream }] of want) {
      const ready = !!this.status.get(name)?.ready;
      const prev = this.prevReady.get(name);
      if (prev === undefined) {
        this.prevReady.set(name, ready);
        continue;
      }
      if (prev !== ready) {
        this.prevReady.set(name, ready);
        const label = `${stream.computer_name} / ${stream.name}`;
        if (ready) this.log.info('stream', `Поток в сети: ${label}`, { stream: stream.name });
        else if (!onDemand) this.log.warn('stream', `Поток недоступен: ${label}`, { stream: stream.name });
      }
    }
    for (const name of [...this.prevReady.keys()]) if (!want.has(name)) this.prevReady.delete(name);
  }

  /** online | reconnecting | idle | offline */
  streamState(streamRow, computerActive) {
    if (!streamRow.is_active || !computerActive) return 'offline';
    if (!this.reachable) return 'offline';
    const st = this.status.get(pathNameFor(streamRow.id));
    if (st?.ready) return 'online';
    return this.settings().camerasAlwaysOn ? 'reconnecting' : 'idle';
  }

  start({ syncEveryMs = 30000, statusEveryMs = 5000 } = {}) {
    this.trigger();
    this.timers.push(setInterval(() => this.trigger(), syncEveryMs));
    this.timers.push(
      setInterval(() => {
        if (!this.syncing) this.refreshStatus();
      }, statusEveryMs),
    );
    for (const t of this.timers) t.unref?.();
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }
}

function needsUpdate(cur, conf) {
  if (cur.source !== conf.source) return true;
  if (!!cur.sourceOnDemand !== !!conf.sourceOnDemand) return true;
  const curTransport = cur.rtspTransport ?? cur.sourceProtocol ?? 'automatic';
  const wantTransport = conf.rtspTransport ?? 'automatic';
  return curTransport !== wantTransport;
}
