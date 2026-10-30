// Состояние системы для страницы «Состояние»: нагрузка сервера, сеть, диск, потоки и энкодеры,
// история за последний час и автоматические проверки с советами, что исправить.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encoderOf, readOutput } from './encoder.js';
import { getSettings } from './settings.js';
import { pathNameOf } from './mediamtx.js';

const SAMPLE_MS = 10_000;
const HISTORY = 360; // 1 час по 10 с
const LINUX = process.platform === 'linux';
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

/** Сумма времени процессора из /proc/stat (или os.cpus в Windows). */
function cpuTimes() {
  if (LINUX) {
    const l = read('/proc/stat').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    if (l.length >= 8) {
      const [user, nice, system, idle, iowait, irq, softirq, steal] = l;
      return { user: user + nice, system: system + irq + softirq, idle, iowait, steal, total: l.slice(0, 8).reduce((a, b) => a + b, 0) };
    }
  }
  let user = 0; let system = 0; let idle = 0; let total = 0;
  for (const c of os.cpus()) {
    user += c.times.user + c.times.nice; system += c.times.sys + c.times.irq; idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle;
  }
  return { user, system, idle, iowait: 0, steal: 0, total };
}

function memInfo() {
  if (LINUX) {
    const m = {};
    for (const line of read('/proc/meminfo').split('\n')) {
      const [k, v] = line.split(':');
      if (v) m[k.trim()] = Number(v.trim().split(/\s+/)[0]) * 1024;
    }
    if (m.MemTotal) {
      return { total: m.MemTotal, available: m.MemAvailable ?? m.MemFree, swapTotal: m.SwapTotal || 0, swapUsed: (m.SwapTotal || 0) - (m.SwapFree || 0) };
    }
  }
  return { total: os.totalmem(), available: os.freemem(), swapTotal: 0, swapUsed: 0 };
}

/** Сетевые интерфейсы: счётчики байт, ошибок, отброшенных пакетов, скорость, драйвер. */
function netCounters() {
  const out = {};
  if (!LINUX) return out;
  for (const line of read('/proc/net/dev').split('\n').slice(2)) {
    const [name, rest] = line.split(':');
    if (!rest) continue;
    const n = name.trim();
    if (n === 'lo' || /^(docker|veth|br-|virbr)/.test(n)) continue;
    const f = rest.trim().split(/\s+/).map(Number);
    const sys = `/sys/class/net/${n}`;
    let driver = '';
    try { driver = path.basename(fs.readlinkSync(`${sys}/device/driver`)); } catch { /* виртуальный */ }
    out[n] = {
      rxBytes: f[0], rxErrors: f[2], rxDropped: f[3], txBytes: f[8], txErrors: f[10], txDropped: f[11],
      speed: Number(read(`${sys}/speed`).trim()) || null, duplex: read(`${sys}/duplex`).trim() || null,
      up: read(`${sys}/operstate`).trim() === 'up', driver,
    };
  }
  return out;
}

/** Процессы и их время процессора (для «кто съедает процессор»). */
function procTimes() {
  const out = new Map();
  if (!LINUX) return out;
  let pids = [];
  try { pids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return out; }
  for (const pid of pids) {
    const st = read(`/proc/${pid}/stat`);
    const m = /^\d+ \((.*)\) \S+ (.*)$/.exec(st);
    if (!m) continue;
    const f = m[2].split(' ');
    out.set(pid, { name: m[1], ticks: Number(f[11]) + Number(f[12]) });
  }
  return out;
}

export class Monitor {
  constructor({ app, sampleMs = SAMPLE_MS }) {
    this.app = app;
    this.sampleMs = sampleMs;
    this.history = []; // [{ t, cpu, user, system, iowait, steal, mem, load, rxMbps, txMbps, errorsPerMin, online, total }]
    this.prev = null;
    this.current = null;
    this.encoderCache = new Map(); // streamId -> { at, fields, error }
    this.timer = null;
  }

