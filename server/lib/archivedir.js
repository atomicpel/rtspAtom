// Папка архива: выбор, проверка прав, список дисков, проверка подключения диска.
// Выбранная в панели папка хранится в базе (ключ archiveDir) и важнее archiveDir из config.json:
// файл настроек принадлежит root и службе недоступен для записи.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IS_WINDOWS } from './config.js';
import { getSettings, getValue, setValue } from './settings.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Каталог программы (/opt/rtspatom или C:\Program Files\RTSPAtom): заменяется при обновлении.
// Только для установленного пакета (рядом лежат node и mediamtx), не для запуска из исходников.
const INSTALL_DIR = (() => {
  const d = path.resolve(here, '..', '..', '..');
  return fs.existsSync(path.join(d, 'node')) && fs.existsSync(path.join(d, 'mediamtx')) ? d : null;
})();

/** Работает ли панель службой systemd с защитой ProtectHome/PrivateTmp (тогда /home и /tmp ей не годятся). */
export const SANDBOXED = !IS_WINDOWS && (!!process.env.INVOCATION_ID || process.env.RTSPATOM_SANDBOX === '1');

/** Действующая папка архива: выбранная в панели, иначе из config.json. */
export function effectiveArchiveDir(db, config) {
  const v = getValue(db, 'archiveDir');
  return typeof v === 'string' && v ? v : config.archiveDir;
}

