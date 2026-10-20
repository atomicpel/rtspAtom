import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bookmark, Crop, Expand, History, Maximize, Minimize, MonitorPlay, Plus, RefreshCw, Replace, Search, Trash2, Video, Wand2, X,
} from 'lucide-react';
import type { Stream, WallCell, WallConfig, WallLayout } from '../lib/types';
import { api, ApiError, errorMessage } from '../lib/api';
import { onReconnected } from '../lib/connection';
import { usePolling } from '../lib/usePolling';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { VideoPlayer } from '../components/VideoPlayer';
import { Clock } from '../components/Layout';
import { Button, Empty, IconButton, Modal, StatusDot, inputCls } from '../components/ui';

const LAYOUTS: { id: WallLayout; n: number; cols: number }[] = [
  { id: '1x1', n: 1, cols: 1 },
  { id: '2x2', n: 4, cols: 2 },
  { id: '3x3', n: 9, cols: 3 },
  { id: '4x4', n: 16, cols: 4 },
];

const REFRESH = [
  { v: 0, l: 'Без автообновления' },
  { v: 60, l: 'Обновлять раз в минуту' },
  { v: 300, l: 'Раз в 5 минут' },
  { v: 900, l: 'Раз в 15 минут' },
  { v: 3600, l: 'Раз в час' },
];

const emptyCells = (): WallCell[] => Array.from({ length: 16 }, () => ({ streamId: null }));
const layoutFor = (count: number): WallLayout => (count <= 1 ? '1x1' : count <= 4 ? '2x2' : count <= 9 ? '3x3' : '4x4');
const camWord = (n: number) => (n === 1 ? 'камера' : n === 4 ? 'камеры' : 'камер');

/** Мини-схема сетки для переключателя раскладок. */
function GridGlyph({ cols }: { cols: number }) {
  return (
    <span className="grid gap-[2px] w-3.5 h-3.5" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {Array.from({ length: cols * cols }).map((_, i) => <span key={i} className="bg-current rounded-[1px]" />)}
    </span>
  );
}