  sample() {
    const now = Date.now();
    const cpu = cpuTimes();
    const net = netCounters();
    const procs = procTimes();
    const status = this.app.sync?.status || new Map();
    const streamIn = {};
    for (const [name, st] of status) streamIn[name] = { bytes: st.bytesReceived || 0, err: st.framesInError || 0 };
    const p = this.prev;
    const dt = p ? (now - p.t) / 1000 : 0;
    const pct = (k) => (p && cpu.total > p.cpu.total ? Math.max(0, Math.min(100, ((cpu[k] - p.cpu[k]) / (cpu.total - p.cpu.total)) * 100)) : 0);
    const cores = os.cpus().length || 1;
    const mem = memInfo();

    const ifaces = Object.entries(net).map(([name, n]) => {
      const q = p?.net[name];
      return {
        name, ...n,
        rxMbps: q && dt ? ((n.rxBytes - q.rxBytes) * 8) / dt / 1e6 : 0,
        txMbps: q && dt ? ((n.txBytes - q.txBytes) * 8) / dt / 1e6 : 0,
        newErrors: q ? n.rxErrors - q.rxErrors + n.txErrors - q.txErrors : 0,
        newDrops: q ? n.rxDropped - q.rxDropped + n.txDropped - q.txDropped : 0,
      };
    });

    // самые прожорливые процессы за последний интервал
    let top = [];
    if (p && dt) {
      const hz = 100; // USER_HZ в Linux почти всегда 100
      for (const [pid, pr] of procs) {
        const q = p.procs.get(pid);
        if (!q || q.name !== pr.name) continue;
        const cpuPct = ((pr.ticks - q.ticks) / hz / dt) * 100;
        if (cpuPct >= 1) top.push({ pid: Number(pid), name: pr.name, cpu: Math.round(cpuPct) });
      }
      // одноимённые процессы (Firefox) складываем
      const byName = new Map();
      for (const t of top) byName.set(t.name, { name: t.name, cpu: (byName.get(t.name)?.cpu || 0) + t.cpu, count: (byName.get(t.name)?.count || 0) + 1 });
      top = [...byName.values()].sort((a, b) => b.cpu - a.cpu).slice(0, 8);
    }

    // потоки: входящий битрейт и испорченные кадры за интервал
    const streams = [];
    let errorsTotal = 0;
    const rows = this.app.db.prepare('SELECT * FROM streams ORDER BY sort, created_at').all();
    for (const row of rows) {
      const name = pathNameOf(row);
      const cur = streamIn[name];
      const was = p?.streamIn[name];
      const kbps = cur && was && dt && cur.bytes >= was.bytes ? ((cur.bytes - was.bytes) * 8) / dt / 1000 : 0;
      const err = cur && was && cur.err >= was.err ? cur.err - was.err : 0;
      errorsTotal += err;
      const st = status.get(name);
      const drops = (this.app.sync?.drops?.get(row.id) || []).filter((t) => now - t < 3600_000).length;
      const prevStream = this.current?.streams?.find((s) => s.id === row.id);
      // испорченные кадры за последнюю минуту — скользящая сумма по замерам
      const errWindow = [...(prevStream?.errWindow || []), err].slice(-Math.round(60_000 / this.sampleMs));
      streams.push({
        id: row.id, name: row.name, active: !!row.is_active, mode: row.push_key ? 'push' : 'pull', url: row.url, protocol: row.protocol,
        online: !!st?.ready, kbps: Math.round(kbps), errorsPerMin: errWindow.reduce((a, b) => a + b, 0), errWindow,
        dropsPerHour: drops, readers: st?.readers || 0, tracks: st?.tracks || [], record: !!row.record,
        tuner: this.app.tuner?.info(row.id) || null, encoder: encoderOf(row),
      });
    }

    const load = os.loadavg();
    const point = {
      t: now, cpu: Math.round(pct('user') + pct('system') + pct('iowait') + pct('steal')),
      user: Math.round(pct('user')), system: Math.round(pct('system')), iowait: Math.round(pct('iowait')), steal: Math.round(pct('steal')),
      mem: Math.round(((mem.total - mem.available) / mem.total) * 100), load: load[0],
      rxMbps: +ifaces.reduce((a, i) => a + i.rxMbps, 0).toFixed(1), txMbps: +ifaces.reduce((a, i) => a + i.txMbps, 0).toFixed(1),
      errorsPerMin: streams.reduce((a, s) => a + s.errorsPerMin, 0),
      online: streams.filter((s) => s.active && s.online).length, total: streams.filter((s) => s.active).length,
    };
    if (p) {
      this.history.push(point);
      if (this.history.length > HISTORY) this.history.shift();
    }
    this.prev = { t: now, cpu, net, procs, streamIn };
    this.current = { at: new Date(now).toISOString(), cores, load, mem, point, ifaces, top, streams, errorsTotal };
    return this.current;
  }

