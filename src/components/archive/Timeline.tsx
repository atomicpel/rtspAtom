import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type Span, MAX_VIEW, MIN_VIEW, fmtDate, fmtTime, ticks } from '../../lib/archiveTime';
import type { Bookmark } from '../../lib/types';

export interface TimelineRow {
  id: string;
  name: string;
  selected: boolean;
  record: boolean;
  spans: Span[] | undefined;
}

interface Props {
  rows: TimelineRow[];
  bookmarks: Bookmark[];
  viewStart: number;
  viewEnd: number;
  now: number;
  t: number;
  selection: { s: number; e: number } | null;
  onSeek: (t: number) => void;
  onSelect: (sel: { s: number; e: number } | null) => void;
  onView: (start: number, end: number) => void;
  onToggleRow: (id: string) => void;
  onBookmark: (b: Bookmark) => void;
}

const LABEL_W = 'w-28 sm:w-44';

/**
 * Шкала времени по всем камерам: промежутки записи, закладки, текущий момент.
 * Перетаскивание — перемотка, Shift+перетаскивание — выделение для выгрузки,
 * колесо — масштаб вокруг курсора, перетаскивание по верхней шкале — сдвиг.
 */
export function Timeline({
  rows, bookmarks, viewStart, viewEnd, now, t, selection, onSeek, onSelect, onView, onToggleRow, onBookmark,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ mode: 'seek' | 'select' | 'pan'; from: number; to: number; view0?: [number, number]; x0?: number } | null>(null);
  const len = viewEnd - viewStart;

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pct = (x: number) => ((x - viewStart) / len) * 100;
  const timeAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return viewStart + ((clientX - r.left) / r.width) * len;
  };
  const tickList = useMemo(() => ticks(viewStart, viewEnd, Math.max(4, Math.floor(width / 90))), [viewStart, viewEnd, width]);

  // Колесо мыши: масштаб вокруг курсора (обработчик не пассивный, чтобы не прокручивать страницу)
  useEffect(() => {
    const el = trackRef.current?.parentElement;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!trackRef.current) return;
      e.preventDefault();
      const at = timeAt(e.clientX);
      const k = e.deltaY > 0 ? 1.25 : 0.8;
      const nl = Math.min(MAX_VIEW, Math.max(MIN_VIEW, len * k));
      const ratio = (at - viewStart) / len;
      onView(at - ratio * nl, at - ratio * nl + nl);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const down = (e: React.PointerEvent, mode: 'seek' | 'pan') => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const at = timeAt(e.clientX);
    if (mode === 'pan') setDrag({ mode, from: at, to: at, view0: [viewStart, viewEnd], x0: e.clientX });
    else setDrag({ mode: e.shiftKey ? 'select' : 'seek', from: at, to: at });
  };
  const move = (e: React.PointerEvent) => {
    if (!trackRef.current) return;
    const at = timeAt(e.clientX);
    setHover(at);
    if (!drag) return;
    if (drag.mode === 'pan' && drag.view0 && drag.x0 !== undefined) {
      const r = trackRef.current.getBoundingClientRect();
      const dt = ((e.clientX - drag.x0) / r.width) * (drag.view0[1] - drag.view0[0]);
      onView(drag.view0[0] - dt, drag.view0[1] - dt);
    } else setDrag({ ...drag, to: at });
  };
  const up = () => {
    if (!drag) return;
    if (drag.mode === 'seek') onSeek(Math.min(drag.to, now));
    if (drag.mode === 'select') {
      const s = Math.min(drag.from, drag.to);
      const e = Math.min(Math.max(drag.from, drag.to), now);
      onSelect(e - s >= 2000 ? { s, e } : null);
    }
    setDrag(null);
  };

  const playhead = drag?.mode === 'seek' ? drag.to : t;
  const sel = drag?.mode === 'select' ? { s: Math.min(drag.from, drag.to), e: Math.max(drag.from, drag.to) } : selection;
  const bmByStream = useMemo(() => {
    const m = new Map<string, Bookmark[]>();
    for (const b of bookmarks) {
      const ts = Date.parse(b.ts);
      if (ts < viewStart || ts > viewEnd) continue;
      m.set(b.streamId, [...(m.get(b.streamId) || []), b]);
    }
    return m;
  }, [bookmarks, viewStart, viewEnd]);

  return (
    <div className="select-none">
      {/* Верхняя шкала: подписи времени, перетаскивание сдвигает окно */}
      <div className="flex">
        <div className={`${LABEL_W} shrink-0 px-2 text-[11px] text-muted flex items-end pb-1`}>{fmtDate(viewStart)}</div>
        <div className="relative flex-1 h-6 cursor-grab active:cursor-grabbing border-b border-line"
          onPointerDown={(e) => down(e, 'pan')} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHover(null)}
          title="Перетащите, чтобы сдвинуть шкалу; колесо мыши — масштаб">
          {tickList.map((k) => (
            <div key={k.t} className="absolute bottom-0" style={{ left: `${pct(k.t)}%` }}>
              <div className={`w-px ${k.major ? 'h-2.5 bg-line-strong' : 'h-1.5 bg-line'}`} />
              {k.label && <span className="absolute bottom-3 -translate-x-1/2 text-[11px] text-muted tabular whitespace-nowrap">{k.label}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="flex">
        {/* Названия камер: щелчок добавляет/убирает камеру из просмотра */}
        <div className={`${LABEL_W} shrink-0`}>
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => onToggleRow(r.id)} aria-pressed={r.selected}
              title={r.selected ? 'Убрать из просмотра' : 'Показать в просмотре'}
              className={`w-full h-7 px-2 flex items-center gap-1.5 text-left text-[12px] border-b border-line/60 transition-colors ${r.selected ? 'text-fg bg-steel/10' : 'text-muted hover:text-fg hover:bg-raised/60'}`}>
              <span className={`w-2 h-2 rounded-sm shrink-0 ${r.selected ? 'bg-steel' : 'border border-line-strong'}`} />
              <span className="truncate">{r.name}</span>
              {!r.record && <span className="ml-auto text-[10px] text-muted/70 shrink-0" title="Запись выключена">выкл</span>}
            </button>
          ))}
        </div>

        <div ref={trackRef} className="relative flex-1 cursor-crosshair overflow-hidden"
          onPointerDown={(e) => down(e, 'seek')} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHover(null)}>
          {/* сетка */}
          {tickList.filter((k) => k.major).map((k) => (
            <div key={k.t} className="absolute top-0 bottom-0 w-px bg-line/50 pointer-events-none" style={{ left: `${pct(k.t)}%` }} />
          ))}
          {/* будущее */}
          {now < viewEnd && (
            <div className="absolute top-0 bottom-0 bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,rgba(255,255,255,0.025)_4px,rgba(255,255,255,0.025)_8px)] pointer-events-none"
              style={{ left: `${Math.max(0, pct(now))}%`, right: 0 }} />
          )}
          {rows.map((r) => (
            <div key={r.id} className="relative h-7 border-b border-line/60">
              {(r.spans || []).filter((sp) => sp.e > viewStart && sp.s < viewEnd).map((sp) => (
                <div key={sp.s} className={`absolute top-1.5 bottom-1.5 rounded-[2px] ${r.selected ? 'bg-steel/80' : 'bg-steel/35'}`}
                  style={{ left: `${Math.max(0, pct(sp.s))}%`, width: `max(2px, ${Math.min(100, pct(sp.e)) - Math.max(0, pct(sp.s))}%)` }} />
              ))}
              {(bmByStream.get(r.id) || []).map((b) => (
                <button key={b.id} type="button" title={`${fmtTime(Date.parse(b.ts))} ${b.note || 'закладка'} (${b.user})`}
                  onPointerDown={(e) => e.stopPropagation()} onClick={() => onBookmark(b)}
                  className="absolute top-0 -translate-x-1/2 w-2.5 h-full flex justify-center group/bm" style={{ left: `${pct(Date.parse(b.ts))}%` }}>
                  <span className="w-0.5 h-full bg-warn/80 group-hover/bm:bg-warn" />
                  <span className="absolute top-0 w-2 h-2 rotate-45 -translate-y-1 bg-warn" />
                </button>
              ))}
            </div>
          ))}
          {/* выделение для выгрузки */}
          {sel && (
            <div className="absolute top-0 bottom-0 bg-warn/15 border-x border-warn/70 pointer-events-none"
              style={{ left: `${pct(sel.s)}%`, width: `${pct(sel.e) - pct(sel.s)}%` }} />
          )}
          {/* текущий момент */}
          {playhead >= viewStart && playhead <= viewEnd && (
            <div className="absolute top-0 bottom-0 w-px bg-alarm pointer-events-none" style={{ left: `${pct(playhead)}%` }}>
              <span className="absolute -top-px -translate-x-1/2 w-2 h-2 rotate-45 bg-alarm" />
            </div>
          )}
          {hover !== null && !drag && (
            <div className="absolute top-0 bottom-0 w-px bg-fg/30 pointer-events-none" style={{ left: `${pct(hover)}%` }}>
              <span className="absolute top-0 left-1 px-1 rounded bg-ink/90 text-[11px] text-fg tabular whitespace-nowrap">{fmtTime(hover)}</span>
            </div>
          )}
          {rows.length === 0 && <p className="px-3 py-4 text-[13px] text-muted">Нет камер с доступом к архиву.</p>}
        </div>
      </div>
    </div>
  );
}
