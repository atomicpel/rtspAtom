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
}

type Status = 'loading' | 'playing' | 'paused' | 'error';

const RETRY_MS = 5000;

export function VideoPlayer({ streamId, name, className = '', reloadKey = 0, disabled = false }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [attempt, setAttempt] = useState(0);

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
    <div className={`relative bg-black rounded-lg overflow-hidden ${className}`}>
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        muted
        playsInline
        autoPlay
      />

      {disabled && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/90 text-gray-500">
          <VideoOff className="w-8 h-8 mb-2" />
          <p className="text-xs">Поток отключён</p>
        </div>
      )}

      {!disabled && status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
        </div>
      )}

      {!disabled && status === 'paused' && (
        <button
          onClick={handlePlayClick}
          className="absolute inset-0 flex items-center justify-center bg-black/40"
          title="Воспроизвести"
        >
          <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Play className="w-6 h-6 text-white ml-0.5" />
          </div>
        </button>
      )}

      {!disabled && status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800">
          <div className="text-center p-4">
            <AlertCircle className="w-9 h-9 mx-auto text-yellow-500 mb-2" />
            <p className="text-xs text-white font-medium mb-1">{name}</p>
            <p className="text-[11px] text-yellow-400">{errorMsg}</p>
            <p className="text-[10px] text-gray-500 mt-1">Повторное подключение…</p>
          </div>
        </div>
      )}

      {!disabled && status === 'playing' && (
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 px-2 py-0.5 rounded pointer-events-none">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] text-white font-medium">LIVE</span>
        </div>
      )}
    </div>
  );
}
