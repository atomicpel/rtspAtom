// Самовосстановление: если камера пропала или «зависла», проверяем, доступно ли устройство по сети,
// и только если доступно — переподключаем источник, а при повторных неудачах перезапускаем видеосервер.
// Частота действий ограничена, всё пишется в журнал.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { getSettings } from './settings.js';
import { pathNameFor, pathNameOf } from './mediamtx.js';

const TICK_MS = 10_000;
const DEAD_AFTER_MS = 20_000; // поток пропал или не присылает данных 20 с
const SOURCE_RESTART_EVERY_MS = 2 * 60_000; // переподключение одного источника — не чаще раза в 2 минуты
const SERVER_RESTART_EVERY_MS = 30 * 60_000; // перезапуск видеосервера — не чаще раза в 30 минут
const SERVER_RESTARTS_PER_DAY = 6;
const API_DOWN_MS = 60_000; // видеосервер не отвечает минуту — перезапуск
const RECORD_STALL_MS = 3 * 60_000; // запись не обновлялась 3 минуты при живом потоке
const UNREACHABLE_LOG_MS = 30 * 60_000;

const DEFAULT_PORTS = { 'rtsp:': 554, 'rtsps:': 322, 'rtmp:': 1935, 'http:': 80, 'https:': 443, 'srt:': 0 };

/** Адрес и порт устройства по адресу потока. */
export function targetOf(url) {
  try {
    const u = new URL(String(url || ''));
    if (!u.hostname || u.hostname === '0.0.0.0') return null;
    const port = Number(u.port) || DEFAULT_PORTS[u.protocol] || 0;
    return port ? { host: u.hostname, port } : null;
  } catch {
    return null;
  }
}

/** Доступно ли устройство: TCP-подключение к порту потока (работает и там, где ping запрещён). */
export function tcpReachable(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/** PID процесса MediaMTX того же пользователя (Linux). */
function findMediamtxPid() {
  if (process.platform !== 'linux') return null;
  const uid = process.getuid?.();
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0')[0];
      if (!/(^|\/)mediamtx(\.exe)?$/.test(cmd)) continue;
      const st = fs.readFileSync(`/proc/${d}/status`, 'utf8');
      const m = /^Uid:\s+(\d+)/m.exec(st);
      if (m && (uid === undefined || Number(m[1]) === uid)) return Number(d);
    } catch { /* процесс завершился */ }
  }
  return null;
}

export class Watchdog {
  constructor({ app, now = () => Date.now(), reachable = tcpReachable, killServer }) {
    this.app = app;
    this.now = now;
    this.reachable = reachable;
    // перезапуск видеосервера: служба systemd перезапускает его сама (Restart=always)
    this.killServer = killServer || (() => {
      const pid = findMediamtxPid();
      if (!pid) throw new Error('процесс видеосервера не найден');
      process.kill(pid, 'SIGTERM');
      return pid;
    });
    this.state = new Map(); // streamId -> { deadSince, lastBytes, bytesAt, lastRestart, failed, lastUnreachLog, recordRestart }
    this.serverRestarts = []; // времена перезапусков видеосервера
    this.apiDownSince = null;
    this.actions = []; // последние действия для страницы «Состояние»
    this.busy = false;
  }

