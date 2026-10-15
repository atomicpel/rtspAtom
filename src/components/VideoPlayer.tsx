import React, { useRef, useEffect, useState } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { StreamProtocol } from '../lib/types';
import { AlertCircle, Play, Loader2 } from 'lucide-react';

interface VideoPlayerProps {
  url: string;
  protocol: StreamProtocol;
  name: string;
  className?: string;
}

// Проверенные рабочие HLS потоки (CORS открыт)
const WORKING_HLS_STREAMS = [
  'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_fmp4_case/master.m3u8',
  'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8',
];

// Fallback MP4 видео (ТОЧНО работает)
const FALLBACK_MP4 = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

export function VideoPlayer({ url, protocol, name, className = '' }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'playing' | 'error' | 'fallback'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  // Очистка при размонтировании
  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (mpegtsRef.current) {
        mpegtsRef.current.destroy();
        mpegtsRef.current = null;
      }
    };
  }, []);

  // Загрузка видео
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    setStatus('loading');
    setErrorMsg('');

    // Очистка предыдущего
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (mpegtsRef.current) {
      mpegtsRef.current.destroy();
      mpegtsRef.current = null;
    }
    video.src = '';

    const tryFallback = () => {
      console.log('[VideoPlayer] Переключаемся на fallback видео');
      setStatus('fallback');
      video.src = FALLBACK_MP4;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    };

    // HLS/m3u8
    if (protocol === 'hls' || protocol === 'm3u8' || url.includes('.m3u8')) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
        });
        hlsRef.current = hls;

        hls.loadSource(url);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log('[VideoPlayer] HLS загружен:', url);
          setStatus('playing');
          const playPromise = video.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
              // Если autoplay заблокирован, ждём клика
              setStatus('playing');
            });
          }
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          console.error('[VideoPlayer] HLS ошибка:', data);
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              // Пробуем восстановить
              hls.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              tryFallback();
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari
        video.src = url;
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
        setStatus('playing');
      } else {
        tryFallback();
      }
    }
    // FLV / MPEG-TS
    else if (protocol === 'flv' || protocol === 'ts' || url.includes('.flv')) {
      if (mpegts.isSupported()) {
        const player = mpegts.createPlayer({
          type: protocol === 'flv' ? 'flv' : 'mpegts',
          url: url,
          isLive: true,
        });
        mpegtsRef.current = player;
        player.attachMediaElement(video);
        player.load();
        const playPromise = player.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
        setStatus('playing');

        player.on(mpegts.Events.ERROR, () => {
          tryFallback();
        });
      } else {
        tryFallback();
      }
    }
    // MP4 / WebM
    else if (protocol === 'http' || protocol === 'https') {
      video.src = url;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
      setStatus('playing');
      
      video.onerror = () => {
        tryFallback();
      };
    }
    // RTSP / RTMP / другие
    else {
      setErrorMsg(`${protocol.toUpperCase()} требует конвертер (MediaMTX)`);
      setStatus('error');
    }
  }, [url, protocol]);

  const handlePlayClick = () => {
    const video = videoRef.current;
    if (video) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.then(() => {
          setStatus('playing');
        }).catch(() => {});
      } else {
        setStatus('playing');
      }
    }
  };

  // Ошибка - показываем инструкцию
  if (status === 'error') {
    return (
      <div className={`relative bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg overflow-hidden flex items-center justify-center ${className}`}>
        <div className="text-center p-4">
          <AlertCircle className="w-10 h-10 mx-auto text-yellow-500 mb-2" />
          <p className="text-xs text-white font-medium mb-2">{name}</p>
          <p className="text-[10px] text-yellow-400 mb-2">{errorMsg}</p>
          <div className="text-[9px] text-gray-400 space-y-0.5">
            <p>Решение:</p>
            <p>1. Установите MediaMTX</p>
            <p>2. Добавьте поток в конфиг</p>
            <p>3. Используйте HLS URL</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative bg-black rounded-lg overflow-hidden ${className}`}>
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        muted
        playsInline
        onClick={handlePlayClick}
      />
      
      {/* Загрузка */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
        </div>
      )}

      {/* Кнопка Play если autoplay заблокирован */}
      {status === 'playing' && (
        <button
          onClick={handlePlayClick}
          className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity"
        >
          <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Play className="w-6 h-6 text-white ml-0.5" />
          </div>
        </button>
      )}

      {/* Индикатор LIVE */}
      {status === 'playing' && (
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 px-2 py-0.5 rounded">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] text-white font-medium">LIVE</span>
        </div>
      )}

      {/* Индикатор Fallback */}
      {status === 'fallback' && (
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 px-2 py-0.5 rounded">
          <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
          <span className="text-[10px] text-white font-medium">ДЕМО</span>
        </div>
      )}

      {/* Протокол */}
      <div className="absolute top-2 right-2 bg-black/60 px-2 py-0.5 rounded">
        <span className="text-[10px] text-purple-400 uppercase font-medium">
          {status === 'fallback' ? 'ДЕМО' : protocol}
        </span>
      </div>
    </div>
  );
}

// Автоопределение протокола по URL
export function detectProtocolFromUrl(url: string): StreamProtocol {
  if (!url) return 'hls';
  const lower = url.toLowerCase();
  
  if (lower.includes('.m3u8')) return 'hls';
  if (lower.startsWith('rtsp://')) return 'rtsp';
  if (lower.startsWith('rtmp://')) return 'rtmp';
  if (lower.includes('.flv')) return 'flv';
  if (lower.includes('.ts') && !lower.includes('.m3u8')) return 'ts';
  if (lower.startsWith('webrtc://')) return 'webrtc';
  if (lower.includes('.mp4') || lower.includes('.webm')) return 'http';
  
  return 'hls';
}
