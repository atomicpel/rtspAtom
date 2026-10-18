import React, { useState } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import type { Stream } from '../lib/types';
import { inputCls } from './ui';

/** Адрес сервера для энкодера: адрес, по которому открыта панель, а если это localhost — адрес в сети. */
export function serverHost(addresses: string[] | undefined) {
  const h = window.location.hostname;
  const local = h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  return local && addresses?.length ? addresses[0] : h;
}

async function copyText(text: string, input: HTMLInputElement | null) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // По http (не localhost) буфер обмена браузеру недоступен — копируем через выделение
    if (!input) return false;
    input.select();
    try { return document.execCommand('copy'); } catch { return false; }
  }
}

function CopyRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [done, setDone] = useState(false);
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <div>
      <span className="block text-[13px] text-muted mb-1.5">{label}</span>
      <div className="flex gap-1.5">
        <input ref={ref} readOnly value={value} onFocus={(e) => e.target.select()}
          className={`${inputCls} font-mono text-[13px]`} aria-label={label} />
        <button type="button" title="Скопировать" aria-label={`Скопировать: ${label}`}
          onClick={async () => { if (await copyText(value, ref.current)) { setDone(true); setTimeout(() => setDone(false), 1500); } }}
          className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-md bg-raised text-muted hover:text-fg hover:bg-line-strong transition-colors">
          {done ? <Check className="w-4 h-4 text-ok" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      {hint && <span className="block text-xs text-muted mt-1.5">{hint}</span>}
    </div>
  );
}

/** Что вписать в энкодер, который отправляет поток сам (RTMP или SRT). */
export function EncoderInfo({ stream, addresses, onNewKey, busy }: {
  stream: Stream; addresses?: string[]; onNewKey: () => void; busy?: boolean;
}) {
  const p = stream.push;
  if (!p) return null;
  const host = serverHost(addresses);
  const rtmpServer = `rtmp://${host}:${p.rtmpPort}/live`;
  const srt = `srt://${host}:${p.srtPort}?streamid=publish:${p.path}&latency=20000`;
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-[1fr_270px] gap-4">
        <CopyRow label="RTMP: адрес сервера (URL)" value={rtmpServer} />
        <CopyRow label="RTMP: ключ потока (Stream key)" value={p.key} />
      </div>
      <CopyRow label="RTMP: полный адрес — если в энкодере одно поле" value={`${rtmpServer}/${p.key}`} />
      <CopyRow label="SRT (режим Caller) — только для сети с потерями" value={srt}
        hint="Режим SRT в энкодере — Caller. Поле «Latency» — минимальное (20 мс). Даже так SRT добавляет около 0,15 с буфера на сервере: в локальной сети берите RTMP или RTSP." />
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={onNewKey} disabled={busy}
          className="inline-flex items-center gap-2 h-8 px-3 rounded-md text-[13px] text-muted hover:text-fg hover:bg-raised transition-colors disabled:opacity-50">
          <KeyRound className="w-4 h-4" /> Выдать новый ключ
        </button>
        <span className="text-xs text-muted">Ключ — пароль на публикацию: кто его знает, может подменить видео. После смены перенастройте энкодер.</span>
      </div>
    </div>
  );
}

/** Короткая памятка: настройки энкодера для минимальной задержки. */
export function EncoderTips() {
  return (
    <details className="group border border-line rounded-md">
      <summary className="cursor-pointer select-none px-3 py-2 text-[13px] text-fg hover:bg-raised/60 rounded-md">
        Настройки энкодера для минимальной задержки
      </summary>
      <ul className="px-4 pb-3 pt-1 space-y-1 text-[13px] text-muted list-disc list-inside">
        <li><b className="text-fg">Кодек H.264</b>, профиль Main или High. H.265 браузеры по WebRTC не везде показывают.</li>
        <li><b className="text-fg">B-кадры: 0</b> (B-frames off). С B-кадрами WebRTC в браузере дёргается.</li>
        <li><b className="text-fg">GOP / I-frame interval = частоте кадров</b> (25 при 25 к/с) — картинка открывается за долю секунды.</li>
        <li><b className="text-fg">CBR</b>, 4–8 Мбит/с для 1080p; 25–30 к/с.</li>
        <li><b className="text-fg">Low latency / Zero latency</b> — включить, если есть.</li>
        <li><b className="text-fg">Звук:</b> Opus или G.711 — идёт по WebRTC; AAC — только по HLS; не нужен — выключить.</li>
        <li><b className="text-fg">Протокол</b> (замер: задержка камера → экран): RTSP-сервер энкодера ≈ 0,05 с (добавьте поток «по адресу»),
          RTMP ≈ 0,05 с, UDP MPEG-TS ≈ 0,08 с, SRT ≈ 0,2 с, HLS ≈ 0,7 с и больше. Берите RTSP или RTMP.</li>
      </ul>
    </details>
  );
}