  /** Настройки энкодеров (раз в 10 минут), если для потока заданы доступ к веб-интерфейсу. */
  async refreshEncoders() {
    const rows = this.app.db.prepare('SELECT * FROM streams WHERE is_active = 1').all();
    for (const row of rows) {
      const e = encoderOf(row);
      if (!e.enabled || !e.host) continue;
      const c = this.encoderCache.get(row.id);
      if (c && Date.now() - c.at < 10 * 60_000) continue;
      try {
        const out = this.app.tuner?.info(row.id)?.output ?? e.output ?? 0;
        const { fields } = await readOutput(e, out);
        this.encoderCache.set(row.id, { at: Date.now(), fields, output: out });
      } catch (err) {
        this.encoderCache.set(row.id, { at: Date.now(), error: err.message });
      }
    }
  }

  /** Проверки: что не так и что сделать. level: error | warn | info */
  checks() {
    const c = this.current;
    if (!c) return [];
    const out = [];
    const add = (level, area, title, detail, fix) => out.push({ level, area, title, detail, fix });
    const hist = this.history.slice(-30); // последние 5 минут
    const avg = (k) => (hist.length ? hist.reduce((a, h) => a + h[k], 0) / hist.length : c.point[k]);

    // --- Сервер ---
    if (c.load[1] > c.cores * 1.5) add('error', 'Сервер', `Сервер перегружен: средняя нагрузка ${c.load[1].toFixed(1)} при ${c.cores} ядрах`, 'Видеосервер не успевает читать потоки — энкодеры выбрасывают пакеты, картинка идёт «слайдами».', 'Найдите, что занимает процессор (список ниже); добавьте виртуальной машине ядер.');
    else if (c.load[1] > c.cores) add('warn', 'Сервер', `Высокая нагрузка: ${c.load[1].toFixed(1)} при ${c.cores} ядрах`, 'Запаса почти нет: при пиках возможны потери кадров.', 'Добавьте ядер или уберите лишние программы с сервера.');
    if (avg('steal') > 10) add('error', 'Сервер', `Виртуальной машине не дают процессор: steal ${Math.round(avg('steal'))} %`, 'Хост VMware перегружен другими машинами.', 'Попросите администратора VMware зарезервировать процессор для этой машины.');
    if (avg('iowait') > 20) add('warn', 'Сервер', `Диск не успевает: ожидание ввода-вывода ${Math.round(avg('iowait'))} %`, 'Запись архива или своп тормозят весь сервер.', 'Проверьте диск архива; при свопе — добавьте памяти.');
    const memUsed = 1 - c.mem.available / c.mem.total;
    if (memUsed > 0.9) add('warn', 'Сервер', `Мало свободной памяти: занято ${Math.round(memUsed * 100)} %`, c.mem.swapUsed > 256 * 1024 ** 2 ? `Используется своп: ${(c.mem.swapUsed / 1024 ** 3).toFixed(1)} ГБ.` : '', 'Добавьте памяти виртуальной машине или закройте браузер на сервере.');
    for (const t of c.top) {
      if (/^(kesl|wdserver|klnagent|drweb|avp)/i.test(t.name) && t.cpu >= 30) add('error', 'Сервер', `Антивирус (${t.name}) занимает ${t.cpu} % процессора`, 'Он проверяет записи архива и, возможно, сетевой трафик видео.', 'Попросите администратора антивируса добавить исключения: папку архива, /opt/rtspatom, /var/lib/rtspatom; доверенные программы mediamtx и node; не проверять трафик портов 8080, 8189, 8554, 8888, 1935, 8890.');
      if (/firefox|chrom|Isolated Web|Web Content/i.test(t.name) && t.cpu >= 50) add('warn', 'Сервер', `Браузер на самом сервере занимает ${t.cpu} % процессора`, 'Видеостена, открытая на сервере, отнимает процессор у видеосервера.', 'Смотрите стену с другого компьютера или уменьшите раскладку.');
      if (/^vlc$/i.test(t.name)) add('warn', 'Сервер', `На сервере запущен VLC (${t.cpu} % процессора)`, 'Лишнее подключение к энкодеру и нагрузка на сервер.', 'Закройте VLC.');
    }
    // --- Сеть сервера ---
    for (const i of c.ifaces.filter((x) => x.up)) {
      if (i.duplex === 'half') add('error', 'Сеть', `${i.name}: полудуплекс (${i.duplex})`, 'Несовпадение режима с портом коммутатора — потери пакетов.', 'Проверьте порт коммутатора и кабель; оба конца — авто или 1000/full.');
      if (i.speed && i.speed < 1000 && i.speed > 0) add('warn', 'Сеть', `${i.name}: скорость ${i.speed} Мбит/с`, 'Ниже гигабита.', 'Проверьте кабель и порт коммутатора.');
      if (i.newErrors > 0) add('warn', 'Сеть', `${i.name}: ошибки приёма/передачи (${i.newErrors} за 10 с)`, 'Битый кабель, разъём или порт.', 'Замените кабель, проверьте счётчики ошибок на порту коммутатора.');
      if (i.driver === 'e1000' && (i.rxMbps > 5 || i.txMbps > 5)) add('info', 'Сеть', `${i.name}: эмулированный адаптер E1000`, 'Он нагружает процессор сильнее, чем VMXNET3.', 'При случае смените тип адаптера ВМ на VMXNET3 (имя интерфейса изменится — проверьте IP).');
    }
    // --- Архив ---
    const a = this.app.archive;
    if (a?.mountProblem) add('error', 'Архив', 'Диск архива не подключён', a.mountProblem, 'Проверьте диск и /etc/fstab, затем перезапустите службы.');
    const st = a?.cache;
    const s = getSettings(this.app.db);
    if (st?.disk && st.disk.free < s.archiveMinFreeGb * 1024 ** 3) add('warn', 'Архив', 'Мало места на диске архива', `Свободно ${(st.disk.free / 1024 ** 3).toFixed(0)} ГБ — старые записи удаляются раньше срока.`, 'Уменьшите срок хранения или битрейт, освободите диск.');
    if (st?.capacityDays !== null && st?.capacityDays !== undefined && st.capacityDays < s.archiveDays) add('info', 'Архив', `Места хватит примерно на ${Math.floor(st.capacityDays)} сут. при сроке ${s.archiveDays}`, '', 'Уменьшите «Хранить записи» в настройках или битрейт камер.');
    if (!this.app.sync?.reachable) add('error', 'Видеосервер', 'Видеосервер MediaMTX недоступен', this.app.sync?.lastError || '', 'sudo systemctl restart rtspatom-mediamtx; журнал: journalctl -u rtspatom-mediamtx -n 50');
    if (!s.camerasAlwaysOn) add('info', 'Панель', 'Камеры подключаются только при просмотре', 'При открытии стены несколько секунд «Нет сигнала».', 'Настройки → Камеры → «Держать подключёнными постоянно».');
    if (!c.streams.some((x) => x.active && x.record)) add('warn', 'Архив', 'Запись в архив выключена у всех потоков', '', 'Настройки → Архив → «Включить запись для всех».');

    // --- Потоки ---
    const hosts = new Map();
    for (const x of c.streams.filter((y) => y.active)) {
      const label = `«${x.name}»`;
      if (!x.online) add('error', 'Потоки', `${label}: нет потока`, x.mode === 'push' ? 'Энкодер не отправляет видео.' : 'Видеосервер не получает видео от источника.', x.mode === 'push' ? 'Проверьте отправку (PUSH) на энкодере.' : 'Проверьте энкодер, сеть и адрес потока (кнопка «Проверить подключение»).');
      if (x.errorsPerMin >= 10) add('error', 'Потоки', `${label}: потери — ${x.errorsPerMin} испорченных кадров в минуту`, 'Картинка рассыпается и идёт «слайдами».', x.tuner ? 'Автоподстройка уже снижает битрейт; если не помогает — канал до площадки слишком узкий.' : 'Включите автоподстройку битрейта в окне потока или снизьте битрейт энкодера; проверьте нагрузку сервера.');
      else if (x.errorsPerMin > 0) add('warn', 'Потоки', `${label}: ${x.errorsPerMin} испорченных кадров в минуту`, '', 'Следите; при росте — снизить битрейт или включить автоподстройку.');
      if (x.dropsPerHour >= 3) add('warn', 'Потоки', `${label}: пропадал ${x.dropsPerHour} раз за час`, 'Источник рвёт соединение или пропадает из сети.', 'Проверьте лишние подключения к энкодеру (VLC, регистратор, второй поток), питание и сеть.');
      if (x.protocol === 'hls') add('warn', 'Потоки', `${label}: источник HLS`, 'Задержка 2–10 с, такие источники часто обрываются.', 'Включите на энкодере RTSP и замените адрес потока.');
      if (x.tracks.some((t) => /H265|HEVC/i.test(t))) add('warn', 'Потоки', `${label}: кодек H.265`, 'Браузер по WebRTC его почти не показывает — будет HLS с задержкой.', 'Переключите энкодер на H.264.');
      if (x.tracks.some((t) => /MPEG-4 Audio|AAC/i.test(t))) add('info', 'Потоки', `${label}: звук AAC`, 'По WebRTC не воспроизводится, лишний трафик.', 'Выключите звук на энкодере или выберите G.711.');
      if (x.mode === 'pull') {
        let h = '';
        try { h = new URL(x.url).hostname; } catch { /* нет адреса */ }
        if (h) hosts.set(h, [...(hosts.get(h) || []), x.name]);
      }
      // настройки энкодера, если доступ задан
      const ec = this.encoderCache.get(x.id);
      if (ec?.error) add('warn', 'Энкодеры', `${label}: нет доступа к веб-интерфейсу энкодера`, ec.error, 'Проверьте адрес, логин и пароль в окне потока.');
      if (ec?.fields) {
        const f = ec.fields;
        const fps = Number(f.venc_framerate); const gop = Number(f.venc_gop);
        if (fps && gop && gop > fps * 2) add('warn', 'Энкодеры', `${label}: опорный кадр раз в ${(gop / fps).toFixed(1)} с (GOP ${gop})`, 'При потерях картинка восстанавливается редко; долгое открытие камеры.', 'Нажмите «Рекомендуемые настройки» в окне потока (GOP = частоте кадров).');
        const extra = [['http_hls_enable', 'HLS'], ['http_ts_enable', 'TS'], ['http_flv_enable', 'FLV'], ['rtmp_enable', 'RTMP'], ['rtmp_publish_enable', 'PUSH'], ['multicast_enable', 'мультикаст']]
          .filter(([k]) => f[k] === '1').map(([, n]) => n);
        if (extra.length && x.mode === 'pull') add('warn', 'Энкодеры', `${label}: на энкодере включены лишние выходы: ${extra.join(', ')}`, 'Каждый выход отнимает процессор энкодера и сеть.', 'Нажмите «Рекомендуемые настройки» в окне потока — лишние выходы выключатся.');
      } else if (!x.encoder?.enabled && x.mode === 'pull' && x.protocol === 'rtsp' && x.errorsPerMin > 0) {
        add('info', 'Энкодеры', `${label}: автоподстройка не настроена`, 'Панель могла бы сама держать битрейт под канал.', 'В окне потока впишите логин и пароль энкодера и включите «Автоподстройка».');
      }
    }
    for (const [h, names] of hosts) if (names.length > 1) add('warn', 'Энкодеры', `С одного энкодера ${h} берутся ${names.length} потока`, names.join(', '), 'Двойная нагрузка на энкодер и канал. Оставьте один поток (запись в архив включается в нём же).');

    const rank = { error: 0, warn: 1, info: 2 };
    return out.sort((x, y) => rank[x.level] - rank[y.level]);
  }

  snapshot() {
    const c = this.current || this.sample();
    return {
      ...c,
      streams: c.streams.map(({ errWindow: _w, encoder, ...rest }) => ({
        ...rest,
        encoderAuto: !!encoder?.auto,
        encoderSettings: (() => {
          const ec = this.encoderCache.get(rest.id);
          if (!ec?.fields) return null;
          const f = ec.fields;
          return { bitrate: Number(f.venc_bitrate) || null, framerate: Number(f.venc_framerate) || null, gop: Number(f.venc_gop) || null, rcMode: f.venc_rc_mode ?? null, profile: f.venc_profile ?? null };
        })(),
      })),
      history: this.history,
      checks: this.checks(),
    };
  }

  start() {
    this.sample();
    this.timer = setInterval(() => {
      try { this.sample(); } catch (err) { this.app.log?.error('error', `Мониторинг: ${err.message}`); }
    }, this.sampleMs);
    this.timer.unref?.();
    this.encTimer = setInterval(() => this.refreshEncoders().catch(() => {}), 60_000);
    this.encTimer.unref?.();
    setTimeout(() => this.refreshEncoders().catch(() => {}), 5000).unref?.();
  }

  stop() { clearInterval(this.timer); clearInterval(this.encTimer); }
}