const LINUX_RULES = [
  { prefixes: ['/home', '/root', '/run/user'], why: 'службы не видят домашние каталоги (защита ProtectHome)', sandbox: true },
  { prefixes: ['/usr', '/etc', '/boot', '/efi', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/libx32', '/snap'],
    why: 'системный каталог — службам он доступен только для чтения' },
  { prefixes: ['/proc', '/sys', '/dev', '/run'], why: 'служебная файловая система, а не диск' },
  { prefixes: ['/tmp', '/var/tmp'], why: 'временные файлы: у службы свой /tmp, записи пропадут при перезапуске', sandbox: true },
];

const under = (p, base) => p === base || p.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
const sameName = (a, b) => (IS_WINDOWS ? a.toLowerCase() === b.toLowerCase() : a === b);
const underName = (p, base) => (IS_WINDOWS ? under(p.toLowerCase(), base.toLowerCase()) : under(p, base));

/**
 * Приводит введённый путь к абсолютному; ошибка — понятным текстом.
 * @returns {{ dir?: string, problem?: string }}
 */
export function normalizeDir(input) {
  let s = String(input ?? '').trim().replace(/^["']+|["']+$/g, '');
  if (!s) return { problem: 'Укажите папку' };
  if (/[\x00-\x1f]/.test(s)) return { problem: 'В пути есть недопустимые символы' };
  if (s.includes('%')) return { problem: 'Знак % в пути не поддерживается (MediaMTX использует его в шаблоне имён файлов)' };
  if (IS_WINDOWS) {
    if (/^[\\/]{2}/.test(s)) return { problem: 'Сетевые папки службе недоступны — укажите папку на диске этого компьютера' };
    if (!/^[A-Za-z]:[\\/]/.test(s)) return { problem: 'Нужен полный путь с буквой диска, например D:\\Archive' };
  } else if (!s.startsWith('/')) {
    return { problem: 'Нужен полный путь от корня, например /srv/archive' };
  }
  const dir = path.resolve(s);
  if (dir === path.parse(dir).root) {
    return { problem: IS_WINDOWS ? 'Укажите папку на диске, а не сам диск: например D:\\Archive' : 'Корень файловой системы не подходит: укажите папку, например /srv/archive' };
  }
  return { dir };
}

/** Почему папка не подходит (или null). sandboxed — проверять и ограничения службы systemd. */
export function forbiddenReason(dir, { dataDir, sandboxed = SANDBOXED } = {}) {
  if (IS_WINDOWS) {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const blocked = [sysRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
    for (const b of blocked) if (underName(dir, b)) return `${b} — системная папка Windows`;
  } else {
    for (const r of LINUX_RULES) {
      if (r.sandbox && !sandboxed) continue;
      for (const p of r.prefixes) if (under(dir, p)) return `${p}: ${r.why}`;
    }
  }
  if (INSTALL_DIR && underName(dir, INSTALL_DIR)) return `${INSTALL_DIR} — папка программы, она заменяется при обновлении`;
  if (dataDir && (sameName(dir, dataDir) || underName(dataDir, dir))) {
    return `здесь лежат база и настройки панели (${dataDir}) — выберите отдельную папку, например ${path.join(dataDir, 'archive')}`;
  }
  return null;
}

// ---------- Диски (Linux: /proc/self/mounts) ----------

const REAL_FS = new Set(['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'f2fs', 'jfs', 'reiserfs', 'zfs', 'vfat', 'exfat',
  'ntfs', 'ntfs3', 'fuseblk', 'nfs', 'nfs4', 'cifs', 'smb3']);

const unescapeMount = (s) => s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

/** Точки монтирования: [{ device, mount, fstype, ro }] */
export function mountPoints(text) {
  let src = text;
  if (src === undefined) {
    try {
      src = fs.readFileSync('/proc/self/mounts', 'utf8');
    } catch {
      return [];
    }
  }
  return src.split('\n').filter(Boolean).map((line) => {
    const [device, mount, fstype, opts = ''] = line.split(' ');
    return { device: unescapeMount(device || ''), mount: unescapeMount(mount || ''), fstype: fstype || '', ro: opts.split(',').includes('ro') };
  });
}

/** На какой точке монтирования лежит путь (самый длинный совпавший префикс). */
export function mountOf(dir, mounts = mountPoints()) {
  let best = null;
  for (const m of mounts) {
    if (!m.mount || !under(dir, m.mount)) continue;
    if (!best || m.mount.length >= best.mount.length) best = m;
  }
  return best;
}

async function statfs(p) {
  try {
    const s = await fs.promises.statfs(p);
    return { free: Number(s.bavail) * Number(s.bsize), size: Number(s.blocks) * Number(s.bsize) };
  } catch {
    return null;
  }
}

/** Диски сервера, на которые можно поставить архив. */
export async function listDisks({ sandboxed = SANDBOXED } = {}) {
  if (IS_WINDOWS) {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const out = await Promise.all(letters.map(async (l) => {
      const mount = `${l}:\\`;
      const st = await statfs(mount);
      return st && st.size > 0 ? { mount, device: '', fstype: '', ...st, system: l === (process.env.SystemDrive || 'C:')[0].toUpperCase() } : null;
    }));
    return out.filter(Boolean);
  }
  const seen = new Set();
  const out = [];
  for (const m of mountPoints()) {
    // корень в контейнере бывает overlay; прочие overlay — слои Docker, их не показываем
    if (m.ro || seen.has(m.mount) || !(REAL_FS.has(m.fstype) || (m.mount === '/' && m.fstype === 'overlay'))) continue;
    // /boot, /home и т. п. архиву не подходят (кроме самого корня — системного диска)
    if (m.mount !== '/' && forbiddenReason(m.mount, { sandboxed })) continue;
    seen.add(m.mount);
    const st = await statfs(m.mount);
    if (!st || st.size === 0) continue;
    out.push({ mount: m.mount, device: m.device, fstype: m.fstype, ...st, system: m.mount === '/' });
  }
  return out.sort((a, b) => (a.system === b.system ? a.mount.localeCompare(b.mount) : a.system ? -1 : 1));
}

// ---------- Проверка папки ----------

/** Ближайший существующий каталог на пути (сама папка или родитель). */
async function nearestExisting(dir) {
  let p = dir;
  for (;;) {
    try {
      const st = await fs.promises.stat(p);
      if (st.isDirectory()) return { path: p, stat: st };
      return { path: p, stat: st, notDir: true };
    } catch {
      const parent = path.dirname(p);
      if (parent === p) return null;
      p = parent;
    }
  }
}

const shQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Команды, которые даст выполнить администратору сервера, если у службы нет прав на папку. */
export function fixCommands(dir) {
  if (IS_WINDOWS) {
    // службы работают от NT AUTHORITY\LocalService (S-1-5-19)
    return `mkdir "${dir}"\nicacls "${dir}" /grant *S-1-5-19:(OI)(CI)M`;
  }
  let user = 'rtspatom';
  try {
    const u = os.userInfo().username;
    if (u && u !== 'root') user = u;
  } catch { /* нет записи о пользователе */ }
  return `sudo mkdir -p ${shQuote(dir)}\nsudo chown ${user}:${user} ${shQuote(dir)}`;
}

/**
 * Проверка папки при вводе: папку не создаёт и ничего не оставляет на диске
 * (права проверяются пробным файлом, который сразу удаляется).
 * @returns результат для окна выбора папки
 */
export async function checkDir(input, { dataDir, currentDir, sandboxed = SANDBOXED } = {}) {
  const { dir, problem } = normalizeDir(input);
  if (!dir) return { ok: false, problem };
  const base = { path: dir, current: currentDir ? sameName(dir, currentDir) : false };
  const why = forbiddenReason(dir, { dataDir, sandboxed });
  if (why) return { ...base, ok: false, problem: `Эта папка не подходит: ${why}` };
  if (currentDir) {
    const rel = path.relative(currentDir, dir);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel) && /^s_/.test(rel.split(path.sep)[0])) {
      return { ...base, ok: false, problem: 'Это папка записей одной из камер внутри текущего архива — выберите другую' };
    }
  }

  const near = await nearestExisting(dir);
  if (!near) return { ...base, ok: false, problem: 'Диск или папка не найдены' };
  if (near.notDir) return { ...base, ok: false, problem: `${near.path} — это файл, а не папка` };
  const exists = near.path === dir;
  const disk = await statfs(near.path);
  const mount = IS_WINDOWS ? null : mountOf(dir);
  let sameFs = null;
  if (currentDir) {
    const cur = await nearestExisting(currentDir);
    if (cur && !cur.notDir) sameFs = cur.stat.dev === near.stat.dev;
  }
  let entries = 0;
  let streamDirs = 0;
  if (exists) {
    try {
      const list = await fs.promises.readdir(dir);
      streamDirs = list.filter((n) => /^s_[A-Za-z0-9_-]+$/.test(n)).length;
      entries = list.length - streamDirs;
    } catch { /* нет прав на чтение — скажет проверка записи */ }
  }
  const info = {
    ...base,
    exists,
    free: disk?.free ?? null,
    size: disk?.size ?? null,
    mount: mount?.mount || (IS_WINDOWS ? path.parse(dir).root : null),
    device: mount?.device || null,
    systemDisk: IS_WINDOWS ? path.parse(dir).root.toUpperCase().startsWith((process.env.SystemDrive || 'C:').toUpperCase()) : mount?.mount === '/',
    sameFs,
    entries,
    streamDirs,
  };

  // Права: в существующую папку нужно писать; несуществующую создаст служба, если можно писать в родителя.
  // Проверяем пробным файлом (он сразу удаляется): access() в Windows не учитывает права NTFS.
  try {
    const probe = path.join(near.path, `.rtspatom-probe-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.promises.writeFile(probe, '');
    await fs.promises.unlink(probe);
  } catch (err) {
    const ro = err.code === 'EROFS';
    return {
      ...info,
      ok: false,
      writable: false,
      problem: ro
        ? `${near.path}: диск подключён только для чтения`
        : exists
          ? 'У панели нет прав на запись в эту папку.'
          : `Папки ещё нет, а создать её в ${near.path} у панели нет прав.`,
      fix: ro ? undefined : fixCommands(dir),
    };
  }
  return { ...info, ok: true, writable: true };
}

/** Создаёт папку и проверяет запись файлом-пробой. Ошибка — с командами для исправления. */
export async function prepareDir(dir) {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.rtspatom-write-test-${process.pid}-${Date.now()}`);
    await fs.promises.writeFile(probe, 'ok');
    await fs.promises.unlink(probe);
  } catch (err) {
    const e = new Error(err.code === 'EROFS'
      ? `${dir}: диск подключён только для чтения`
      : `Нет прав на запись в ${dir} (${err.code || err.message})`);
    e.fix = err.code === 'EROFS' ? undefined : fixCommands(dir);
    throw e;
  }
}

// ---------- Смена папки ----------

const GB = 1024 ** 3;
/** Размер для журнала: 512 МБ, 3,4 ГБ, 1,2 ТБ */
export function fmtSize(b) {
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0;
  let v = Number(b) || 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1).replace('.', ',')} ${u[i]}`;
}
const fmtGb = fmtSize;
/** 1 файл, 3 файла, 5 файлов */
export function filesWord(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? 'файл' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'файла' : 'файлов';
  return `${n} ${w}`;
}
const RECORDS_TEXT = { move: 'переносятся в новую папку', delete: 'в прежней папке удаляются', keep: 'оставлены в прежней папке' };

/** Запоминает, на каком диске лежит папка архива, чтобы заметить, если диск не подключится (Linux). */
export function initExpectedMount(app) {
  if (IS_WINDOWS) return;
  const { db, archive } = app;
  const stored = getValue(db, 'archiveMount');
  if (stored && stored.dir === archive.dir) {
    archive.expectedMount = stored.mount || null;
    return;
  }
  const m = mountOf(archive.dir);
  // системный диск не проверяем: он подключён всегда
  const mount = m && m.mount !== '/' ? m.mount : null;
  setValue(db, 'archiveMount', { dir: archive.dir, mount });
  archive.expectedMount = mount;
}

/** Запуск (или продолжение после перезапуска) переноса записей из прежней папки. */
export function startRelocation(app, from, mode) {
  return app.archive.relocate(from, mode, {
    onDone: async (st) => {
      // прерван остановкой панели — продолжим при следующем запуске
      if (!st.interrupted) setValue(app.db, 'archiveMove', null);
      await app.sync?.trigger().catch(() => {});
    },
  });
}

/**
 * Смена папки архива из панели: проверка, создание папки, переключение записи, перенос старых записей.
 * records: move — перенести, delete — удалить, keep — оставить в прежней папке.
 */
export async function switchArchiveDir(app, input, records, { user, ip } = {}) {
  const { db, config, archive, sync, log } = app;
  if (!['move', 'delete', 'keep'].includes(records)) {
    throw Object.assign(new Error('records: move, delete или keep'), { status: 400 });
  }
  if (archive.relocation?.state === 'running') {
    throw Object.assign(new Error('Ещё идёт перенос записей из прежней папки — дождитесь окончания'), { status: 409 });
  }
  const old = archive.dir;
  const res = await checkDir(input, { dataDir: config.dataDir, currentDir: old });
  if (!res.ok) throw Object.assign(new Error(res.problem), { status: 400, fix: res.fix });
  if (res.current) throw Object.assign(new Error('Это и есть текущая папка архива'), { status: 400 });
  const dir = res.path;

  const usage = await archive.usage(old);
  if (records === 'move' && usage.bytes > 0 && res.sameFs === false && res.free !== null) {
    const reserve = getSettings(db).archiveMinFreeGb * GB;
    if (usage.bytes > res.free - reserve) {
      throw Object.assign(new Error(`На новом диске не хватит места для переноса: записей ${fmtGb(usage.bytes)}, ` +
        `свободно ${fmtGb(res.free)}, а ${fmtGb(reserve)} должно оставаться свободным (настройка «Оставлять свободным»). ` +
        'Выберите «Удалить старые записи» или «Оставить в прежней папке».'), { status: 400 });
    }
  }
  try {
    await prepareDir(dir);
  } catch (err) {
    throw Object.assign(err, { status: 400 });
  }

  setValue(db, 'archiveDir', dir);
  const relocate = usage.files > 0 && records !== 'keep';
  setValue(db, 'archiveMove', relocate ? { from: old, mode: records } : null);
  archive.dir = dir;
  archive.cache = null;
  sync.archiveDir = dir;
  initExpectedMount(app);
  archive.checkMount?.();
  const recText = usage.files ? `; записи (${filesWord(usage.files)}, ${fmtGb(usage.bytes)}) ${RECORDS_TEXT[records]}` : '';
  log.info('admin', `Папка архива изменена: ${old} → ${dir}${recText}`, { user, ip });
  if (records === 'keep' && usage.files) {
    log.warn('stream', `В прежней папке архива ${old} остались записи (${fmtGb(usage.bytes)}): в просмотрщике их не видно, ` +
      'и автоматически они не удаляются — удалите их вручную, когда станут не нужны.');
  }
  // MediaMTX начинает писать в новую папку (камеры переподключаются на несколько секунд)
  await sync.trigger().catch(() => {});
  if (relocate) startRelocation(app, old, records).catch(() => {});
  return { dir, previous: old, files: usage.files, bytes: usage.bytes, records };
}

/** Ход переноса для API (без внутренних полей). */
export function relocationInfo(archive) {
  const r = archive.relocation;
  if (!r) return null;
  const { promise: _p, ...rest } = r;
  return rest;
}
