import fs from 'node:fs';
import path from 'node:path';
import { filesWord, fmtSize, mountOf } from './archivedir.js';

const GB = 1024 ** 3;
const ACTIVE_MS = 3 * 60 * 1000; // файл, изменённый за последние 3 минуты, — идущая запись, его не трогаем
const QUIET_MS = 20_000; // при переносе: файл, менявшийся последние 20 с, ещё дописывается — ждём
const QUIET_WAIT_MAX_MS = 10 * 60_000; // дольше не ждём: значит, запись в старую папку уже не идёт
// Имя сегмента MediaMTX по шаблону %Y-%m-%d_%H-%M-%S-%f
const SEGMENT_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(\d{6})\.mp4$/;

/** Время начала сегмента по имени файла (местное время сервера), мс; null — не сегмент. */
export function segmentStart(file) {
  const m = SEGMENT_RE.exec(file);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, us] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi, s, Math.floor(us / 1000)).getTime();
}

/**
 * Обслуживание архива: статистика по потокам и диску, защита от переполнения диска
 * (удаление самых старых записей, когда свободного места меньше порога), удаление архива потока.
 * Срок хранения соблюдает сам MediaMTX (recordDeleteAfter).
 */
export class ArchiveManager {
  constructor({ dir, log, settings, statfs = (p) => fs.promises.statfs(p), quietMs = QUIET_MS }) {
    this.dir = dir;
    this.quietMs = quietMs;
    this.log = log;
    this.settings = settings;
    this.statfs = statfs;
    this.cache = null;
    this.timers = [];
    this.guarding = false;
    this.relocation = null; // ход переноса записей в новую папку
    this.expectedMount = null; // точка монтирования, на которой должна лежать папка архива (Linux)
    this.mountProblem = '';
  }

