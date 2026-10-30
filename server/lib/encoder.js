// Управление HDMI-энкодерами через их веб-интерфейс (get_output / set_output, прошивки 6.x)
// и автоподстройка битрейта под пропускную способность канала.
//
// Энкодер принимает настройки выхода одним GET-запросом set_output со ВСЕМИ полями выхода.
// Поэтому панель сначала читает текущие настройки (get_output) и меняет только битрейт;
// если прочитать все поля не удалось — ничего не отправляет (иначе энкодер сбросит остальное).
import { pathNameOf } from './mediamtx.js';
import { parseJson } from './db.js';

// Поля запроса set_output в том порядке, в каком их отправляет страница энкодера
export const SET_KEYS = [
  'venc_framerate', 'venc_gop', 'venc_width', 'venc_height', 'venc_rc_mode', 'venc_bitrate',
  'http_ts_uri', 'http_flv_uri', 'rtsp_uri', 'rtmp_enable', 'rtmp_uri', 'rtmp_publish_uri', 'rtmp_publish_enable',
  'http_ts_enable', 'http_flv_enable', 'rtsp_enable', 'venc_profile', 'http_hls_uri', 'http_hls_enable',
  'multicast_ip', 'multicast_port', 'multicast_enable', 'venc_codec', 'venc_width_height_same_as_input',
];

export const ENCODER_DEFAULTS = { enabled: false, auto: false, host: '', login: 'admin', password: '', output: null, minKbps: 600, maxKbps: 2000 };

// Общие для всех энкодеров логин, пароль и пределы (Состояние → Энкодеры); у потока можно задать свои
let shared = {};
export function setEncoderDefaults(d) { shared = { ...(d || {}) }; }
export function encoderDefaults() { return { ...ENCODER_DEFAULTS, ...shared }; }

/** Настройки энкодера потока (из столбца encoder, пустые поля — из общих). */
export function encoderOf(row) {
  const own = parseJson(row?.encoder, {});
  const e = { ...ENCODER_DEFAULTS, ...shared, ...own };
  if (!own.password && shared.password) { e.password = shared.password; e.login = own.login && own.login !== 'admin' ? own.login : shared.login || e.login; }
  if (own.minKbps === undefined && shared.minKbps) e.minKbps = shared.minKbps;
  if (own.maxKbps === undefined && shared.maxKbps) e.maxKbps = shared.maxKbps;
  if (!e.host) e.host = hostOf(row?.url);
  return e;
}

/** Адрес энкодера по адресу потока: rtsp://11.196.27.131:8554/10 → 11.196.27.131 */
export function hostOf(url) {
  try {
    const u = new URL(String(url || ''));
    return u.hostname || '';
  } catch {
    return '';
  }
}

/** Путь RTSP потока (/10) — по нему выбирается выход энкодера. */
function rtspPathOf(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol.startsWith('rtsp') ? u.pathname || '' : '';
  } catch {
    return '';
  }
}

const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s) => String(s).replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (m, e) => (e[0] === '#' ? String.fromCharCode(Number(e.slice(1))) : XML_ENT[e]));

/** Ответ get_output (XML: <поле>значение</поле> или атрибуты поле="значение") → { поле: значение } */
export function parseOutput(text) {
  const out = {};
  const s = String(text || '');
  for (const m of s.matchAll(/<([A-Za-z_][\w]*)(?:\s[^>]*)?>([^<]*)<\/\1>/g)) out[m[1]] = unxml(m[2].trim());
  for (const m of s.matchAll(/\b([A-Za-z_][\w]*)\s*=\s*"([^"]*)"/g)) if (!(m[1] in out) && m[1] !== 'version' && m[1] !== 'encoding') out[m[1]] = unxml(m[2]);
  // запасной вариант: строки «поле=значение»
  if (!Object.keys(out).length) {
    for (const m of s.matchAll(/^\s*([A-Za-z_][\w]*)\s*[=:]\s*(.*?)\s*$/gm)) out[m[1]] = m[2];
  }
  return out;
}

// Кодирование как у страницы энкодера: «/» и «.» не трогаем, остальное — как encodeURIComponent
const enc = (v) => encodeURIComponent(String(v)).replace(/%2F/gi, '/');

