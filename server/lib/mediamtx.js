import fs from 'node:fs';
import path from 'node:path';
import { newId } from './security.js';

export const PATH_PREFIX = 's_';
/** Пути потоков, которые энкодер отправляет сам: live/<ключ> (RTMP: приложение live, ключ потока). */
export const PUSH_PREFIX = 'live/';
export const pathNameFor = (streamId) => `${PATH_PREFIX}${streamId}`;
/** Имя пути MediaMTX для строки потока из базы. */
export const pathNameOf = (row) => (row.push_key ? `${PUSH_PREFIX}${row.push_key}` : pathNameFor(row.id));
const isManagedPath = (name) => !!name && (name.startsWith(PATH_PREFIX) || name.startsWith(PUSH_PREFIX));

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

/**
 * Транспорт RTSP. «Автоматически» у MediaMTX — сначала UDP, а он в обычной сети теряет пакеты
 * (рассыпается картинка, падает HLS). Поэтому «авто» = TCP; UDP — только если выбран явно.
 */
export function rtspTransportFor(transport) {
  return transport === 'udp' ? 'udp' : 'tcp';
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

/** Имя пути в адресе API: слэши (live/<ключ>) остаются слэшами. */
const encPath = (name) => encodeURIComponent(name).replace(/%2F/gi, '/');

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
    return this.request('GET', `/v3/paths/get/${encPath(name)}`);
  }

  async addPath(name, conf) {
    return this.#withTransportFallback(conf, (c) =>
      this.request('POST', `/v3/config/paths/add/${encPath(name)}`, c),
    );
  }

  async replacePath(name, conf) {
    // replace сбрасывает поля, которых нет в conf, — поэтому старые настройки не «залипают».
    return this.#withTransportFallback(conf, (c) =>
      this.request('POST', `/v3/config/paths/replace/${encPath(name)}`, c),
    );
  }

  deletePath(name) {
    return this.request('DELETE', `/v3/config/paths/delete/${encPath(name)}`);
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
    if (sourceUrl.startsWith('rtsp')) conf.rtspTransport = rtspTransportFor(transport);
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
  constructor({ db, client, log, settings, archiveDir = '', relayUrl = 'rtsp://127.0.0.1:8554' }) {
    this.db = db;
    this.archiveDir = archiveDir; // каталог архива; пусто — запись выключена совсем
    this.relayUrl = relayUrl.replace(/\/+$/, ''); // RTSP-сервер MediaMTX на 127.0.0.1
    this.client = client;
    this.log = log;
    this.settings = settings; // () => текущие настройки
    this.status = new Map(); // pathName -> { ready, readers, bytesReceived, bytesSent, tracks }
    this.pathById = new Map(); // streamId -> pathName (по последнему чтению базы)
    this.reachable = false;
    this.lastError = '';
    this.lastSyncAt = null;
    this.version = null;
    this.prevReady = new Map();
    this.syncing = null;
    this.pending = false;
    this.timers = [];
  }

  /**
   * Параметры записи. Архив потока всегда в пути s_<id> (каталог <архив>/s_<id>), поэтому смена ключа
   * энкодера и отключение потока не разрывают архив. MediaMTX требует %path в recordPath.
   */
  archiveConf() {
    if (!this.archiveDir) return {};
    const days = this.settings().archiveDays || 14;
    return {
      recordPath: `${this.archiveDir.replace(/\\/g, '/')}/%path/%Y-%m-%d_%H-%M-%S-%f`,
      recordFormat: 'fmp4',
      recordSegmentDuration: '10m',
      recordDeleteAfter: `${days * 24}h`,
    };
  }

  /** Есть ли у потока записи на диске. */
  hasRecordings(streamId) {
    if (!this.archiveDir) return false;
    try {
      return fs.readdirSync(path.join(this.archiveDir, pathNameFor(streamId))).some((f) => f.endsWith('.mp4'));
    } catch {
      return false;
    }
  }

  desired() {
    const rows = this.db.prepare('SELECT * FROM streams').all();
    const alwaysOn = this.settings().camerasAlwaysOn;
    const map = new Map();
    const byId = new Map();
    for (const s of rows) {
      if (!s.is_active) {
        // Отключённый поток с записями: путь без источника, только чтобы архив можно было смотреть
        // и чтобы MediaMTX продолжал удалять старые записи. Публиковать в s_* нельзя (authInternalUsers).
        if (this.hasRecordings(s.id)) {
          const name = pathNameFor(s.id);
          map.set(name, { conf: { source: 'publisher', record: false, ...this.archiveConf() }, stream: s, archiveOnly: true });
          byId.set(s.id, name);
        }
        continue;
      }
      if (s.push_key) {
        // Энкодер публикует сам: путь ждёт входящий поток по секретному имени
        const name = pathNameOf(s);
        map.set(name, { conf: { source: 'publisher' }, stream: s });
        byId.set(s.id, name);
        // Архив: s_<id> забирает поток энкодера через локальный RTSP и пишет его на диск
        if (this.archiveDir && s.record) {
          map.set(pathNameFor(s.id), {
            conf: {
              source: `${this.relayUrl}/${name}`, sourceOnDemand: false, rtspTransport: 'tcp', record: true, ...this.archiveConf(),
            },
            stream: s,
            archiveOnly: true,
          });
        } else if (this.hasRecordings(s.id)) {
          map.set(pathNameFor(s.id), { conf: { source: 'publisher', record: false, ...this.archiveConf() }, stream: s, archiveOnly: true });
        }
        continue;
      }
      // Запись не считается зрителем: камеру с записью в режиме «по запросу» всё равно держим подключённой
      const conf = { source: buildSourceUrl(s.url, s.source_login, s.source_password), sourceOnDemand: !alwaysOn && !this.#recording(s) };
      if (s.protocol === 'rtsp') conf.rtspTransport = rtspTransportFor(s.transport);
      if (this.archiveDir) Object.assign(conf, { record: !!s.record, ...this.archiveConf() });
      const name = pathNameOf(s);
      map.set(name, { conf, stream: s });
      byId.set(s.id, name);
    }
    this.pathById = byId;
    this.lastWanted = map;
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
      const info = await this.client.info();
      if (!this.reachable) {
        this.version = info?.version ?? null;
        this.log.info('stream', `MediaMTX доступен${this.version ? ` (версия ${this.version})` : ''}`);
      } else if (info?.started && this.started && info.started !== this.started) {
        // перезапуск между опросами: пути заданы заново ниже, но в журнале это должно быть видно
        this.log.warn('stream', `Видеосервер MediaMTX был перезапущен (запущен в ${new Date(info.started).toLocaleTimeString('ru-RU')}); камеры подключены заново`);
      }
      if (info?.started) this.started = info.started;
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
      current.filter((p) => isManagedPath(p.name)).map((p) => [p.name, p]),
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
      if (this.reachable) this.log.error('error', `MediaMTX недоступен: ${err.message}`);
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
        // Зрители WebRTC видны в MediaMTX как читатели типа webRTCSession
        webrtcReaders: Array.isArray(it.readers) ? it.readers.filter((r) => /webrtc/i.test(r?.type || '')).length : 0,
        bytesReceived: Number(it.bytesReceived) || 0,
        bytesSent: Number(it.bytesSent) || 0,
        tracks: trackNames(it),
      });
    }
    this.status = next;
    this.#logTransitions();
  }

  #logTransitions() {
    // последний расчёт путей (раз в 5 с не читаем базу и каталоги архива заново)
    const want = this.lastWanted || this.desired();
    const onDemand = !this.settings().camerasAlwaysOn;
    for (const [name, { stream, archiveOnly }] of want) {
      if (archiveOnly) continue;
      const ready = !!this.status.get(name)?.ready;
      const prev = this.prevReady.get(name);
      if (prev === undefined) {
        this.prevReady.set(name, ready);
        continue;
      }
      if (prev !== ready) {
        this.prevReady.set(name, ready);
        const label = stream.name;
        if (ready) this.log.info('stream', `Поток в сети: ${label}`, { stream: stream.name });
        else if (!onDemand || stream.push_key || this.#recording(stream)) this.log.warn('stream', `Поток недоступен: ${label}`, { stream: stream.name });
      }
    }
    for (const name of [...this.prevReady.keys()]) if (!want.has(name)) this.prevReady.delete(name);
  }

  /** online | reconnecting | idle | offline */
  streamState(streamRow) {
    if (!streamRow.is_active) return 'offline';
    if (!this.reachable) return 'offline';
    const st = this.status.get(pathNameOf(streamRow));
    if (st?.ready) return 'online';
    if (streamRow.push_key) return 'reconnecting'; // энкодер ещё не прислал поток
    return this.settings().camerasAlwaysOn || this.#recording(streamRow) ? 'reconnecting' : 'idle';
  }

  /** Поток пишется в архив (значит, подключён постоянно, даже в режиме «по запросу»). */
  #recording(row) {
    return !!(this.archiveDir && row.record);
  }

  /** Состояние пути по id потока (для счёта зрителей и списка потоков). */
  statusOf(streamId) {
    return this.status.get(this.pathById.get(streamId) || pathNameFor(streamId));
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

/** Длительность Go («336h0m0s», «10m») или число секунд → секунды. */
export function durationSec(v) {
  if (typeof v === 'number') return v;
  let total = 0;
  for (const [, n, u] of String(v || '').matchAll(/([\d.]+)(h|ms|m|s)/g)) {
    total += Number(n) * (u === 'h' ? 3600 : u === 'm' ? 60 : u === 's' ? 1 : 0.001);
  }
  return total;
}

function recordChanged(cur, conf) {
  if (conf.recordPath === undefined) return false;
  if (!!cur.record !== !!conf.record) return true;
  if ((cur.recordPath || '') !== conf.recordPath) return true;
  if ((cur.recordFormat || 'fmp4') !== conf.recordFormat) return true;
  if (durationSec(cur.recordSegmentDuration) !== durationSec(conf.recordSegmentDuration)) return true;
  return durationSec(cur.recordDeleteAfter) !== durationSec(conf.recordDeleteAfter);
}

function needsUpdate(cur, conf) {
  if (cur.source !== conf.source) return true;
  if (recordChanged(cur, conf)) return true;
  if (conf.source === 'publisher') return false;
  if (!!cur.sourceOnDemand !== !!conf.sourceOnDemand) return true;
  const curTransport = cur.rtspTransport ?? cur.sourceProtocol ?? 'automatic';
  const wantTransport = conf.rtspTransport ?? 'automatic';
  return curTransport !== wantTransport;
}