  async #disk(dir = this.dir) {
    try {
      const s = await this.statfs(dir);
      return { free: Number(s.bavail) * Number(s.bsize), size: Number(s.blocks) * Number(s.bsize) };
    } catch {
      return null;
    }
  }

  /** Все сегменты: [{ stream, file, full, start, size, mtime }], по времени начала. */
  async #segments(dir = this.dir) {
    const out = [];
    let streams = [];
    try {
      streams = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const d of streams) {
      // каталоги архива — по именам путей MediaMTX: s_<id потока>
      if (!d.isDirectory() || !d.name.startsWith('s_')) continue;
      const sdir = path.join(dir, d.name);
      const streamId = d.name.slice(2);
      let files = [];
      try {
        files = await fs.promises.readdir(sdir);
      } catch {
        continue;
      }
      for (const f of files) {
        const start = segmentStart(f);
        if (start === null) continue;
        try {
          const st = await fs.promises.stat(path.join(sdir, f));
          out.push({ stream: streamId, sdir: d.name, file: f, full: path.join(sdir, f), start, size: st.size, mtime: st.mtimeMs });
        } catch {
          /* файл удалён между readdir и stat */
        }
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  /** Сводка: объём по потокам, самая старая запись, свободное место, примерная ёмкость в сутках. */
  async refresh() {
    const segs = await this.#segments();
    const streams = {};
    for (const s of segs) {
      const e = (streams[s.stream] ??= { bytes: 0, files: 0, oldest: s.start, newest: s.start });
      e.bytes += s.size;
      e.files += 1;
      e.newest = Math.max(e.newest, s.start);
    }
    const now = Date.now();
    let bytesPerDay = 0;
    for (const e of Object.values(streams)) {
      // скорость записи потока: объём / покрытое время (не меньше часа, чтобы первые минуты не искажали оценку)
      const span = Math.max(3600_000, now - e.oldest);
      if (now - e.newest < 30 * 60_000) bytesPerDay += (e.bytes / span) * 86400_000;
    }
    const disk = await this.#disk();
    const totalBytes = segs.reduce((n, s) => n + s.size, 0);
    const minFree = this.settings().archiveMinFreeGb * GB;
    const capacityDays = disk && bytesPerDay > 0 ? Math.max(0, (totalBytes + disk.free - minFree) / bytesPerDay) : null;
    this.cache = { at: now, streams, totalBytes, bytesPerDay, disk, capacityDays };
    return this.cache;
  }

  async stats(maxAgeMs = 60_000) {
    if (!this.cache || Date.now() - this.cache.at > maxAgeMs) await this.refresh();
    return this.cache;
  }

  /** Освобождает место: удаляет самые старые сегменты, пока свободно меньше порога (+1 ГБ запаса). */
  async guard() {
    if (this.guarding) return 0;
    this.guarding = true;
    try {
      const disk = await this.#disk();
      if (!disk) return 0;
      const want = (this.settings().archiveMinFreeGb + 1) * GB;
      if (disk.free >= this.settings().archiveMinFreeGb * GB) return 0;
      let need = want - disk.free;
      let removed = 0;
      let lastStart = null;
      const now = Date.now();
      for (const s of await this.#segments()) {
        if (need <= 0) break;
        if (now - s.mtime < ACTIVE_MS) continue;
        try {
          await fs.promises.unlink(s.full);
          need -= s.size;
          removed += 1;
          lastStart = s.start;
        } catch {
          /* занят или уже удалён */
        }
      }
      if (removed) {
        this.log.warn('stream', `Архив: на диске мало места, удалено старых записей: ${removed} ` +
          `(до ${new Date(lastStart).toLocaleString('ru-RU')}). Порог свободного места — ${this.settings().archiveMinFreeGb} ГБ.`);
        this.cache = null;
      } else if (need > 0 && Date.now() - (this.lastFullWarn || 0) > 3600_000) {
        // не чаще раза в час, иначе журнал забьётся одинаковыми записями
        this.lastFullWarn = Date.now();
        this.log.error('stream', `Архив: на диске мало места (свободно ${(disk.free / GB).toFixed(1)} ГБ), удалять больше нечего`);
      }
      return removed;
    } finally {
      this.guarding = false;
    }
  }

  /** Удаляет архив потока целиком (при удалении потока). */
  async removeStream(streamId) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(streamId)) return;
    const dirs = [this.dir];
    if (this.relocation?.state === 'running') dirs.push(this.relocation.from); // ещё не перенесённые записи
    for (const d of dirs) await fs.promises.rm(path.join(d, `s_${streamId}`), { recursive: true, force: true }).catch(() => {});
    this.cache = null;
  }

  /** Объём записей в папке (для решения, хватит ли места под перенос). */
  async usage(dir = this.dir) {
    const segs = await this.#segments(dir);
    return { files: segs.length, bytes: segs.reduce((n, s) => n + s.size, 0) };
  }

  /**
   * Перенос (mode = 'move') или удаление (mode = 'delete') записей из прежней папки архива.
   * Новые записи к этому времени уже пишутся в this.dir. Повторный запуск после перезапуска панели
   * продолжает с оставшихся файлов. onDone вызывается по окончании (успешном или нет).
   */
  relocate(from, mode, { onDone } = {}) {
    if (this.relocation?.state === 'running') return this.relocation.promise;
    const to = this.dir;
    const st = {
      state: 'running', mode, from, to, filesTotal: 0, filesDone: 0, bytesTotal: 0, bytesDone: 0,
      failed: 0, lastError: '', startedAt: new Date().toISOString(), finishedAt: null,
    };
    this.relocation = st;
    st.promise = (async () => {
      try {
        await this.#cleanupParts(to);
        let segs = await this.#segments(from);
        st.filesTotal = segs.length;
        st.bytesTotal = segs.reduce((n, s) => n + s.size, 0);
        const began = Date.now();
        while (segs.length) {
          const later = [];
          for (const seg of segs) {
            if (this.stopping) throw new Error('панель останавливается');
            // ещё дописывается (MediaMTX переключается на новую папку не мгновенно)
            if (Date.now() - seg.mtime < this.quietMs && Date.now() - began < QUIET_WAIT_MAX_MS) { later.push(seg); continue; }
            try {
              if (mode === 'delete') await fs.promises.unlink(seg.full);
              else await moveFile(seg.full, path.join(to, seg.sdir, seg.file));
              st.filesDone += 1;
              st.bytesDone += seg.size;
            } catch (err) {
              if (err.code === 'ENOENT') { st.filesDone += 1; continue; } // удалён по сроку хранения
              // Windows: файл ещё открыт видеосервером — повторим позже
              if (process.platform === 'win32' && ['EBUSY', 'EPERM'].includes(err.code) && Date.now() - began < QUIET_WAIT_MAX_MS) {
                later.push(seg);
                continue;
              }
              st.failed += 1;
              st.lastError = `${seg.full}: ${err.message}`;
            }
          }
          if (!later.length) break;
          await new Promise((r) => { const t = setTimeout(r, Math.min(this.quietMs, 5000)); t.unref?.(); });
          // перечитываем: размер и время изменения могли измениться
          const fresh = [];
          for (const seg of later) {
            try {
              const s2 = await fs.promises.stat(seg.full);
              st.bytesTotal += s2.size - seg.size;
              fresh.push({ ...seg, size: s2.size, mtime: s2.mtimeMs });
            } catch {
              st.filesDone += 1;
            }
          }
          segs = fresh;
        }
        await removeEmptyStreamDirs(from);
        st.state = st.failed ? 'error' : 'done';
        const what = mode === 'delete' ? 'Удаление записей из прежней папки архива' : 'Перенос записей архива';
        if (st.failed) {
          this.log.error('stream', `${what} (${from} → ${to}) завершён с ошибками: не обработано ${filesWord(st.failed)}. Последняя ошибка: ${st.lastError}`);
        } else {
          this.log.info('stream', `${what} завершён: ${filesWord(st.filesDone)}, ${fmtGb(st.bytesDone)}${mode === 'move' ? ` (${from} → ${to})` : ` (${from})`}`);
        }
      } catch (err) {
        st.state = 'error';
        st.lastError = err.message;
        st.interrupted = !!this.stopping;
        this.log[this.stopping ? 'warn' : 'error']('stream', `Перенос записей архива прерван: ${err.message}` +
          (this.stopping ? '. Он продолжится после запуска панели.' : ''));
      } finally {
        st.finishedAt = new Date().toISOString();
        this.cache = null;
        try { await onDone?.(st); } catch { /* сообщение уже в журнале */ }
      }
    })();
    return st.promise;
  }

  /** Недокопированные файлы (.part) от прерванного переноса. */
  async #cleanupParts(dir) {
    let dirs = [];
    try { dirs = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of dirs) {
      if (!d.isDirectory() || !d.name.startsWith('s_')) continue;
      let files = [];
      try { files = await fs.promises.readdir(path.join(dir, d.name)); } catch { continue; }
      for (const f of files) if (f.endsWith('.mp4.part')) await fs.promises.unlink(path.join(dir, d.name, f)).catch(() => {});
    }
  }

  /** Диск с архивом не подключён (Linux): папка оказалась на другой точке монтирования. */
  checkMount(mounts) {
    if (!this.expectedMount) { this.mountProblem = ''; return ''; }
    const m = mountOf(this.dir, mounts);
    const now = m?.mount || '';
    if (now === this.expectedMount) {
      if (this.mountProblem) this.log.info('stream', `Диск архива ${this.expectedMount} снова подключён`);
      this.mountProblem = '';
      return '';
    }
    this.mountProblem = `Диск архива (${this.expectedMount}) не подключён: записи сейчас попадают на ${now || 'другой диск'}. ` +
      'Проверьте диск и строку в /etc/fstab.';
    if (Date.now() - (this.lastMountWarn || 0) > 3600_000) {
      this.lastMountWarn = Date.now();
      this.log.error('stream', this.mountProblem);
    }
    return this.mountProblem;
  }

  start({ guardEveryMs = 2 * 60_000, statsEveryMs = 10 * 60_000 } = {}) {
    this.stopping = false;
    fs.mkdirSync(this.dir, { recursive: true });
    const g = () => {
      if (process.platform !== 'win32') this.checkMount();
      return this.guard().catch((e) => this.log.error('error', `Архив: ${e.message}`));
    };
    g();
    this.timers.push(setInterval(g, guardEveryMs));
    this.timers.push(setInterval(() => this.refresh().catch(() => {}), statsEveryMs));
    for (const t of this.timers) t.unref?.();
  }

  stop() {
    this.stopping = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
  }
}

