import type { ArchiveSpan } from './types';

/** Промежуток записи в миллисекундах. */
export interface Span {
  s: number;
  e: number;
}

export const SEC = 1000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function toSpans(list: ArchiveSpan[]): Span[] {
  return list
    .map((x) => {
      const s = Date.parse(x.start);
      return { s, e: s + x.duration * SEC };
    })
    .filter((x) => Number.isFinite(x.s) && x.e > x.s)
    .sort((a, b) => a.s - b.s);
}

/** Промежуток, в который попадает момент t (с запасом у конца, чтобы не просить пустой хвост). */
export function spanAt(spans: Span[] | undefined, t: number): Span | undefined {
  return spans?.find((sp) => t >= sp.s - 250 && t < sp.e - 500);
}

export function nextSpanStart(spans: Span[] | undefined, t: number): number | null {
  const sp = spans?.find((x) => x.s > t);
  return sp ? sp.s : null;
}

export function prevSpanEnd(spans: Span[] | undefined, t: number): number | null {
  let best: number | null = null;
  for (const sp of spans || []) if (sp.e < t) best = sp.e;
  return best;
}

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const p2 = (n: number) => String(n).padStart(2, '0');

export function fmtTime(t: number, sec = true): string {
  const d = new Date(t);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}${sec ? `:${p2(d.getSeconds())}` : ''}`;
}

export function fmtDate(t: number): string {
  const d = new Date(t);
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** YYYY-MM-DD в местном времени (для <input type="date">). */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export function fromDayKey(k: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
}

/** YYYY-MM-DDTHH:MM:SS для <input type="datetime-local">. */
export function localInput(t: number): string {
  const d = new Date(t);
  return `${dayKey(t)}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

export const ZOOMS = [
  { span: DAY, label: '24 ч' },
  { span: 6 * HOUR, label: '6 ч' },
  { span: HOUR, label: '1 ч' },
  { span: 10 * MIN, label: '10 мин' },
  { span: 2 * MIN, label: '2 мин' },
];
export const MIN_VIEW = MIN;
export const MAX_VIEW = 7 * DAY;

const STEPS = [10 * SEC, 30 * SEC, MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY];

/** Деления шкалы: шаг подбирается так, чтобы подписей было не больше maxLabels. */
export function ticks(start: number, end: number, maxLabels: number) {
  const len = end - start;
  const step = STEPS.find((s) => len / s <= maxLabels) || DAY;
  const minor = STEPS.slice().reverse().find((s) => s < step && len / s <= maxLabels * 6) || step;
  const out: { t: number; major: boolean; label: string }[] = [];
  // выравнивание по местному времени: от начала суток
  const base = startOfDay(start);
  const first = base + Math.ceil((start - base) / minor) * minor;
  for (let t = first; t <= end; t += minor) {
    const major = (t - startOfDay(t)) % step === 0;
    const midnight = t === startOfDay(t);
    out.push({
      t,
      major,
      label: major ? (midnight && len > 6 * HOUR ? fmtDate(t).slice(0, 5) : fmtTime(t, step < MIN)) : '',
    });
  }
  return out;
}

export function fmtBytes(n: number): string {
  if (!n) return '0';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1).replace('.', ',')} ${u[i]}`;
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / SEC);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h) return `${h} ч ${m} мин`;
  if (m) return `${m} мин${ss ? ` ${ss} с` : ''}`;
  return `${ss} с`;
}
