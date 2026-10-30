import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Wand2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useToast } from '../components/Toast';
import { Button, Field, PageHeader, Section, inputCls } from '../components/ui';
import type { MonitorCheck, MonitorPoint, MonitorSnapshot } from '../lib/types';

const fmt1 = (v: number) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString('ru-RU');
const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1).replace('.', ',')} ГБ`;
const timeOf = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Линейный график за последний час: одна величина, перекрестие и подсказка при наведении. */
function LineChart({ points, field, unit, title, max }: { points: MonitorPoint[]; field: keyof MonitorPoint; unit: string; title: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const vals = points.map((p) => Number(p[field]) || 0);
  const top = Math.max(max ?? 0, ...vals, 1) * (max ? 1 : 1.15);
  const W = 600; const H = 120;
  const x = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * W : W);
  const y = (v: number) => H - (v / top) * H;
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = vals.length ? vals[vals.length - 1] : 0;
  const onMove = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || points.length < 2) return;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left) / r.width) * (points.length - 1)))));
  };
  const hv = hover !== null ? vals[hover] : null;
  return (
    <div className="border border-line rounded-md p-3 bg-panel">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[13px] text-muted">{title}</span>
        <span className="text-lg font-bold tabular">{fmt1(last)} <span className="text-[12px] text-muted font-normal">{unit}</span></span>
      </div>
      <div ref={ref} className="relative h-[120px]" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" role="img" aria-label={`${title}: сейчас ${fmt1(last)} ${unit}`}>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--color-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          {points.length > 1 && <path d={`${d}L${W},${H}L0,${H}Z`} fill="var(--color-steel)" opacity="0.12" />}
          {points.length > 1 && <path d={d} fill="none" stroke="var(--color-steel)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="var(--color-muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        </svg>
        <span className="absolute left-0 top-0 text-[10px] text-muted tabular">{fmt1(top)}</span>
        {hover !== null && hv !== null && (
          <div className="absolute -top-1 px-2 py-1 rounded bg-raised border border-line text-[12px] pointer-events-none whitespace-nowrap"
            style={{ left: `${(hover / Math.max(1, points.length - 1)) * 100}%`, transform: `translateX(${hover > points.length / 2 ? '-105%' : '5%'})` }}>
            <span className="text-muted">{timeOf(points[hover].t)}</span> · <span className="text-fg tabular">{fmt1(hv)} {unit}</span>
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted mt-1 tabular">
        <span>{points.length ? timeOf(points[0].t) : ''}</span><span>сейчас</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'ok' | 'warn' | 'alarm' }) {
  const color = tone === 'alarm' ? 'text-alarm' : tone === 'warn' ? 'text-warn' : 'text-fg';
  return (
    <div className="border border-line rounded-md p-3 bg-panel min-w-0">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={`text-2xl font-bold tabular mt-0.5 ${color}`}>{value}</div>
      {sub && <div className="text-[12px] text-muted mt-0.5 leading-snug">{sub}</div>}
    </div>
  );
}

const LEVEL = {
  error: { icon: AlertCircle, cls: 'text-alarm', label: 'Ошибка' },
  warn: { icon: AlertTriangle, cls: 'text-warn', label: 'Внимание' },
  info: { icon: Info, cls: 'text-steel', label: 'Совет' },
} as const;

function CheckRow({ c }: { c: MonitorCheck }) {
  const L = LEVEL[c.level];
  return (
    <li className="flex gap-3 py-2.5">
      <L.icon className={`w-4 h-4 mt-0.5 shrink-0 ${L.cls}`} aria-label={L.label} />
      <div className="min-w-0">
        <p className="text-sm text-fg"><span className="text-muted">{c.area}: </span>{c.title}</p>
        {c.detail && <p className="text-[12.5px] text-muted mt-0.5">{c.detail}</p>}
        {c.fix && <p className="text-[12.5px] mt-0.5"><span className="text-muted">Что сделать: </span>{c.fix}</p>}
      </div>
    </li>
  );
}

function EncodersBlock({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [d, setD] = useState({ login: 'admin', password: '', minKbps: 600, maxKbps: 2000, hasPassword: false });
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState<{ name: string; ok: boolean; error?: string; changed?: Record<string, unknown> }[] | null>(null);
  useEffect(() => { api.encoderDefaults().then((x) => setD({ ...x, password: '' })).catch(() => {}); }, []);
  const num = (v: string, def: number) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try { await fn(); onDone(); } catch (err) { toast('error', errorMessage(err)); } finally { setBusy(''); }
  };
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">
        Логин и пароль веб-интерфейса, общие для всех энкодеров, и пределы битрейта для автоподстройки. У отдельного потока
        можно задать свои — в его окне («Энкодер: автоподстройка…»).
      </p>
      <div className="grid sm:grid-cols-4 gap-3">
        <Field label="Логин"><input className={inputCls} value={d.login} onChange={(e) => setD({ ...d, login: e.target.value })} /></Field>
        <Field label="Пароль"><input type="password" className={inputCls} value={d.password} autoComplete="new-password" placeholder={d.hasPassword ? 'без изменений' : ''} onChange={(e) => setD({ ...d, password: e.target.value })} /></Field>
        <Field label="Минимум, Кбит/с"><input type="number" className={inputCls} value={d.minKbps} onChange={(e) => setD({ ...d, minKbps: num(e.target.value, 600) })} /></Field>
        <Field label="Максимум, Кбит/с"><input type="number" className={inputCls} value={d.maxKbps} onChange={(e) => setD({ ...d, maxKbps: num(e.target.value, 2000) })} /></Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button busy={busy === 'save'} onClick={() => run('save', async () => {
          const x = await api.saveEncoderDefaults({ login: d.login, password: d.password || undefined, minKbps: d.minKbps, maxKbps: d.maxKbps });
          setD({ ...x, password: '' }); toast('success', 'Общие настройки энкодеров сохранены');
        })}>Сохранить</Button>
        <Button variant="primary" busy={busy === 'on'} onClick={() => run('on', async () => {
          const r = await api.encodersAuto(true); toast('success', `Автоподстройка включена: энкодеров ${r.count}`);
        })}>Включить автоподстройку всем</Button>
        <Button variant="ghost" busy={busy === 'off'} onClick={() => run('off', async () => {
          const r = await api.encodersAuto(false); toast('info', `Автоподстройка выключена: энкодеров ${r.count}`);
        })}>Выключить всем</Button>
        <Button icon={Wand2} busy={busy === 'rec'} onClick={() => {
          if (!confirm('Записать в энкодеры рекомендуемые настройки (GOP = частоте кадров, лишние выходы выключить)? Каждый энкодер перезапустит поток на 2–3 секунды.')) return;
          run('rec', async () => { setResults((await api.encodersRecommended()).results); });
        }}>Рекомендуемые настройки всем</Button>
      </div>
      {results && (
        <ul className="text-[12.5px] space-y-0.5">
          {results.map((r) => (
            <li key={r.name} className={r.ok ? 'text-muted' : 'text-alarm'}>
              {r.name}: {r.ok ? (Object.keys(r.changed || {}).length ? `изменено ${Object.keys(r.changed || {}).join(', ')}` : 'уже настроен') : r.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StatusPage() {
  const { data, reload, error } = usePolling<MonitorSnapshot>(api.monitor, 5000);
  if (!data) return <div className="px-6 py-8 text-muted">{error || 'Загрузка состояния'}</div>;
  const p = data.point;
  const hist = data.history;
  const errors = data.checks.filter((c) => c.level === 'error').length;
  const warns = data.checks.filter((c) => c.level === 'warn').length;
  const memPct = data.mem ? Math.round((1 - data.mem.available / data.mem.total) * 100) : 0;
  const loadTone = data.load[0] > data.cores * 1.5 ? 'alarm' : data.load[0] > data.cores ? 'warn' : undefined;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 pb-24 space-y-6">
      <PageHeader title="Состояние" sub={`Обновляется каждые 5 с · ${new Date(data.at).toLocaleTimeString('ru-RU')}`} />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Процессор" value={`${p.cpu} %`} tone={p.cpu > 90 ? 'alarm' : p.cpu > 75 ? 'warn' : undefined}
          sub={`польз. ${p.user} · сист. ${p.system} · диск ${p.iowait} · st ${p.steal}`} />
        <Stat label={`Нагрузка (${data.cores} ядер)`} value={fmt1(data.load[0])} tone={loadTone} sub={`5 мин ${fmt1(data.load[1])} · 15 мин ${fmt1(data.load[2])}`} />
        <Stat label="Память" value={`${memPct} %`} tone={memPct > 90 ? 'warn' : undefined}
          sub={`${gb(data.mem.total - data.mem.available)} из ${gb(data.mem.total)}${data.mem.swapUsed > 0 ? ` · своп ${gb(data.mem.swapUsed)}` : ''}`} />
        <Stat label="Сеть" value={`${fmt1(p.rxMbps)}`} sub={`Мбит/с входящий · исходящий ${fmt1(p.txMbps)}`} />
        <Stat label="Потоки в сети" value={`${p.online} / ${p.total}`} tone={p.online < p.total ? 'warn' : undefined} />
        <Stat label="Испорченные кадры" value={p.errorsPerMin} tone={p.errorsPerMin >= 10 ? 'alarm' : p.errorsPerMin > 0 ? 'warn' : undefined} sub="в минуту, все потоки" />
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <LineChart points={hist} field="cpu" unit="%" title="Процессор за час" max={100} />
        <LineChart points={hist} field="rxMbps" unit="Мбит/с" title="Входящий трафик за час" />
        <LineChart points={hist} field="errorsPerMin" unit="в мин" title="Испорченные кадры за час" />
      </div>

      <Section title="Проверки" desc={errors || warns ? `Ошибок: ${errors}, предупреждений: ${warns}` : 'Всё в порядке'}>
        {data.checks.length === 0 ? (
          <p className="flex items-center gap-2 text-ok text-sm"><CheckCircle2 className="w-4 h-4" /> Проблем не найдено</p>
        ) : (
          <ul className="divide-y divide-line">{data.checks.map((c, i) => <CheckRow key={i} c={c} />)}</ul>
        )}
      </Section>

      <Section title="Потоки" desc="Входящий битрейт, потери и пропадания">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-muted text-left">
              <tr className="border-b border-line">
                <th className="py-1.5 pr-3 font-normal">Поток</th><th className="pr-3 font-normal">Состояние</th>
                <th className="pr-3 font-normal text-right">Кбит/с</th><th className="pr-3 font-normal text-right">Испорч./мин</th>
                <th className="pr-3 font-normal text-right">Пропад./час</th><th className="pr-3 font-normal text-right">Зрители</th>
                <th className="font-normal">Энкодер</th>
              </tr>
            </thead>
            <tbody>
              {data.streams.filter((s) => s.active).map((s) => (
                <tr key={s.id} className="border-b border-line last:border-b-0">
                  <td className="py-1.5 pr-3 text-fg">{s.name}</td>
                  <td className={`pr-3 ${s.online ? 'text-ok' : 'text-alarm'}`}>{s.online ? 'в сети' : 'нет потока'}</td>
                  <td className="pr-3 text-right tabular">{s.kbps || '—'}</td>
                  <td className={`pr-3 text-right tabular ${s.errorsPerMin >= 10 ? 'text-alarm' : s.errorsPerMin > 0 ? 'text-warn' : ''}`}>{s.errorsPerMin}</td>
                  <td className={`pr-3 text-right tabular ${s.dropsPerHour >= 3 ? 'text-warn' : ''}`}>{s.dropsPerHour}</td>
                  <td className="pr-3 text-right tabular">{s.readers}</td>
                  <td className="text-muted">
                    {s.encoderSettings ? `${s.encoderSettings.bitrate} Кбит/с, ${s.encoderSettings.framerate} к/с, GOP ${s.encoderSettings.gop}` : '—'}
                    {s.encoderAuto && <span className="ml-2 text-ok">авто{s.tuner?.currentKbps ? ` ${s.tuner.currentKbps}` : ''}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Энкодеры" desc="Доступ и автоподстройка для всех сразу">
        <EncodersBlock onDone={reload} />
      </Section>

      <Section title="Сервер" desc="Что занимает процессор, сетевые карты">
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-[13px] text-muted mb-1.5">Процессы (% одного ядра)</div>
            <table className="w-full text-[13px]">
              <tbody>
                {data.top.map((t) => (
                  <tr key={t.name} className="border-b border-line last:border-b-0">
                    <td className="py-1 pr-3 text-fg">{t.name}{t.count > 1 ? <span className="text-muted"> ×{t.count}</span> : null}</td>
                    <td className="text-right tabular">{t.cpu} %</td>
                  </tr>
                ))}
                {data.top.length === 0 && <tr><td className="text-muted py-1">нет данных (только Linux)</td></tr>}
              </tbody>
            </table>
          </div>
          <div>
            <div className="text-[13px] text-muted mb-1.5">Сетевые карты</div>
            <table className="w-full text-[13px]">
              <tbody>
                {data.ifaces.map((i) => (
                  <tr key={i.name} className="border-b border-line last:border-b-0">
                    <td className="py-1 pr-3 text-fg">{i.name}<span className="text-muted"> {i.driver}</span></td>
                    <td className="pr-3 text-muted">{i.speed ? `${i.speed} Мбит/с` : ''} {i.duplex || ''}</td>
                    <td className="pr-3 text-right tabular">↓{fmt1(i.rxMbps)} ↑{fmt1(i.txMbps)}</td>
                    <td className={`text-right tabular ${i.rxErrors + i.txErrors > 0 ? 'text-warn' : 'text-muted'}`}>ошибок {i.rxErrors + i.txErrors}, отброшено {i.rxDropped + i.txDropped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>
    </div>
  );
}