function LayoutButton({ cols, label, active, onClick }: { cols: number; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} aria-pressed={active}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors ${active ? 'bg-raised text-fg' : 'text-muted hover:text-fg hover:bg-raised'}`}>
      <GridGlyph cols={cols} />
    </button>
  );
}

export function VideoWallPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: streamsData } = usePolling(api.streams, 10000);
  const streams = useMemo(() => streamsData || [], [streamsData]);
  const byId = useMemo(() => new Map(streams.map((s) => [s.id, s])), [streams]);

  const [loaded, setLoaded] = useState(false);
  const [layout, setLayout] = useState<WallLayout>('2x2');
  const [cells, setCells] = useState<WallCell[]>(emptyCells);
  const [refreshInterval, setRefreshInterval] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [configs, setConfigs] = useState<WallConfig[]>([]);
  const [fit, setFit] = useState<'contain' | 'cover'>(() => {
    try { return localStorage.getItem('rtspatom_fit') === 'cover' ? 'cover' : 'contain'; } catch { return 'contain'; }
  });
  // Разворачивать стену на весь экран при первом действии пользователя (браузеры не дают сделать это без него)
  const [autoFs, setAutoFs] = useState(() => {
    try { return localStorage.getItem('rtspatom_autofs') === '1'; } catch { return false; }
  });
  const [picker, setPicker] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [isFs, setIsFs] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const wallRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const firstFill = useRef(false);

  const L = LAYOUTS.find((l) => l.id === layout) || LAYOUTS[1];

  // ---------- загрузка и сохранение состояния ----------
  const [loadTry, setLoadTry] = useState(0);
  useEffect(() => onReconnected(() => setLoadTry((n) => n + 1)), []);
  useEffect(() => {
    if (loaded) return;
    let alive = true;
    Promise.all([api.wallState(), api.wallConfigs()])
      .then(([state, cfgs]) => {
        if (!alive) return;
        const full = emptyCells();
        (state.cells || []).forEach((c, i) => { if (i < 16) full[i] = { streamId: c.streamId || null }; });
        setLayout(state.layout || '2x2');
        setCells(full);
        setRefreshInterval(state.refreshInterval || 0);
        setConfigs(cfgs);
        firstFill.current = full.every((c) => !c.streamId);
        setLoaded(true);
      })
      .catch((err) => {
        // без связи состояние стены не трогаем: загрузим, когда сервер ответит (иначе пустая стена затёрла бы сохранённую)
        if (err instanceof ApiError && err.status === 0) return;
        toast('error', `Не удалось загрузить видеостену: ${errorMessage(err)}`);
        if (alive) setTimeout(() => setLoadTry((n) => n + 1), 5000);
      });
    return () => { alive = false; };
  }, [toast, loadTry, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => { api.saveWallState({ layout, cells, refreshInterval }).catch(() => {}); }, 600);
    return () => clearTimeout(t);
  }, [layout, cells, refreshInterval, loaded]);

  useEffect(() => { try { localStorage.setItem('rtspatom_fit', fit); } catch { /* хранилище недоступно */ } }, [fit]);
  useEffect(() => { try { localStorage.setItem('rtspatom_autofs', autoFs ? '1' : '0'); } catch { /* хранилище недоступно */ } }, [autoFs]);

  useEffect(() => {
    if (!autoFs) return;
    const go = (e: Event) => {
      if ((e.target as HTMLElement)?.closest?.('[data-autofs-skip]')) return;
      if (!document.fullscreenElement) wallRef.current?.requestFullscreen().catch(() => {});
    };
    window.addEventListener('pointerdown', go, { once: true });
    window.addEventListener('keydown', go, { once: true });
    return () => {
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
    };
  }, [autoFs]);

  const autoFill = useCallback((pickLayout: boolean) => {
    const list = streams.filter((s) => s.isActive);
    const lay = pickLayout ? layoutFor(list.length) : layout;
    const n = LAYOUTS.find((l) => l.id === lay)!.n;
    const next = emptyCells();
    list.slice(0, n).forEach((s, i) => { next[i] = { streamId: s.id }; });
    setLayout(lay);
    setCells(next);
    return Math.min(n, list.length);
  }, [streams, layout]);

  // Первый вход: стена пустая — расставляем все камеры сами
  useEffect(() => {
    if (loaded && streamsData && firstFill.current) {
      firstFill.current = false;
      if (streamsData.length) autoFill(true);
    }
  }, [loaded, streamsData, autoFill]);

  useEffect(() => {
    if (!refreshInterval) return;
    const id = setInterval(() => setReloadKey((k) => k + 1), refreshInterval * 1000);
    return () => clearInterval(id);
  }, [refreshInterval]);

  // ---------- полноэкранный режим (Fullscreen API браузера) ----------
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else wallRef.current?.requestFullscreen().catch(() => toast('error', 'Браузер не разрешил полноэкранный режим'));
  }, [toast]);

  const cellFullscreen = (i: number) => {
    const el = cellRefs.current[i];
    if (!el) return;
    if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  };

  // В полноэкранном режиме панель и курсор прячутся, пока мышь неподвижна
  const poke = useCallback(() => {
    setChromeVisible(true);
    clearTimeout(hideTimer.current);
    if (document.fullscreenElement) hideTimer.current = setTimeout(() => setChromeVisible(false), 2500);
  }, []);
  useEffect(() => { poke(); return () => clearTimeout(hideTimer.current); }, [isFs, poke]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || picker !== null || presetsOpen) return;
      if (e.key === 'f' || e.key === 'а') { e.preventDefault(); toggleFullscreen(); }
      const idx = ['1', '2', '3', '4'].indexOf(e.key);
      if (idx >= 0) setLayout(LAYOUTS[idx].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen, picker, presetsOpen]);

  // ---------- действия с ячейками ----------
  const setCell = (i: number, streamId: string | null) =>
    setCells((prev) => prev.map((c, j) => (j === i ? { streamId } : c)));

  const swap = (a: number, b: number) =>
    setCells((prev) => {
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });

  const openPicker = (i: number) => { setSearch(''); setPicker(i); };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    try {
      setConfigs(await api.addWallConfig({ name, layout, cells: cells.slice(0, L.n) }));
      setPresetName('');
      toast('success', `Раскладка «${name}» сохранена`);
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  const loadPreset = (c: WallConfig) => {
    const next = emptyCells();
    c.cells.forEach((x, i) => { if (i < 16) next[i] = { streamId: x.streamId || null }; });
    setLayout(c.layout);
    setCells(next);
    setPresetsOpen(false);
  };

  const deletePreset = async (c: WallConfig) => {
    try {
      setConfigs(await api.deleteWallConfig(c.id));
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  const filtered = streams.filter((s) =>
    !search || `${s.name} ${s.description}`.toLowerCase().includes(search.toLowerCase()));

  // ---------- отрисовка ----------
  if (streamsData && streams.length === 0) {
    return (
      <Empty icon={Video} title="Камеры ещё не добавлены">
        {user?.isAdmin ? (
          <div className="mt-4"><Button variant="primary" icon={Plus} onClick={() => onNavigate('streams')}>Добавить поток</Button></div>
        ) : 'Попросите администратора добавить потоки или выдать вам к ним доступ.'}
      </Empty>
    );
  }

  const toolbar = (
    <div className="flex items-center gap-1 h-11 px-2 border-b border-line bg-ink">
      <div className="flex items-center gap-0.5 pr-2 mr-1 border-r border-line" role="group" aria-label="Раскладка">
        {LAYOUTS.map((l, i) => (
          <LayoutButton key={l.id} cols={l.cols} active={layout === l.id} onClick={() => setLayout(l.id)}
            label={`${l.n} ${camWord(l.n)} (клавиша ${i + 1})`} />
        ))}
      </div>
      <IconButton icon={Wand2} label="Заполнить всеми камерами" onClick={() => {
        const n = autoFill(false);
        toast('info', n ? `Расставлено камер: ${n}` : 'Нет включённых потоков');
      }} />
      <IconButton icon={Crop} label={fit === 'cover' ? 'Вписывать видео целиком' : 'Заполнять ячейки (края обрезаются)'}
        active={fit === 'cover'} onClick={() => setFit(fit === 'cover' ? 'contain' : 'cover')} />
      <IconButton icon={Bookmark} label="Раскладки" onClick={() => setPresetsOpen(true)} />
      <IconButton icon={Trash2} label="Очистить стену" onClick={() => setCells(emptyCells())} />
      <label className="hidden sm:flex items-center gap-1.5 ml-1 text-muted" title="Переподключать все камеры через заданный интервал">
        <RefreshCw className="w-4 h-4" />
        <select value={refreshInterval} onChange={(e) => setRefreshInterval(Number(e.target.value))}
          className="h-8 bg-transparent text-[13px] text-muted hover:text-fg focus:outline-none cursor-pointer">
          {REFRESH.map((r) => <option key={r.v} value={r.v} className="bg-panel">{r.l}</option>)}
        </select>
      </label>
      <div className="ml-auto flex items-center gap-2">
        {isFs && <Clock className="hidden md:inline text-[13px] text-muted whitespace-pre mr-1" />}
        <span data-autofs-skip>
          <IconButton icon={MonitorPlay} active={autoFs} onClick={() => setAutoFs(!autoFs)}
            label={autoFs ? 'Не разворачивать стену автоматически' : 'Разворачивать стену на весь экран при первом щелчке или нажатии клавиши'} />
        </span>
        <Button variant={isFs ? 'subtle' : 'primary'} icon={isFs ? Minimize : Maximize} onClick={toggleFullscreen} className="h-8"
          title="Клавиша F" aria-label={isFs ? 'Выйти из полноэкранного режима' : 'На весь экран'}>
          <span className="hidden sm:inline">{isFs ? 'Выйти из полноэкранного режима' : 'На весь экран'}</span>
        </Button>
      </div>
    </div>
  );

  return (
    <div ref={wallRef} onMouseMove={poke}
      className={`relative h-full flex flex-col bg-black ${isFs && !chromeVisible ? 'cursor-none' : ''}`}>
      {isFs ? (
        <AnimatePresence>
          {chromeVisible && (
            <motion.div className="absolute top-0 inset-x-0 z-20"
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              {toolbar}
            </motion.div>
          )}
        </AnimatePresence>
      ) : toolbar}

      {/* На узком экране (телефон) — одна колонка камер с прокруткой */}
      <div className="flex-1 min-h-0 grid gap-[2px] bg-ink max-sm:!grid-cols-1 max-sm:!grid-rows-none max-sm:auto-rows-[56.25vw] max-sm:overflow-y-auto"
        style={{ gridTemplateColumns: `repeat(${L.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${L.cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: L.n }).map((_, i) => {
          const id = cells[i]?.streamId;
          const s = id ? byId.get(id) : undefined;
          return (
            <motion.div
              key={`${layout}-${i}`}
              ref={(el) => { cellRefs.current[i] = el; }}
              // «Включение монитора»: ячейки по очереди разворачиваются из горизонтальной линии
              initial={{ scaleY: 0.015, opacity: 0.4, filter: 'brightness(2.5)' }}
              animate={{ scaleY: 1, opacity: 1, filter: 'brightness(1)' }}
              transition={{ delay: i * 0.035, duration: 0.42, ease: [0.25, 0.9, 0.3, 1] }}
              className={`group relative bg-black min-w-0 min-h-0 overflow-hidden ${dragFrom !== null && dragFrom !== i ? 'outline outline-1 outline-line-strong -outline-offset-1' : ''}`}
              onDoubleClick={() => { if (s) cellFullscreen(i); }}
            >
              <div
                className="absolute inset-0"
                draggable={!!s}
                onDragStart={(e) => { setDragFrom(i); e.dataTransfer.setData('text/plain', String(i)); }}
                onDragEnd={() => setDragFrom(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (dragFrom !== null && dragFrom !== i) swap(dragFrom, i); setDragFrom(null); }}
              >
                {s ? (
                  <>
                    <VideoPlayer streamId={s.id} name={s.name} reloadKey={reloadKey} disabled={!s.isActive}
                      fit={fit} className="absolute inset-0" />
                    <div className="absolute bottom-0 inset-x-0 px-2.5 py-1.5 flex items-center gap-2 bg-gradient-to-t from-black/75 to-transparent pointer-events-none">
                      <StatusDot status={s.status} />
                      <span className="text-[13px] text-white truncate [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">{s.name}</span>
                    </div>
                    <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      {[
                        ...(user && (user.isAdmin || user.role === 'operator') ? [{
                          icon: History, label: 'Архив этой камеры: последние минуты',
                          fn: () => { window.location.hash = `/archive?stream=${s.id}&t=${new Date(Date.now() - 2 * 60_000).toISOString()}`; },
                        }] : []),
                        { icon: Expand, label: 'Во весь экран (двойной щелчок)', fn: () => cellFullscreen(i) },
                        { icon: Replace, label: 'Заменить камеру', fn: () => openPicker(i) },
                        { icon: X, label: 'Убрать из ячейки', fn: () => setCell(i, null) },
                      ].map((b) => (
                        <button key={b.label} title={b.label} aria-label={b.label}
                          onClick={(e) => { e.stopPropagation(); b.fn(); }}
                          onDoubleClick={(e) => e.stopPropagation()}
                          className="w-7 h-7 flex items-center justify-center rounded bg-black/60 text-white/80 hover:text-white hover:bg-black/80">
                          <b.icon className="w-3.5 h-3.5" />
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <button onClick={() => openPicker(i)}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-line-strong hover:text-muted transition-colors">
                    <Plus className="w-6 h-6" strokeWidth={1.25} />
                    <span className="text-xs">{id ? 'Поток недоступен — выбрать другой' : 'Выбрать камеру'}</span>
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      <Modal open={picker !== null} onClose={() => setPicker(null)} title="Камера для ячейки" wide>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input autoFocus className={`${inputCls} pl-9`} placeholder="Поиск по названию"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <ul className="divide-y divide-line -mx-1">
          {filtered.map((s: Stream) => {
            const used = cells.slice(0, L.n).some((c) => c.streamId === s.id);
            return (
              <li key={s.id}>
                <button onClick={() => { if (picker !== null) setCell(picker, s.id); setPicker(null); }}
                  className="w-full flex items-center gap-3 px-2 py-2.5 rounded text-left hover:bg-raised">
                  <StatusDot status={s.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{s.name}</span>
                    {s.description && <span className="block text-[13px] text-muted truncate">{s.description}</span>}
                  </span>
                  {used && <span className="text-xs text-muted">уже на стене</span>}
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && <li className="py-6 text-center text-muted">Ничего не найдено</li>}
        </ul>
        {picker !== null && cells[picker]?.streamId && (
          <div className="mt-4 pt-4 border-t border-line">
            <Button variant="danger" icon={X} onClick={() => { setCell(picker, null); setPicker(null); }}>Освободить ячейку</Button>
          </div>
        )}
      </Modal>

      <Modal open={presetsOpen} onClose={() => setPresetsOpen(false)} title="Раскладки">
        <form className="flex gap-2 mb-4" onSubmit={(e) => { e.preventDefault(); savePreset(); }}>
          <input className={inputCls} placeholder="Название текущей раскладки" value={presetName}
            onChange={(e) => setPresetName(e.target.value)} />
          <Button type="submit" variant="primary" disabled={!presetName.trim()}>Сохранить</Button>
        </form>
        {configs.length === 0 ? (
          <p className="text-muted text-sm">Сохраните текущую расстановку камер, чтобы потом вернуть её одним щелчком.</p>
        ) : (
          <ul className="divide-y divide-line">
            {configs.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-1.5">
                <button onClick={() => loadPreset(c)} className="flex-1 flex items-center gap-3 px-2 py-1.5 rounded text-left hover:bg-raised">
                  <span className="text-muted"><GridGlyph cols={LAYOUTS.find((l) => l.id === c.layout)?.cols || 2} /></span>
                  {c.name}
                </button>
                <IconButton icon={Trash2} label="Удалить раскладку" onClick={() => deletePreset(c)} />
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
