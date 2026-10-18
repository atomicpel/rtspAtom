import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, VideoOff } from 'lucide-react';
import { type Span, fmtDate, fmtTime, nextSpanStart, spanAt } from '../../lib/archiveTime';

/** Один запрос к архиву — не длиннее 30 минут; дальше плеер сам берёт следующий кусок. */
const CHUNK_SEC = 30 * 60;

interface Props {
  streamId: string;
  name: string;
  spans: Span[] | undefined;
  /** Общее время просмотра (мс) — по нему плеер держит синхронность */
  clockT: number;
  /** Увеличивается при переходе к другому моменту */
  seekNonce: number;
  playing: boolean;
  rate: number;
  focused: boolean;
  onFocus: () => void;
  /** Плеер сообщает свою позицию; null — записи в это время нет */
  onReport: (id: string, t: number | null, playing: boolean) => void;
  registerVideo: (id: string, el: HTMLVideoElement | null) => void;
}

type State = 'idle' | 'loading' | 'playing' | 'gap' | 'error';

export function ArchivePlayer({
  streamId, name, spans, clockT, seekNonce, playing, rate, focused, onFocus, onReport, registerVideo,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const srcStart = useRef<number | null>(null);
  const chunkEnd = useRef(0);
  const lastLoad = useRef(0);
  const [state, setState] = useState<State>('idle');
  const [pos, setPos] = useState<number | null>(null);
  const live = useRef({ playing, rate, spans });
  live.current = { playing, rate, spans };

  const position = useCallback(() => {
    const v = videoRef.current;
    return v && srcStart.current !== null ? srcStart.current + v.currentTime * 1000 : null;
  }, []);

  const unload = useCallback(() => {
    const v = videoRef.current;
    srcStart.current = null;
    if (v) {
      v.removeAttribute('src');
      v.load();
    }
  }, []);

  const load = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    lastLoad.current = Date.now();
    const sp = spanAt(live.current.spans, t);
    if (!sp) {
      unload();
      setState('gap');
      setPos(null);
      onReport(streamId, null, false);
      return;
    }
    const start = Math.max(t, sp.s);
    const dur = Math.max(2, Math.min(CHUNK_SEC, Math.ceil((sp.e - start) / 1000)));
    srcStart.current = start;
    chunkEnd.current = start + dur * 1000;
    setState('loading');
    v.src = `/archive/${encodeURIComponent(streamId)}/video?start=${encodeURIComponent(new Date(start).toISOString())}&duration=${dur}`;
    v.playbackRate = live.current.rate;
    if (live.current.playing) v.play().catch(() => {});
  }, [streamId, onReport, unload]);

  // Переход к моменту (щелчок по шкале, закладка, перемотка)
  useEffect(() => { load(clockT); }, [seekNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Подстройка к общему времени: пустота закончилась, вышли за пределы куска, сильно разошлись
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (state === 'gap' || state === 'idle') {
      if (spanAt(spans, clockT)) load(clockT);
      return;
    }
    if (state === 'error') {
      if (Date.now() - lastLoad.current > 5000) load(clockT);
      return;
    }
    const p = position();
    if (p === null) return;
    const tolerance = Math.max(2500, rate * 1500);
    const outside = clockT < (srcStart.current ?? 0) - 1000 || clockT > chunkEnd.current + 1000;
    if ((outside || Math.abs(p - clockT) > tolerance) && Date.now() - lastLoad.current > 3000) load(clockT);
  }, [clockT, spans]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = videoRef.current;
    if (!v || srcStart.current === null) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    registerVideo(streamId, videoRef.current);
    return () => registerVideo(streamId, null);
  }, [streamId, registerVideo]);

  const onTime = () => {
    const v = videoRef.current;
    const p = position();
    if (!v || p === null) return;
    setPos(p);
    onReport(streamId, p, !v.paused && v.readyState >= 3);
  };

  const onEnded = () => {
    const p = position();
    if (p !== null && p >= chunkEnd.current - 1500 && spanAt(live.current.spans, p + 600)) {
      load(p + 100); // следующий кусок того же промежутка
    } else {
      setState('gap');
      onReport(streamId, null, false);
    }
  };

  const next = state === 'gap' ? nextSpanStart(spans, clockT) : null;

  return (
    <div onClick={onFocus}
      className={`group relative bg-black min-w-0 min-h-0 overflow-hidden cursor-pointer ${focused ? 'outline outline-2 outline-steel -outline-offset-2 z-10' : ''}`}>
      <video
        ref={videoRef}
        data-archive-stream={name}
        className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${state === 'playing' || state === 'loading' ? 'opacity-100' : 'opacity-0'}`}
        muted
        playsInline
        preload="auto"
        onTimeUpdate={onTime}
        onPlaying={() => setState('playing')}
        onWaiting={() => setState((s) => (s === 'playing' ? 'loading' : s))}
        onEnded={onEnded}
        onError={() => { if (srcStart.current !== null) setState('error'); }}
      />
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-5 h-5 text-muted animate-spin" />
        </div>
      )}
      {(state === 'gap' || state === 'error' || state === 'idle') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-3 text-muted pointer-events-none">
          <VideoOff className="w-6 h-6 mb-2" strokeWidth={1.5} />
          <p className="text-xs">{state === 'error' ? 'Не удалось загрузить запись' : 'Нет записи в это время'}</p>
          {next !== null && <p className="text-[11px] mt-0.5">следующая: {fmtDate(next) !== fmtDate(clockT) ? `${fmtDate(next)} ` : ''}{fmtTime(next)}</p>}
        </div>
      )}
      <div className="absolute bottom-0 inset-x-0 px-2.5 py-1.5 flex items-center gap-2 bg-gradient-to-t from-black/75 to-transparent pointer-events-none">
        <span className="text-[13px] text-white truncate [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">{name}</span>
        {pos !== null && state !== 'gap' && (
          <span className="ml-auto text-[12px] text-white/80 tabular [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">{fmtTime(pos)}</span>
        )}
      </div>
    </div>
  );
}
