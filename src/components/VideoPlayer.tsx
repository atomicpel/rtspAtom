import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { AlertCircle, Loader2, Play, VideoOff } from 'lucide-react';

interface VideoPlayerProps {
  /** Идентификатор потока; видео берётся с сервера панели: /hls/<id>/index.m3u8 */
  streamId: string;
  name: string;
  className?: string;
  /** Меняется — плеер переподключается (используется авто-обновлением видеостены). */
  reloadKey?: number;
  /** Поток отключён в настройках — не подключаемся. */
  disabled?: boolean;
  /** Заполнять ячейку (обрезая края) или вписывать целиком. */
  fit?: 'contain' | 'cover';
  /** Сообщает наружу, идёт ли видео. */
  onStatus?: (playing: boolean) => void;
}

type Status = 'loading' | 'playing' | 'paused' | 'error';

const RETRY_MS = 5000;

export function VideoPlayer({ streamId, name, className = '', reloadKey = 0, disabled = false, fit = 'contain', onStatus }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { onStatus?.(status === 'playing' && !disabled); }, [status, disabled]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || disabled) return;

    let hls: Hls | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const src = `/hls/${encodeURIComponent(streamId)}/index.m3u8`;

    setStatus('loading');
    setErrorMsg('');

    const fail = (msg: string) => {
      if (cancelled) return;
      setStatus('error');
      setErrorMsg(msg);
      hls?.destroy();
      hls = null;
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

    if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        liveDurationInfinity: true,
        backBufferLength: 10,
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 4,
      });
      hls.on(Hls.Events.MANIFEST_PARSED, play);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        const code = data.response?.code;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && hls) {
          hls.recoverMediaError();
          return;
        }
        if (code === 401) fail('Сессия истекла — войдите снова');
        else if (code === 403) fail('Нет доступа к потоку');
        else if (code === 503) fail('Достигнут лимит подключений');
        else if (code === 409) fail('Поток отключён');
        else fail('Нет сигнала от камеры');
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.onloadedmetadata = play;
      video.onerror = () => fail('Нет сигнала от камеры');
    } else {
      setStatus('error');
      setErrorMsg('Браузер не поддерживает HLS');
    }

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      hls?.destroy();
      video.removeAttribute('src');
      video.onloadedmetadata = null;
      video.onerror = null;
    };
  }, [streamId, reloadKey, attempt, disabled]);

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
        className={`w-full h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'} transition-opacity duration-500 ${status === 'playing' ? 'opacity-100' : 'opacity-0'}`}
        muted
        playsInline
        autoPlay
      />

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
