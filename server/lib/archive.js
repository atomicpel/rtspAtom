import fs from 'node:fs';
import path from 'node:path';

const GB = 1024 ** 3;
const ACTIVE_MS = 3 * 60 * 1000; // файл, изменённый за последние 3 минуты, — идущая запись, его не трогаем
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
  constructor({ dir, log, settings, statfs = (p) => fs.promises.statfs(p) }) {
    this.dir = dir;
    this.log = log;
    this.settings = settings;
    this.statfs = statfs;
    this.cache = null;
    this.timers = [];
    this.guarding = false;
  }

  async #disk() {
    try {
      const s = await this.statfs(this.dir);
      return { free: Number(s.bavail) * Number(s.bsize), size: Number(s.blocks) * Number(s.bsize) };
    } catch {
      return null;
    }
  }

  /** Все сегменты: [{ stream, file, full, start, size, mtime }], по времени начала. */
  async #segments() {
    const out = [];
    let streams = [];
    try {
      streams = await fs.promises.readdir(this.dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const d of streams) {
      // каталоги архива — по именам путей MediaMTX: s_<id потока>
      if (!d.isDirectory() || !d.name.startsWith('s_')) continue;
      const sdir = path.join(this.dir, d.name);
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
          out.push({ stream: streamId, file: f, full: path.join(sdir, f), start, size: st.size, mtime: st.mtimeMs });
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
    await fs.promises.rm(path.join(this.dir, `s_${streamId}`), { recursive: true, force: true }).catch(() => {});
    this.cache = null;
  }

  start({ guardEveryMs = 2 * 60_000, statsEveryMs = 10 * 60_000 } = {}) {
    fs.mkdirSync(this.dir, { recursive: true });
    const g = () => this.guard().catch((e) => this.log.error('error', `Архив: ${e.message}`));
    g();
    this.timers.push(setInterval(g, guardEveryMs));
    this.timers.push(setInterval(() => this.refresh().catch(() => {}), statsEveryMs));
    for (const t of this.timers) t.unref?.();
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }
}
