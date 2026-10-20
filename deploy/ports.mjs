// Подбор свободных портов при установке (Linux и Windows).
//
//   node ports.mjs <имя>=<порт>@<адрес> [...]
//   node ports.mjs panel=8080@0.0.0.0 hls=8888@127.0.0.1 api=9997@127.0.0.1 ice=8189@0.0.0.0+udp srt=8890@0.0.0.0/udp
// Суффикс +udp — порт должен быть свободен и для TCP, и для UDP; /udp — только для UDP.
//
// Для каждого порта проверяет, не слушает ли его уже какая-то программа (ss / netstat)
// и можно ли его занять. Если порт занят — берёт следующий свободный (до +200).
// Выводит JSON: {"panel":{"port":8081,"wanted":8080,"busyBy":"python3"}, ...}
import { execFileSync } from 'node:child_process';
import dgram from 'node:dgram';
import net from 'node:net';

const IS_WINDOWS = process.platform === 'win32';
const RANGE = 200;

/** Порты в состоянии LISTEN и (если удаётся узнать) имя программы. */
function listeningPorts() {
  const map = new Map();
  try {
    if (IS_WINDOWS) {
      const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });
      const pids = new Map();
      for (const line of out.split(/\r?\n/)) {
        const f = line.trim().split(/\s+/);
        // Протокол  Локальный_адрес  Внешний_адрес  Состояние  PID (TCP); у UDP состояния нет
        if (f[0] !== 'TCP' || f.length < 5) continue;
        if (!/^0\.0\.0\.0:0$|^\[::\]:0$/.test(f[2])) continue; // только слушающие сокеты
        const port = Number(f[1].slice(f[1].lastIndexOf(':') + 1));
        if (port) pids.set(port, f[4]);
      }
      let names = new Map();
      try {
        const tl = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
        for (const line of tl.split(/\r?\n/)) {
          const m = /^"([^"]+)","(\d+)"/.exec(line);
          if (m) names.set(m[2], m[1]);
        }
      } catch {
        names = new Map();
      }
      for (const [port, pid] of pids) map.set(port, names.get(pid) || `PID ${pid}`);
    } else {
      const out = execFileSync('ss', ['-Hltnp'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      for (const line of out.split('\n')) {
        const f = line.trim().split(/\s+/);
        if (f.length < 4) continue;
        const local = f[3];
        const port = Number(local.slice(local.lastIndexOf(':') + 1));
        const proc = /users:\(\("([^"]+)"/.exec(line)?.[1];
        if (port) map.set(port, proc || 'другая программа');
      }
    }
  } catch {
    /* нет ss/netstat — полагаемся только на пробное занятие порта */
  }
  return map;
}

// Ошибки, означающие «IPv6 на этом компьютере нет» — порт при этом не занят.
const NO_IPV6 = new Set(['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT', 'EINVAL']);

function canBind(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (e) => resolve(host === '::' && NO_IPV6.has(e.code)));
    srv.listen({ port, host, exclusive: true, ipv6Only: false }, () => srv.close(() => resolve(true)));
  });
}

function canBindUdp(port, host) {
  return new Promise((resolve) => {
    const v6 = host.includes(':');
    const sock = dgram.createSocket({ type: v6 ? 'udp6' : 'udp4', ipv6Only: false });
    sock.once('error', (e) => { try { sock.close(); } catch { /* уже закрыт */ } resolve(v6 && NO_IPV6.has(e.code)); });
    sock.bind({ port, address: host, exclusive: true }, () => sock.close(() => resolve(true)));
  });
}

/**
 * Порт для всех адресов. Программы на Go (например, другой MediaMTX) слушают «:порт» —
 * двойной сокет IPv6 [::]; на Windows он не мешает занять 0.0.0.0:порт при проверке,
 * но сам MediaMTX потом не запустится. Поэтому проверяем и 0.0.0.0, и [::].
 */
async function canBindAll(port, udp) {
  const check = udp ? canBindUdp : canBind;
  return (await check(port, '0.0.0.0')) && (await check(port, '::'));
}

async function main() {
  const wants = process.argv.slice(2).map((a) => {
    const m = /^([a-z]+)=(\d+)@([^+/]+)(\+udp|\/udp)?$/i.exec(a);
    if (!m) throw new Error(`неверный аргумент: ${a}`);
    return { name: m[1], port: Number(m[2]), host: m[3], tcp: m[4] !== '/udp', udp: !!m[4] };
  });
  const listening = listeningPorts(); // слушающие TCP-порты
  const taken = new Map(); // 'tcp:порт' / 'udp:порт' -> имя, уже выданные в этом запуске
  const result = {};
  for (const w of wants) {
    let chosen = null;
    for (let p = w.port; p <= Math.min(65535, w.port + RANGE); p++) {
      if (w.tcp && (taken.has(`tcp:${p}`) || listening.has(p))) continue;
      if (w.udp && taken.has(`udp:${p}`)) continue;
      // Проверяем и 0.0.0.0, и нужный адрес: на Windows занятый 127.0.0.1:порт
      // не мешает занять 0.0.0.0:порт, но конфликт всё равно будет.
      if (w.tcp && w.host !== '0.0.0.0' && !(await canBind(p, w.host))) continue;
      if (w.tcp && !(await canBindAll(p, false))) continue;
      if (w.udp && w.host !== '0.0.0.0' && !(await canBindUdp(p, w.host))) continue;
      if (w.udp && !(await canBindAll(p, true))) continue;
      chosen = p;
      break;
    }
    if (chosen === null) throw new Error(`нет свободного порта в диапазоне ${w.port}–${w.port + RANGE}`);
    if (w.tcp) taken.set(`tcp:${chosen}`, w.name);
    if (w.udp) taken.set(`udp:${chosen}`, w.name);
    result[w.name] = {
      port: chosen,
      wanted: w.port,
      busyBy: chosen !== w.port
        ? (w.tcp && listening.get(w.port)) || (taken.get(`tcp:${w.port}`) || taken.get(`udp:${w.port}`) ? 'отдан другой службе RTSP Atom' : null)
          || 'другая программа или резерв системы'
        : null,
    };
  }
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(`ports.mjs: ${err.message}`);
  process.exit(1);
});
