import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bookmark as BookmarkIcon, Camera, ChevronLeft, ChevronRight, Download, ListVideo, Minus, Pause, Play, Plus,
  Rewind, FastForward, Search, SkipBack, SkipForward, Trash2, X,
} from 'lucide-react';
import type { ArchiveInfo, Bookmark } from '../lib/types';
import { api, errorMessage } from '../lib/api';
import {
  type Span, DAY, HOUR, MIN, MAX_VIEW, MIN_VIEW, SEC, ZOOMS, dayKey, fmtBytes, fmtDate, fmtDuration, fmtTime,
  fromDayKey, localInput, nextSpanStart, spanAt, startOfDay, toSpans,
} from '../lib/archiveTime';
import { useToast } from '../components/Toast';
import { onReconnected } from '../lib/connection';
import { ArchivePlayer } from '../components/archive/ArchivePlayer';
import { Timeline } from '../components/archive/Timeline';
import { Button, Field, IconButton, Modal, Notice, inputCls } from '../components/ui';

const RATES = [0.25, 0.5, 1, 2, 4, 8, 16];
const MAX_CELLS = 9;
const EXPORT_MAX = 2 * HOUR;
const SELECTED_KEY = 'rtspatom_archive_selected';

function readHashParams() {
  const q = window.location.hash.split('?')[1] || '';
  return new URLSearchParams(q);
}