  #act(level, msg, stream) {
    this.actions.unshift({ at: new Date(this.now()).toISOString(), level, message: msg });
    this.actions.length = Math.min(this.actions.length, 50);
    this.app.log[level]('stream', `Самовосстановление: ${msg}`, stream ? { stream } : {});
  }

  canRestartServer() {
    const now = this.now();
    this.serverRestarts = this.serverRestarts.filter((t) => now - t < 86400_000);
    const last = this.serverRestarts.length ? this.serverRestarts[this.serverRestarts.length - 1] : -Infinity;
    return now - last >= SERVER_RESTART_EVERY_MS && this.serverRestarts.length < SERVER_RESTARTS_PER_DAY;
  }

  restartServer(reason) {
    if (!getSettings(this.app.db).selfHealServer || !this.canRestartServer()) return false;
    try {
      this.killServer();
      this.serverRestarts.push(this.now());
      for (const s of this.state.values()) { s.failed = 0; s.deadSince = null; }
      this.#act('warn', `перезапускаю видеосервер MediaMTX — ${reason}. Служба поднимет его через несколько секунд.`);
      return true;
    } catch (err) {
      this.#act('error', `не удалось перезапустить видеосервер (${err.message}) — выполните: sudo systemctl restart rtspatom-mediamtx`);
      this.serverRestarts.push(this.now()); // не повторять каждые 10 с
      return false;
    }
  }

  #stateOf(id) {
    let s = this.state.get(id);
    if (!s) { s = { deadSince: null, lastBytes: null, bytesAt: this.now(), lastRestart: -Infinity, failed: 0, lastUnreachLog: -Infinity, recordRestart: -Infinity }; this.state.set(id, s); }
    return s;
  }

  async tick() {
    if (this.busy) return;
    const settings = getSettings(this.app.db);
    if (!settings.selfHeal) return;
    const sync = this.app.sync;
    if (!sync) return;
    this.busy = true;
    try {
      const now = this.now();
      // видеосервер не отвечает (завис)
      if (!sync.reachable) {
        this.apiDownSince ??= now;
        if (now - this.apiDownSince >= API_DOWN_MS && this.restartServer('он не отвечает больше минуты')) this.apiDownSince = null;
        return;
      }
      this.apiDownSince = null;

      const rows = this.app.db.prepare('SELECT * FROM streams WHERE is_active = 1').all();
      const stuck = [];
      for (const row of rows) {
        if (row.push_key) continue; // энкодер присылает поток сам — переподключать нечего
        const s = this.#stateOf(row.id);
        const st = sync.status.get(pathNameOf(row));
        // Запись может быть выключена (у камеры или вся — папка архива не задана). Тогда видеосервер держит
        // камеру подключённой, только если включено «Держать подключёнными постоянно»; иначе — «по запросу»:
        // без зрителей поток и не должен идти, проверяем его, только пока его кто-то смотрит.
        const recording = !!(sync.archiveDir && row.record);
        if (!settings.camerasAlwaysOn && !recording && !(st?.readers > 0)) {
          s.deadSince = null; s.failed = 0; s.lastBytes = null;
          continue;
        }
        const bytes = st?.bytesReceived ?? 0;
        if (s.lastBytes === null || bytes !== s.lastBytes) { s.lastBytes = bytes; s.bytesAt = now; }
        const stale = st?.ready && now - s.bytesAt >= DEAD_AFTER_MS; // «в сети», но данные не идут
        const dead = !st?.ready || stale;
        if (!dead) {
          if (s.failed) this.#act('info', `«${row.name}»: поток восстановился`, row.name);
          s.deadSince = null; s.failed = 0;
          if (recording) await this.#checkRecording(row, s, now);
          continue;
        }
        s.deadSince ??= now;
        if (now - s.deadSince < DEAD_AFTER_MS) continue;
        const t = targetOf(row.url);
        if (t) {
          const ok = await this.reachable(t.host, t.port);
          if (!ok) {
            if (now - s.lastUnreachLog >= UNREACHABLE_LOG_MS) {
              s.lastUnreachLog = now;
              this.#act('warn', `«${row.name}»: устройство ${t.host}:${t.port} не отвечает по сети — проблема в питании, кабеле или сети; перезапуск сервера не поможет`, row.name);
            }
            continue;
          }
        }
        if (now - s.lastRestart < SOURCE_RESTART_EVERY_MS) {
          if (s.failed >= 2) stuck.push(row.name);
          continue;
        }
        s.lastRestart = now;
        s.failed += 1;
        this.#act('info', `«${row.name}»: устройство доступно, но ${stale ? 'данные не идут' : 'потока нет'} ${Math.round((now - s.deadSince) / 1000)} с — переподключаю источник`, row.name);
        await sync.restartSource(row.id).catch(() => {});
      }
      // источник доступен, переподключение дважды не помогло — видеосервер, похоже, «застрял»
      if (stuck.length) this.restartServer(`не помогло переподключение: ${stuck.join(', ')}`);
    } finally {
      this.busy = false;
    }
  }

  /** Запись идёт? Поток жив, а файл архива не обновлялся 3 минуты — переподключаем источник. */
  async #checkRecording(row, s, now) {
    const dir = this.app.archive?.dir || this.app.sync?.archiveDir;
    // диск архива не подключён — переподключение камеры не поможет, об этом скажет страница «Состояние»
    if (!dir || this.app.archive?.mountProblem || now - s.recordRestart < 10 * 60_000) return;
    const sdir = path.join(dir, pathNameFor(row.id));
    let newest = 0;
    try {
      for (const f of await fs.promises.readdir(sdir)) {
        if (!f.endsWith('.mp4')) continue;
        const st = await fs.promises.stat(path.join(sdir, f)).catch(() => null);
        if (st && st.mtimeMs > newest) newest = st.mtimeMs;
      }
    } catch { return; } // каталога ещё нет — запись только началась
    if (newest && now - newest > RECORD_STALL_MS && now - (this.app.startedAt || 0) > RECORD_STALL_MS) {
      s.recordRestart = now;
      this.#act('warn', `«${row.name}»: поток идёт, а запись в архив не обновлялась ${Math.round((now - newest) / 60000)} мин — переподключаю источник`, row.name);
      await this.app.sync.restartSource(row.id).catch(() => {});
    }
  }

  start() {
    this.timer = setInterval(() => this.tick().catch((e) => this.app.log.error('error', `Самовосстановление: ${e.message}`)), TICK_MS);
    this.timer.unref?.();
  }

  stop() { clearInterval(this.timer); }
}
