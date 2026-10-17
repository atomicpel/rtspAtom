import fs from 'node:fs';
import os from 'node:os';

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  return { idle, total };
}

function memUsedPercent() {
  try {
    const info = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(info)?.[1] || 0);
    const total = get('MemTotal');
    const avail = get('MemAvailable');
    if (total > 0) return ((total - avail) / total) * 100;
  } catch {
    /* не Linux — используем os */
  }
  return ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;
}

function netBytes() {
  try {
    const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
    let rx = 0;
    let tx = 0;
    for (const line of lines) {
      const [iface, rest] = line.split(':');
      if (!rest || iface.trim() === 'lo') continue;
      const f = rest.trim().split(/\s+/).map(Number);
      rx += f[0] || 0;
      tx += f[8] || 0;
    }
    return { rx, tx };
  } catch {
    return null;
  }
}

/** Снимает показатели раз в несколько секунд и считает скорость по разнице. */
export class SystemMetrics {
  constructor() {
    this.prevCpu = cpuTimes();
    this.prevNet = netBytes();
    this.prevAt = Date.now();
    this.current = { cpu: 0, ram: Math.round(memUsedPercent()), networkIn: 0, networkOut: 0 };
    this.timer = null;
  }

  sample() {
    const now = Date.now();
    const cpu = cpuTimes();
    const dTotal = cpu.total - this.prevCpu.total;
    const dIdle = cpu.idle - this.prevCpu.idle;
    const net = netBytes();
    const sec = Math.max(0.001, (now - this.prevAt) / 1000);
    let networkIn = 0;
    let networkOut = 0;
    if (net && this.prevNet) {
      networkIn = ((net.rx - this.prevNet.rx) * 8) / sec / 1e6;
      networkOut = ((net.tx - this.prevNet.tx) * 8) / sec / 1e6;
    }
    this.current = {
      cpu: dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 100) : 0,
      ram: Math.round(memUsedPercent()),
      networkIn: Math.max(0, Math.round(networkIn * 10) / 10),
      networkOut: Math.max(0, Math.round(networkOut * 10) / 10),
    };
    this.prevCpu = cpu;
    this.prevNet = net;
    this.prevAt = now;
    return this.current;
  }

  start(everyMs = 2000) {
    this.timer = setInterval(() => this.sample(), everyMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }
}