/** Запрос set_output: все поля из текущих настроек, меняются только changes. */
export function buildSetQuery(input, output, current, changes) {
  const missing = SET_KEYS.filter((k) => changes[k] === undefined && current[k] === undefined);
  if (missing.length) {
    const err = new Error(`энкодер не сообщил поля: ${missing.join(', ')} — менять настройки опасно, запрос не отправлен`);
    err.code = 'MISSING_FIELDS';
    throw err;
  }
  const parts = [`input=${input}`, `output=${output}`];
  // «Как у источника»: страница энкодера шлёт ширину и высоту 0 (get_output отдаёт фактические 1920×1080)
  const same = String(changes.venc_width_height_same_as_input ?? current.venc_width_height_same_as_input) === '1';
  for (const k of SET_KEYS) {
    let v = changes[k] !== undefined ? changes[k] : current[k];
    if (same && (k === 'venc_width' || k === 'venc_height') && changes[k] === undefined) v = 0;
    parts.push(`${k}=${k === 'rtmp_publish_uri' ? encodeURIComponent(String(v)) : enc(v)}`);
  }
  parts.push(`_=${Date.now()}`);
  return parts.join('&');
}

async function encGet(e, pathAndQuery, timeoutMs = 6000) {
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  if (e.login || e.password) headers.Authorization = `Basic ${Buffer.from(`${e.login}:${e.password}`).toString('base64')}`;
  let res;
  try {
    res = await fetch(`http://${e.host}${pathAndQuery}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const why = err.cause?.code || (err.name === 'TimeoutError' ? 'нет ответа' : err.message);
    throw new Error(`энкодер ${e.host} недоступен (${why})`);
  }
  const text = await res.text();
  if (res.status === 401) throw new Error(`энкодер ${e.host}: неверный логин или пароль`);
  if (!res.ok) throw new Error(`энкодер ${e.host}: ответ ${res.status}`);
  return text;
}

/** Текущие настройки выхода энкодера. */
export async function readOutput(e, output, input = 0) {
  const text = await encGet(e, `/get_output?input=${input}&output=${output}&_=${Date.now()}`);
  return { fields: parseOutput(text), raw: text };
}

/** Какой выход энкодера отдаёт этот поток: по совпадению rtsp_uri. */
export async function detectOutput(e, streamUrl) {
  const want = rtspPathOf(streamUrl);
  const found = [];
  for (const output of [0, 1]) {
    try {
      const r = await readOutput(e, output);
      found.push({ output, ...r });
      if (want && r.fields.rtsp_uri === want) return { output, ...r, matched: true };
    } catch (err) {
      if (output === 0) throw err;
    }
  }
  if (e.output !== null && e.output !== undefined) {
    const f = found.find((x) => x.output === Number(e.output));
    if (f) return { ...f, matched: false };
  }
  return { ...(found[0] || { output: 0, fields: {}, raw: '' }), matched: false };
}

/** Краткая сводка для интерфейса. */
export function summary(fields) {
  const n = (k) => (fields[k] === undefined || fields[k] === '' ? null : Number(fields[k]));
  return {
    bitrate: n('venc_bitrate'), framerate: n('venc_framerate'), gop: n('venc_gop'),
    rcMode: fields.venc_rc_mode ?? null, profile: fields.venc_profile ?? null, rtspUri: fields.rtsp_uri ?? null,
    missing: SET_KEYS.filter((k) => fields[k] === undefined),
  };
}

/**
 * Меняет битрейт выхода: читает все поля, отправляет set_output, проверяет результат.
 * Возвращает новый битрейт и прежние поля (для отката).
 */
export async function setBitrate(e, output, kbps, { withPrevious = false } = {}) {
  const { fields } = await readOutput(e, output);
  const q = buildSetQuery(0, output, fields, { venc_bitrate: kbps });
  await encGet(e, `/set_output?${q}`, 10000);
  // энкодер применяет настройки и перезапускает выход — проверяем, что битрейт записался
  await new Promise((r) => { const t = setTimeout(r, 1500); t.unref?.(); });
  const after = await readOutput(e, output);
  const got = Number(after.fields.venc_bitrate);
  if (got !== Number(kbps)) throw new Error(`энкодер ${e.host} не применил битрейт: просили ${kbps}, стоит ${after.fields.venc_bitrate}`);
  return withPrevious ? { bitrate: got, previous: fields } : got;
}

/** Вернуть выходу прежние настройки целиком (откат). */
export async function restoreFields(e, output, previous) {
  const q = buildSetQuery(0, output, previous, {});
  await encGet(e, `/set_output?${q}`, 10000);
}

/**
 * После смены настроек энкодер перезапускает кодирование, но RTSP-сеанс может остаться прежним —
 * с «прыгнувшими» метками времени (MediaMTX: «DTS is not monotonically increasing», «sample timestamp is
 * impossible to handle»), и браузеры показывают «Нет сигнала». Поэтому переподключаем источник в MediaMTX
 * и ждём, пока поток снова пойдёт.
 */
export async function reconnectAndWait(sync, client, streamId, { timeoutMs = 30_000, settleMs = 2500 } = {}) {
  if (!sync || !client) return true;
  await new Promise((r) => { const t = setTimeout(r, settleMs); t.unref?.(); });
  await sync.restartSource(streamId);
  const name = sync.pathById.get(streamId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => { const t = setTimeout(r, 1000); t.unref?.(); });
    try {
      const p = await client.getPath(name);
      if (p?.ready || p?.online) return true;
    } catch { /* путь ещё создаётся */ }
  }
  return false;
}

/** Меняет несколько полей выхода и проверяет, что энкодер их принял. */
export async function setFields(e, output, changes) {
  const { fields } = await readOutput(e, output);
  const diff = Object.fromEntries(Object.entries(changes).filter(([k, v]) => String(fields[k]) !== String(v)));
  if (!Object.keys(diff).length) return { changed: {}, fields };
  const q = buildSetQuery(0, output, fields, diff);
  await encGet(e, `/set_output?${q}`, 10000);
  await new Promise((r) => { const t = setTimeout(r, 1500); t.unref?.(); });
  const after = await readOutput(e, output);
  const bad = Object.keys(diff).filter((k) => String(after.fields[k]) !== String(diff[k]));
  if (bad.length) throw new Error(`энкодер ${e.host} не применил: ${bad.join(', ')}`);
  return { changed: diff, fields: after.fields };
}

/**
 * Рекомендуемые настройки для показа с минимальной задержкой и устойчивостью:
 * опорный кадр раз в секунду (GOP = частоте кадров), лишние выходы выключены, RTSP включён.
 * Режим кодирования и профиль не трогаем: их числовые значения у прошивок различаются.
 */
export async function applyRecommended(e, output) {
  const { fields } = await readOutput(e, output);
  const fps = Number(fields.venc_framerate) || 25;
  return setFields(e, output, {
    venc_gop: fps, rtsp_enable: 1,
    http_hls_enable: 0, http_ts_enable: 0, http_flv_enable: 0, rtmp_enable: 0, rtmp_publish_enable: 0, multicast_enable: 0,
  });
}

// ---------- Автоподстройка ----------

const TICK_MS = 30_000;
const BAD_FRAMES = 3; // испорченных кадров за 30 с — «плохой» замер
const DOWN_AFTER_BAD = 2; // два плохих замера подряд (минута) — снижаем
const DOWN_COOLDOWN_MS = 3 * 60_000; // после изменения ждём: энкодер перезапускает выход, первые секунды бывают с ошибками
const UP_CLEAN_MS = 20 * 60_000; // 20 минут без потерь — пробуем поднять
const CEILING_MS = 6 * 3600_000; // если подъём снова дал потери — 6 часов выше не поднимаемся
const GRACE_MS = 60_000; // после изменения минуту не судим: энкодер и источник перезапускаются
const STEP_DOWN = 0.8;
const STEP_UP = 1.15;
const round50 = (v) => Math.max(50, Math.round(v / 50) * 50);

export class EncoderTuner {
  constructor({ db, log, client, sync = null, now = () => Date.now(), reconnect = reconnectAndWait }) {
    this.db = db;
    this.log = log;
    this.client = client;
    this.sync = sync;
    this.reconnect = reconnect;
    this.now = now;
    this.state = new Map(); // streamId -> { lastErr, bad, cleanSince, lastChange, lastDir, prevKbps, ceiling, ceilingUntil, current, output, lastWarn }
    this.timer = null;
    this.busy = false;
  }

  stateOf(id) {
    let s = this.state.get(id);
    if (!s) {
      s = { lastErr: null, bad: 0, cleanSince: this.now(), lastChange: 0, lastDir: 0, prevKbps: null, ceiling: null, ceilingUntil: 0, current: null, output: null, lastWarn: 0, lastNote: '' };
      this.state.set(id, s);
    }
    return s;
  }

  /** Что показать в интерфейсе. */
  info(id) {
    const s = this.state.get(id);
    if (!s) return null;
    return {
      currentKbps: s.current, output: s.output, lastChange: s.lastChange ? new Date(s.lastChange).toISOString() : null,
      lastNote: s.lastNote, ceilingKbps: s.ceiling && s.ceilingUntil > this.now() ? s.ceiling : null,
    };
  }

  forget(id) { this.state.delete(id); }

  #warn(row, s, msg) {
    if (this.now() - s.lastWarn < 3600_000) return;
    s.lastWarn = this.now();
    this.log.warn('stream', `Автоподстройка «${row.name}»: ${msg}`, { stream: row.name });
  }

  async #change(row, e, s, kbps, why) {
    const from = s.current;
    let previous = null;
    try {
      if (s.output === null) {
        const d = await detectOutput(e, row.url);
        s.output = d.output;
      }
      const r = await setBitrate(e, s.output, kbps, { withPrevious: true });
      previous = r.previous;
      s.current = r.bitrate;
      s.lastChange = this.now();
      s.lastErr = null; // счётчик ошибок после перезапуска источника начнётся заново
      s.bad = 0;
      s.cleanSince = this.now();
      // источник переподключаем и ждём, что поток пошёл; нет — откат и автоподстройка этого потока выключается
      const ok = await this.reconnect(this.sync, this.client, row.id);
      if (!ok) {
        try {
          await restoreFields(e, s.output, previous);
          await this.reconnect(this.sync, this.client, row.id);
        } catch { /* сообщим ниже */ }
        s.current = from;
        this.#disable(row);
        this.log.error('stream', `Автоподстройка «${row.name}»: после смены битрейта ${from} → ${kbps} поток не вернулся за 30 с — `
          + 'прежние настройки энкодера восстановлены, автоподстройка этого потока выключена', { stream: row.name });
        return;
      }
      s.prevKbps = from;
      s.lastDir = kbps < from ? -1 : 1;
      s.lastNote = `${kbps < from ? 'снижен' : 'повышен'}: ${why}`;
      this.log.info('stream', `Автоподстройка «${row.name}»: ${why} — битрейт ${from} → ${kbps} Кбит/с`, { stream: row.name });
    } catch (err) {
      this.#warn(row, s, err.message);
    }
  }

  #disable(row) {
    try {
      const own = JSON.parse(row.encoder || '{}');
      this.db.prepare('UPDATE streams SET encoder = ? WHERE id = ?').run(JSON.stringify({ ...own, auto: false }), row.id);
    } catch { /* не критично */ }
  }

  async tickOne(row, path) {
    const e = encoderOf(row);
    if (!e.enabled || !e.auto || !e.host) return;
    const s = this.stateOf(row.id);
    const min = Math.max(100, Number(e.minKbps) || 600);
    const max = Math.max(min, Number(e.maxKbps) || 2000);
    if (s.current === null) {
      try {
        const d = await detectOutput(e, row.url);
        s.output = d.output;
        s.current = Number(d.fields.venc_bitrate) || null;
        if (!s.current) throw new Error('энкодер не сообщил текущий битрейт');
      } catch (err) {
        this.#warn(row, s, err.message);
        return;
      }
    }
    const err = Number(path?.inboundFramesInError);
    if (!path || !Number.isFinite(err)) return; // поток не в сети или старый MediaMTX — решать не по чему
    const delta = s.lastErr === null || err < s.lastErr ? 0 : err - s.lastErr;
    s.lastErr = err;
    const now = this.now();
    if (now - s.lastChange < GRACE_MS) return; // первая минута после перезапуска источника — не в счёт
    if (delta >= BAD_FRAMES) {
      s.bad += 1;
      s.cleanSince = now;
    } else {
      s.bad = 0;
    }

    if (s.current > max) return this.#change(row, e, s, max, `выше заданного максимума ${max}`);
    if (s.bad >= DOWN_AFTER_BAD && now - s.lastChange >= DOWN_COOLDOWN_MS && s.current > min) {
      // подъём недавно — значит, канал его не тянет: запоминаем потолок
      if (s.lastDir === 1 && s.prevKbps && now - s.lastChange < 15 * 60_000) {
        s.ceiling = s.prevKbps;
        s.ceilingUntil = now + CEILING_MS;
      }
      const next = Math.max(min, round50(s.current * STEP_DOWN));
      if (next < s.current) return this.#change(row, e, s, next, `испорченных кадров ${delta} за 30 с`);
    }
    const cap = s.ceiling && s.ceilingUntil > now ? Math.min(max, s.ceiling) : max;
    if (s.current < cap && now - s.cleanSince >= UP_CLEAN_MS && now - s.lastChange >= UP_CLEAN_MS) {
      const next = Math.min(cap, round50(s.current * STEP_UP));
      if (next > s.current) return this.#change(row, e, s, next, 'потерь нет 20 минут');
    }
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const rows = this.db.prepare('SELECT * FROM streams WHERE is_active = 1').all().filter((r) => encoderOf(r).enabled && encoderOf(r).auto);
      if (!rows.length) return;
      let paths = [];
      try { paths = await this.client.listPaths(); } catch { return; }
      const byName = new Map(paths.map((p) => [p.name, p]));
      for (const row of rows) {
        const p = byName.get(pathNameOf(row));
        await this.tickOne(row, p && (p.ready || p.online) ? p : null);
      }
    } finally {
      this.busy = false;
    }
  }

  start() {
    this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS);
    this.timer.unref?.();
  }

  stop() { clearInterval(this.timer); }
}
