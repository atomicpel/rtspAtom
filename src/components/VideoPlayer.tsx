import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { AlertCircle, Loader2, Play, VideoOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { onReconnected } from '../lib/connection';
import { startWhep, webrtcLatencyMs, WhepError, type WhepSession } from '../lib/whep';

interface VideoPlayerProps {
  /** Идентификатор потока; видео берётся с сервера панели (WebRTC или /hls/<id>/index.m3u8) */
  streamId: string;
  name: string;
  className?: string;
  /** Меняется — плеер переподключается (используется авто-обновлением видеостены). */
  reloadKey?: number;
  /** Поток отключён в настройках — не подключаемся. */
  disabled?: boolean;
  /** Заполнять ячейку (обрезая края) или вписывать целиком. */
  fit?: 'contain' | 'cover';
  /** Сообщает наружу, идёт ли видео и каким способом. */
  onStatus?: (playing: boolean, transport: Transport) => void;
}

type Status = 'loading' | 'playing' | 'paused' | 'error';
export type Transport = 'webrtc' | 'hls';

const RETRY_MS = 4000;

// Если WebRTC не проходит (закрыт порт видео), не тратим время на попытки в каждой ячейке:
// следующие минуты сразу используем HLS.
let webrtcBrokenUntil = 0;

function preferredTransport(lowLatency: boolean): Transport {
  try {
    const forced = localStorage.getItem('rtspatom_transport');
    if (forced === 'hls' || forced === 'webrtc') return forced;
  } catch { /* хранилище недоступно */ }
  if (!lowLatency || typeof RTCPeerConnection === 'undefined') return 'hls';
  return Date.now() < webrtcBrokenUntil ? 'hls' : 'webrtc';
}

export function VideoPlayer({ streamId, name, className = '', reloadKey = 0, disabled = false, fit = 'contain', onStatus }: VideoPlayerProps) {
  const { lowLatency } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [transport, setTransport] = useState<Transport>(() => preferredTransport(lowLatency));

  useEffect(() => { onStatus?.(status === 'playing' && !disabled, transport); }, [status, disabled, transport]);

  // Связь с сервером восстановилась — переподключаемся сразу, не дожидаясь очередной попытки
  // (камеры, которые и так показывают, не трогаем: MediaMTX работает отдельно от панели)
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => onReconnected(() => { if (statusRef.current !== 'playing') setAttempt((a) => a + 1); }), []);

  // Новая попытка подключения — снова с предпочтительным способом
  useEffect(() => { setTransport(preferredTransport(lowLatency)); }, [streamId, reloadKey, attempt, lowLatency]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || disabled) return;

    let hls: Hls | null = null;
    let whep: WhepSession | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let statsTimer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    setStatus('loading');
    setErrorMsg('');
    video.dataset.transport = transport;

    const fail = (msg: string) => {
      if (cancelled) return;
      setStatus('error');
      setErrorMsg(msg);
      hls?.destroy();
      hls = null;
      whep?.close();
      whep = null;
      retryTimer = setTimeout(() => setAttempt((a) => a + 1), RETRY_MS);
    };

    const play = () => {
      const p = video.play();
      if (p && typeof p.then === 'function') {
        p.then(() => !cancelled && setStatus('playing')).catch(() => !cancelled && setStatus('paused'));
      } else {
        setStatus('playing');
      }
    };

    const httpError = (code: number | undefined) =>
      code === 401 ? 'Сессия истекла — войдите снова'
        : code === 403 ? 'Нет доступа к потоку'
          : code === 503 ? 'Достигнут лимит подключений'
            : code === 409 ? 'Поток отключён'
              : 'Нет сигнала от камеры';

    if (transport === 'webrtc') {
      startWhep(video, streamId, () => fail('Связь с камерой прервалась'))
        .then((s) => {
          if (cancelled) { s.close(); return; }
          whep = s;
          play();
          // Оценка задержки для проверки (атрибут data-latency у элемента video)
          statsTimer = setInterval(async () => {
            const ms = await webrtcLatencyMs(s.pc);
            if (ms !== null) video.dataset.latency = String(ms);
          }, 1000);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const code = err instanceof WhepError ? err.status : 0;
          if (code === -1) { fail('Нет связи с сервером'); return; }
          if ([401, 403, 409, 503].includes(code)) { fail(httpError(code)); return; }
          // Камера без поддерживаемого кодека, закрытый порт и т. п. — показываем через HLS
          if (code === 0) webrtcBrokenUntil = Date.now() + 5 * 60_000;
          setTransport('hls');
        });
    } else if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        liveDurationInfinity: true,
        backBufferLength: 4,
        maxLiveSyncPlaybackRate: 1.5, // догоняем «живой край», если отстали
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 4,
      });
      hls.on(Hls.Events.MANIFEST_PARSED, play);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && hls) {
          hls.recoverMediaError();
          return;
        }
        fail(httpError(data.response?.code));
      });
      hls.loadSource(`/hls/${encodeURIComponent(streamId)}/index.m3u8`);
      hls.attachMedia(video);
      statsTimer = setInterval(() => {
        const at = hls?.playingDate?.getTime();
        if (at) video.dataset.latency = String(Date.now() - at);
      }, 1000);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = `/hls/${encodeURIComponent(streamId)}/index.m3u8`;
      video.onloadedmetadata = play;
      video.onerror = () => fail('Нет сигнала от камеры');
    } else {
      setStatus('error');
      setErrorMsg('Браузер не поддерживает потоковое видео');
    }

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      clearInterval(statsTimer);
      hls?.destroy();
      whep?.close();
      video.srcObject = null;
      video.removeAttribute('src');
      video.onloadedmetadata = null;
      video.onerror = null;
      delete video.dataset.latency;
    };
  }, [streamId, reloadKey, attempt, disabled, transport]);

  const handlePlayClick = (e: React.MouseEvent) => {
    const video = videoRef.current;
    if (!video || status !== 'paused') return;
    e.stopPropagation();
    video.play().then(() => setStatus('playing')).catch(() => {});
  };

  return (
    <div className={`relative bg-black overflow-hidden ${className}`}>
      <video
        ref={videoRef}
        data-stream-name={name}
        className={`w-full h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'} transition-opacity duration-500 ${status === 'playing' ? 'opacity-100' : 'opacity-0'}`}
        muted
        playsInline
        autoPlay
      />

      {!disabled && status === 'playing' && (
        <span className="absolute bottom-1.5 right-2 z-10 px-1.5 py-0.5 rounded bg-black/60 text-[11px] text-white/80 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          title={transport === 'webrtc' ? 'WebRTC: минимальная задержка' : 'HLS: задержка 1–3 секунды'}>
          {transport === 'webrtc' ? 'WebRTC' : 'HLS'}
        </span>
      )}

      {disabled && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted">
          <VideoOff className="w-6 h-6 mb-2" strokeWidth={1.5} />
          <p className="text-xs">Поток отключён</p>
        </div>
      )}

      {!disabled && status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-muted animate-spin" />
        </div>
      )}

      {!disabled && status === 'paused' && (
        <button onClick={handlePlayClick} className="absolute inset-0 flex items-center justify-center" title="Воспроизвести">
          <span className="w-11 h-11 rounded-full bg-black/60 border border-line-strong flex items-center justify-center">
            <Play className="w-5 h-5 text-fg ml-0.5" />
          </span>
        </button>
      )}

      {!disabled && status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          <AlertCircle className="w-6 h-6 text-warn mb-2" strokeWidth={1.5} />
          <p className="text-xs text-fg">{errorMsg}</p>
          <p className="text-[11px] text-muted mt-0.5">повторное подключение</p>
        </div>
      )}
    </div>
  );
}