function loadSelected(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SELECTED_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function ArchivePage() {
  const { toast } = useToast();
  const [info, setInfo] = useState<ArchiveInfo | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [spans, setSpans] = useState<Map<string, Span[]>>(new Map());
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [now, setNow] = useState(Date.now());

  const params = useMemo(readHashParams, []);
  const initT = (() => {
    const p = Date.parse(params.get('t') || '');
    return Number.isFinite(p) ? p : Date.now() - 5 * MIN;
  })();
  const [t, setT] = useState(initT);
  const tRef = useRef(initT);
  const [seekNonce, setSeekNonce] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(1);
  const [skipGaps, setSkipGaps] = useState(true);
  const [view, setView] = useState<[number, number]>(() => [startOfDay(initT), startOfDay(initT) + DAY]);
  const [selection, setSelection] = useState<{ s: number; e: number } | null>(null);

  const [panel, setPanel] = useState(false);
  const [bmQuery, setBmQuery] = useState('');
  const [bmFound, setBmFound] = useState<Bookmark[] | null>(null);
  const [bmOpen, setBmOpen] = useState(false);
  const [bmNote, setBmNote] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exp, setExp] = useState({ start: '', minutes: 2, ids: [] as string[] });

  const reports = useRef(new Map<string, { t: number | null; playing: boolean; at: number }>());
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const registerVideo = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) videos.current.set(id, el);
    else videos.current.delete(id);
  }, []);
  const onReport = useCallback((id: string, rt: number | null, p: boolean) => {
    reports.current.set(id, { t: rt, playing: p, at: Date.now() });
  }, []);

  // ---------- Загрузка ----------
  useEffect(() => {
    api.archive().then((a) => {
      setInfo(a);
      const ids = new Set(a.streams.map((s) => s.id));
      const fromUrl = params.get('stream');
      let sel = fromUrl && ids.has(fromUrl) ? [fromUrl] : loadSelected().filter((id) => ids.has(id));
      if (!sel.length) sel = a.streams.filter((s) => s.record || s.bytes > 0).slice(0, 4).map((s) => s.id);
      setSelected(sel);
      setFocusId(sel[0] || null);
    }).catch((err) => toast('error', errorMessage(err)));
    const id = setInterval(() => api.archive().then(setInfo).catch(() => {}), 60_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { localStorage.setItem(SELECTED_KEY, JSON.stringify(selected)); } catch { /* недоступно */ }
  }, [selected]);

  // связь восстановилась: обновить сводку, промежутки и переподключить плееры
  useEffect(() => onReconnected(() => {
    api.archive().then((a) => {
      setInfo(a);
      setSelected((sel) => {
        if (sel.length) return sel;
        return a.streams.filter((s) => s.record || s.bytes > 0).slice(0, 4).map((s) => s.id);
      });
    }).catch(() => {});
    setSeekNonce((n) => n + 1);
  }), []);

  // Промежутки записи для видимого окна (с запасом по краям), обновление каждые 20 с у «живого» края
  const loadSpans = useCallback(async () => {
    if (!info) return;
    const [vs, ve] = view;
    const pad = Math.min(ve - vs, DAY);
    const from = new Date(vs - pad);
    const to = new Date(Math.min(ve + pad, Date.now() + MIN));
    const res = await Promise.all(info.streams.map((s) =>
      api.archiveSpans(s.id, from, to).then((l) => [s.id, toSpans(l)] as const).catch(() => [s.id, undefined] as const)));
    // не удалось получить промежутки (перегрузка, лимит запросов) — оставляем прежние и повторяем
    setSpans((prev) => {
      const next = new Map(prev);
      for (const [id, list] of res) if (list) next.set(id, list);
      return next;
    });
    if (res.some((r) => !r[1])) {
      clearTimeout(spansRetry.current);
      spansRetry.current = setTimeout(() => loadSpansRef.current(), 3000);
    }
  }, [info, view]);
  const spansRetry = useRef<ReturnType<typeof setTimeout>>();
  const loadSpansRef = useRef(loadSpans);
  loadSpansRef.current = loadSpans;
  useEffect(() => () => clearTimeout(spansRetry.current), []);

  useEffect(() => {
    const h = setTimeout(loadSpans, 250);
    return () => clearTimeout(h);
  }, [loadSpans]);
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      if (view[1] > Date.now() - HOUR && document.visibilityState === 'visible') loadSpans();
    }, 20_000);
    return () => clearInterval(id);
  }, [loadSpans, view]);

  const loadBookmarks = useCallback(() => {
    api.bookmarks({ from: new Date(view[0] - DAY), to: new Date(view[1] + DAY) }).then(setBookmarks).catch(() => {});
  }, [view]);
  useEffect(() => { loadBookmarks(); }, [loadBookmarks]);

  useEffect(() => {
    if (!bmQuery.trim()) { setBmFound(null); return; }
    const h = setTimeout(() => api.bookmarks({ q: bmQuery.trim() }).then(setBmFound).catch(() => {}), 300);
    return () => clearTimeout(h);
  }, [bmQuery]);

  // ---------- Время просмотра ----------
  const seek = useCallback((nt: number, keepView = false) => {
    const target = Math.min(nt, Date.now() - 2 * SEC);
    tRef.current = target;
    setT(target);
    reports.current.clear();
    setSeekNonce((n) => n + 1);
    if (!keepView) {
      setView((prev) => {
        const [vs, ve] = prev;
        const len = ve - vs;
        if (target >= vs && target <= ve) return prev; // то же окно — тот же объект, иначе загрузка промежутков откладывается бесконечно
        const ns = len >= DAY ? startOfDay(target) : target - len / 2;
        return [ns, ns + len];
      });
    }
  }, []);

  // Общие часы: ведущая — первая играющая камера; если ни одна не играет — время идёт само.
  // Пустые промежутки (нет записи ни на одной из выбранных камер) пропускаются.
  const live = useRef({ playing, rate, selected, spans, skipGaps });
  live.current = { playing, rate, selected, spans, skipGaps };
  useEffect(() => {
    const id = setInterval(() => {
      const L = live.current;
      if (!L.playing) return;
      const nowMs = Date.now();
      const master = L.selected.find((sid) => {
        const r = reports.current.get(sid);
        return r && r.t !== null && r.playing && nowMs - r.at < 1500;
      });
      let next = master ? (reports.current.get(master)!.t as number) : tRef.current + 250 * L.rate;
      if (!master) {
        const any = L.selected.some((sid) => spanAt(L.spans.get(sid), next));
        if (!any && L.skipGaps) {
          const starts = L.selected.map((sid) => nextSpanStart(L.spans.get(sid), next)).filter((x): x is number => x !== null);
          if (starts.length) {
            seek(Math.min(...starts));
            return;
          }
        }
      }
      if (next > nowMs - 3 * SEC) {
        next = nowMs - 3 * SEC;
        setPlaying(false);
        toast('info', 'Дошли до текущего момента');
      }
      tRef.current = next;
      setT(next);
      // окно шкалы следует за временем просмотра
      setView((prev) => {
        const [vs, ve] = prev;
        const len = ve - vs;
        if (next > ve - len * 0.02) return [next - len * 0.1, next - len * 0.1 + len];
        if (next < vs) return [next - len * 0.1, next - len * 0.1 + len];
        return prev; // то же окно — тот же объект, иначе загрузка промежутков откладывается бесконечно
      });
    }, 250);
    return () => clearInterval(id);
  }, [seek, toast]);

  // ---------- Действия ----------
  const toggleRow = (id: string) => {
    setSelected((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      if (s.length >= MAX_CELLS) {
        toast('info', `Одновременно — не больше ${MAX_CELLS} камер`);
        return s;
      }
      return [...s, id];
    });
    setFocusId(id);
  };

  const streamName = (id: string | null) => info?.streams.find((s) => s.id === id)?.name || '';
  const focused = focusId && selected.includes(focusId) ? focusId : selected[0] || null;

  const snapshot = () => {
    const v = focused ? videos.current.get(focused) : null;
    if (!v || !v.videoWidth) { toast('error', 'Нет кадра для снимка'); return; }
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const g = c.getContext('2d')!;
    g.drawImage(v, 0, 0);
    // подпись: камера и время кадра
    const label = `${streamName(focused)}  ${fmtDate(tRef.current)} ${fmtTime(tRef.current)}`;
    const fs = Math.max(14, Math.round(c.height / 36));
    g.font = `bold ${fs}px sans-serif`;
    const w = g.measureText(label).width;
    g.fillStyle = 'rgba(0,0,0,0.65)';
    g.fillRect(0, c.height - fs * 1.8, w + fs, fs * 1.8);
    g.fillStyle = '#fff';
    g.fillText(label, fs / 2, c.height - fs * 0.55);
    c.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `${streamName(focused).replace(/[\\/:*?"<>|\s]+/g, '_')}_${dayKey(tRef.current)}_${fmtTime(tRef.current).replace(/:/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  };

  const addBookmark = async () => {
    if (!focused) return;
    try {
      await api.addBookmark({ streamId: focused, ts: new Date(tRef.current).toISOString(), note: bmNote.trim() });
      toast('success', 'Закладка сохранена');
      setBmOpen(false);
      setBmNote('');
      loadBookmarks();
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  const goBookmark = (b: Bookmark) => {
    if (!selected.includes(b.streamId)) setSelected((s) => [...s.slice(-(MAX_CELLS - 1)), b.streamId]);
    setFocusId(b.streamId);
    seek(Date.parse(b.ts) - 5 * SEC);
  };

  const removeBookmark = async (b: Bookmark) => {
    if (!confirm('Удалить закладку?')) return;
    try {
      await api.deleteBookmark(b.id);
      loadBookmarks();
      if (bmFound) setBmFound(bmFound.filter((x) => x.id !== b.id));
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  const openExport = () => {
    const s = selection ? selection.s : tRef.current - MIN;
    const minutes = selection ? Math.max(1, Math.min(120, Math.round((selection.e - selection.s) / MIN))) : 2;
    setExp({ start: localInput(s), minutes, ids: focused ? [focused] : selected.slice(0, 1) });
    setExportOpen(true);
  };
  const doExport = () => {
    const s = new Date(exp.start).getTime();
    if (!Number.isFinite(s)) { toast('error', 'Укажите начало'); return; }
    const dur = Math.min(EXPORT_MAX / SEC, exp.minutes * 60);
    exp.ids.forEach((id, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = `/archive/${encodeURIComponent(id)}/video?start=${encodeURIComponent(new Date(s).toISOString())}&duration=${dur}&download=1`;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 800);
    });
    toast('info', exp.ids.length > 1 ? `Выгрузка ${exp.ids.length} файлов началась` : 'Выгрузка началась');
    setExportOpen(false);
  };

  const zoomTo = (len: number) => {
    const nl = Math.min(MAX_VIEW, Math.max(MIN_VIEW, len));
    const c = tRef.current;
    setView(nl >= DAY ? [startOfDay(c), startOfDay(c) + nl] : [c - nl / 2, c + nl / 2]);
  };
  const shiftDay = (d: number) => goDay(startOfDay(tRef.current) + d * DAY + HOUR);
  const goDay = (dayMs: number) => {
    const day = startOfDay(dayMs);
    setView([day, day + DAY]);
    const first = selected.map((id) => nextSpanStart(spans.get(id), day - 1)).filter((x): x is number => x !== null && x < day + DAY);
    seek(first.length ? Math.min(...first) : day, true);
  };
  const changeRate = (dir: number) => {
    const i = RATES.indexOf(rate);
    setRate(RATES[Math.max(0, Math.min(RATES.length - 1, i + dir))]);
  };

  // ---------- Клавиатура ----------
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || bmOpen || exportOpen) return;
    // пробел на кнопке в фокусе нажал бы её ещё раз — снимаем фокус и обрабатываем сами
    if (e.key === ' ' && tag === 'BUTTON') (e.target as HTMLElement).blur();
    if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(tRef.current - (e.shiftKey ? MIN : 10 * SEC)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seek(tRef.current + (e.shiftKey ? MIN : 10 * SEC)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); changeRate(1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); changeRate(-1); }
    else if ((e.key.toLowerCase() === 'b' || e.key.toLowerCase() === 'и') && focused) { e.preventDefault(); setBmOpen(true); }
    else if (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'ы') { e.preventDefault(); snapshot(); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ---------- Разметка ----------
  const rows = (info?.streams || []).map((s) => ({
    id: s.id, name: s.name, record: s.record, selected: selected.includes(s.id), spans: spans.get(s.id),
  }));
  const cols = selected.length <= 1 ? 1 : selected.length <= 4 ? 2 : 3;
  const list = bmFound ?? bookmarks.filter((b) => {
    const ts = Date.parse(b.ts);
    return ts >= startOfDay(t) && ts < startOfDay(t) + DAY;
  });
  const capacity = info?.capacityDays ?? null;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Панель управления */}
        <div className="flex items-center gap-1 flex-wrap px-2 py-1.5 border-b border-line bg-ink">
          <div className="flex items-center gap-0.5 pr-2 mr-1 border-r border-line">
            <IconButton icon={ChevronLeft} label="Предыдущие сутки" onClick={() => shiftDay(-1)} />
            <input type="date" aria-label="Дата" value={dayKey(t)} max={dayKey(now)}
              onChange={(e) => {
                const d = fromDayKey(e.target.value);
                if (d !== null) goDay(d);
              }}
              className="h-8 px-2 rounded-md bg-raised border border-line text-fg text-sm tabular [color-scheme:dark]" />
            <IconButton icon={ChevronRight} label="Следующие сутки" onClick={() => shiftDay(1)} disabled={startOfDay(t) >= startOfDay(now)} />
          </div>
          <span className="px-2 text-lg font-bold tabular" aria-live="off" title="Время просмотра">{fmtTime(t)}</span>
          <div className="flex items-center gap-0.5 px-1">
            <IconButton icon={SkipBack} label="Назад 1 мин (Shift+←)" onClick={() => seek(t - MIN)} />
            <IconButton icon={Rewind} label="Назад 10 с (←)" onClick={() => seek(t - 10 * SEC)} />
            <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Пауза (пробел)' : 'Воспроизвести (пробел)'}
              title={playing ? 'Пауза (пробел)' : 'Воспроизвести (пробел)'}
              className="w-9 h-9 inline-flex items-center justify-center rounded-full bg-fg text-ink hover:bg-white transition-colors">
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <IconButton icon={FastForward} label="Вперёд 10 с (→)" onClick={() => seek(t + 10 * SEC)} />
            <IconButton icon={SkipForward} label="Вперёд 1 мин (Shift+→)" onClick={() => seek(t + MIN)} />
          </div>
          <div className="flex items-center gap-0.5 px-1" role="group" aria-label="Скорость">
            <IconButton icon={Minus} label="Медленнее (↓)" onClick={() => changeRate(-1)} disabled={rate === RATES[0]} />
            <span className="w-11 text-center text-sm tabular" title="Скорость">{String(rate).replace('.', ',')}×</span>
            <IconButton icon={Plus} label="Быстрее (↑)" onClick={() => changeRate(1)} disabled={rate === RATES[RATES.length - 1]} />
          </div>
          <label className="hidden md:flex items-center gap-1.5 px-2 text-[13px] text-muted cursor-pointer" title="Пропускать промежутки без записи">
            <input type="checkbox" checked={skipGaps} onChange={(e) => setSkipGaps(e.target.checked)} className="accent-[var(--color-steel)]" />
            пропускать пустоты
          </label>
          <div className="ml-auto flex items-center gap-0.5">
            <IconButton icon={BookmarkIcon} label="Закладка на этот момент (B)" onClick={() => setBmOpen(true)} disabled={!focused} />
            <IconButton icon={Camera} label="Снимок кадра (S)" onClick={snapshot} disabled={!focused} />
            <IconButton icon={Download} label="Выгрузить фрагмент в MP4" onClick={openExport} disabled={!selected.length} />
            <IconButton icon={ListVideo} label="Закладки" onClick={() => setPanel((p) => !p)} active={panel} />
          </div>
        </div>

        {/* Видео */}
        <div className="flex-1 min-h-0 grid gap-px bg-line"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: 'minmax(0, 1fr)' }}>
          {selected.map((id) => (
            <ArchivePlayer key={id} streamId={id} name={streamName(id)} spans={spans.get(id)} clockT={t} seekNonce={seekNonce}
              playing={playing} rate={rate} focused={id === focused && selected.length > 1} onFocus={() => setFocusId(id)}
              onReport={onReport} registerVideo={registerVideo} />
          ))}
          {!selected.length && (
            <div className="flex items-center justify-center bg-ink text-muted text-sm px-6 text-center">
              Выберите камеры: щёлкните по названию на шкале ниже (до {MAX_CELLS} одновременно).
            </div>
          )}
        </div>

        {/* Шкала */}
        <div className="shrink-0 border-t border-line bg-panel max-h-[42vh] overflow-y-auto">
          <div className="flex items-center gap-1 flex-wrap px-2 py-1 border-b border-line">
            <div className="flex items-center gap-0.5" role="group" aria-label="Масштаб шкалы">
              {ZOOMS.map((z) => (
                <button key={z.span} type="button" onClick={() => zoomTo(z.span)}
                  className={`h-7 px-2 rounded text-[12px] transition-colors ${Math.abs(view[1] - view[0] - z.span) < 1000 ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}>
                  {z.label}
                </button>
              ))}
            </div>
            {selection && (
              <span className="flex items-center gap-1 ml-2 text-[12px] text-warn">
                Выделено {fmtTime(selection.s)}–{fmtTime(selection.e)} ({fmtDuration(selection.e - selection.s)})
                <button type="button" onClick={openExport} className="underline hover:no-underline">выгрузить</button>
                <IconButton icon={X} label="Снять выделение" onClick={() => setSelection(null)} />
              </span>
            )}
            <span className="ml-auto text-[11px] text-muted hidden lg:block">
              щелчок — перейти · Shift+перетаскивание — выделить · колесо — масштаб · ← → ±10 с · пробел — пауза
            </span>
          </div>
          <Timeline rows={rows} bookmarks={bookmarks} viewStart={view[0]} viewEnd={view[1]} now={now} t={t}
            selection={selection} onSeek={(x) => seek(x, true)} onSelect={setSelection} onView={(a, b) => setView([a, b])}
            onToggleRow={toggleRow} onBookmark={goBookmark} />
          {info && (
            <div className="px-3 py-1.5 text-[12px] text-muted border-t border-line flex flex-wrap gap-x-4">
              <span>Архив: {fmtBytes(info.totalBytes)}</span>
              {info.disk && <span>свободно {fmtBytes(info.disk.free)} из {fmtBytes(info.disk.size)}</span>}
              {info.bytesPerDay > 0 && <span>запись ≈ {fmtBytes(info.bytesPerDay)} в сутки</span>}
              <span>хранение {info.days} сут.</span>
              {capacity !== null && capacity < info.days && (
                <span className="text-warn">места хватит примерно на {Math.floor(capacity)} сут. — старые записи будут удаляться раньше</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Закладки */}
      <AnimatePresence initial={false}>
        {panel && (
          <motion.aside initial={{ width: 0, opacity: 0 }} animate={{ width: 300, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.18 }} className="shrink-0 border-l border-line bg-panel overflow-hidden flex flex-col">
            <div className="p-3 border-b border-line">
              <div className="relative">
                <Search className="w-4 h-4 text-muted absolute left-2.5 top-2.5" />
                <input className={`${inputCls} pl-8`} placeholder="Поиск по закладкам" value={bmQuery} onChange={(e) => setBmQuery(e.target.value)} />
              </div>
              <p className="text-[11px] text-muted mt-1.5">{bmFound ? `Найдено: ${bmFound.length}` : `За ${fmtDate(t)}: ${list.length}`}</p>
            </div>
            <ul className="flex-1 overflow-y-auto divide-y divide-line">
              {list.map((b) => (
                <li key={b.id} className="group px-3 py-2 hover:bg-raised/60 cursor-pointer" onClick={() => goBookmark(b)}>
                  <div className="flex items-center gap-2 text-[12px] text-muted">
                    <span className="tabular text-fg">{fmtDate(Date.parse(b.ts)) !== fmtDate(t) ? `${fmtDate(Date.parse(b.ts))} ` : ''}{fmtTime(Date.parse(b.ts))}</span>
                    <span className="truncate">{streamName(b.streamId)}</span>
                    {b.canDelete && (
                      <button type="button" aria-label="Удалить закладку" onClick={(e) => { e.stopPropagation(); removeBookmark(b); }}
                        className="ml-auto opacity-0 group-hover:opacity-100 text-muted hover:text-alarm"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                  <p className="text-[13px] mt-0.5 break-words">{b.note || <span className="text-muted">без описания</span>}</p>
                  <p className="text-[11px] text-muted mt-0.5">{b.user}</p>
                </li>
              ))}
              {!list.length && <li className="px-3 py-6 text-center text-[13px] text-muted">Закладок нет. Кнопка с флажком или клавиша B отмечает текущий момент.</li>}
            </ul>
          </motion.aside>
        )}
      </AnimatePresence>

      <Modal open={bmOpen} onClose={() => setBmOpen(false)} title="Закладка"
        footer={<>
          <Button variant="ghost" onClick={() => setBmOpen(false)}>Отмена</Button>
          <Button variant="primary" onClick={addBookmark}>Сохранить</Button>
        </>}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); addBookmark(); }}>
          <p className="text-[13px] text-muted">{streamName(focused)}, {fmtDate(t)} {fmtTime(t)}</p>
          <Field label="Что произошло">
            <input className={inputCls} autoFocus value={bmNote} maxLength={500} placeholder="Например: машина у ворот"
              onChange={(e) => setBmNote(e.target.value)} />
          </Field>
        </form>
      </Modal>

      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title="Выгрузка фрагмента"
        footer={<>
          <Button variant="ghost" onClick={() => setExportOpen(false)}>Отмена</Button>
          <Button variant="primary" icon={Download} onClick={doExport} disabled={!exp.ids.length}>Скачать MP4</Button>
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_140px] gap-3">
            <Field label="Начало">
              <input type="datetime-local" step={1} className={`${inputCls} [color-scheme:dark]`} value={exp.start}
                onChange={(e) => setExp({ ...exp, start: e.target.value })} />
            </Field>
            <Field label="Длительность">
              <select className={inputCls} value={exp.minutes} onChange={(e) => setExp({ ...exp, minutes: Number(e.target.value) })}>
                {[...new Set([1, 2, 5, 10, 15, 30, 60, 120, exp.minutes])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} мин</option>)}
              </select>
            </Field>
          </div>
          <div>
            <span className="block text-[13px] text-muted mb-1.5">Камеры</span>
            <div className="max-h-48 overflow-y-auto border border-line rounded-md divide-y divide-line">
              {(info?.streams || []).map((s) => (
                <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-raised/60">
                  <input type="checkbox" checked={exp.ids.includes(s.id)} className="accent-[var(--color-steel)]"
                    onChange={(e) => setExp({ ...exp, ids: e.target.checked ? [...exp.ids, s.id] : exp.ids.filter((x) => x !== s.id) })} />
                  {s.name}
                </label>
              ))}
            </div>
          </div>
          <Notice>Файл MP4 открывается в любом плеере. Каждая камера — отдельный файл; выгрузка записывается в журнал.</Notice>
        </div>
      </Modal>
    </div>
  );
}