const fmtGb = fmtSize;

/**
 * Переносит файл: переименованием на том же диске, копированием (через .part) на другой.
 * Файл с тем же именем уже есть: одинаковый размер — дубль, удаляем исходный; иначе ошибка.
 */
export async function moveFile(src, dst) {
  await fs.promises.mkdir(path.dirname(dst), { recursive: true });
  const st = await fs.promises.stat(src);
  try {
    const d = await fs.promises.stat(dst);
    if (d.size === st.size) { await fs.promises.unlink(src); return 'duplicate'; }
    throw Object.assign(new Error('в новой папке уже есть другой файл с таким именем'), { code: 'EEXIST' });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  try {
    await fs.promises.rename(src, dst);
    return 'renamed';
  } catch (err) {
    if (err.code !== 'EXDEV') throw err; // другой диск — копируем
  }
  const tmp = `${dst}.part`;
  try {
    await fs.promises.copyFile(src, tmp);
    await fs.promises.utimes(tmp, st.atime, st.mtime);
    await fs.promises.rename(tmp, dst);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
  await fs.promises.unlink(src);
  return 'copied';
}

/** Удаляет опустевшие каталоги s_* (саму папку архива не трогает — это может быть точка монтирования). */
async function removeEmptyStreamDirs(dir) {
  let dirs = [];
  try { dirs = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const d of dirs) {
    if (d.isDirectory() && d.name.startsWith('s_')) await fs.promises.rmdir(path.join(dir, d.name)).catch(() => {});
  }
}
