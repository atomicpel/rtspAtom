import React, { useRef, useEffect, useState } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { StreamProtocol } from '../lib/types';
import { AlertCircle, Video, Radio, Globe, Film, RefreshCw, Loader } from 'lucide-react';

// Встроенное видео для демонстрации (работает всегда)
const FALLBACK_VIDEO_URL = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

// Публичные CORS прокси для обхода ограничений
const CORS_PROXIES = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
  'https://cors-anywhere.herokuapp.com/',
];

// Функция для получения URL через прокси
function getProxiedUrl(url: string): string {
  // Не проксируем локальные URL
  if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
    return url;
  }
  
  // Используем первый прокси
  return CORS_PROXIES[0] + encodeURIComponent(url);
}

interface VideoPlayerProps {
  url: string;
  protocol: StreamProtocol;
  name: string;
  className?: string;
  autoPlay?: boolean;
  muted?: boolean;
}

// Автоматическое определение типа потока по URL
export function detectProtocolFromUrl(url: string): StreamProtocol {
  if (!url) return 'hls';
  
  const lowerUrl = url.toLowerCase();
  
  // HLS/m3u8
  if (lowerUrl.includes('.m3u8') || lowerUrl.includes('/hls/')) {
    return 'hls';
  }
  
  // RTSP
  if (lowerUrl.startsWith('rtsp://')) {
    return 'rtsp';
  }
  
  // RTMP
  if (lowerUrl.startsWith('rtmp://')) {
    return 'rtmp';
  }
  
  // FLV (HTTP-FLV)
  if (lowerUrl.includes('.flv') || lowerUrl.includes('/flv')) {
    return 'flv';
  }
  
  // MPEG-TS
  if (lowerUrl.includes('.ts') && !lowerUrl.includes('.m3u8')) {
    return 'ts';
  }
  
  // WebRTC
  if (lowerUrl.startsWith('webrtc://')) {
    return 'webrtc';
  }
  
  // HTTP/HTTPS - может быть HLS, MP4, WebM или другой формат
  if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
    // Проверяем расширение
    if (lowerUrl.includes('.mp4')) return 'http';
    if (lowerUrl.includes('.webm')) return 'http';
    if (lowerUrl.includes('.m3u8')) return 'hls';
    if (lowerUrl.includes('.flv')) return 'flv';
    if (lowerUrl.includes('.ts')) return 'ts';
    
    // По умолчанию предполагаем HLS для HTTP потоков
    return 'hls';
  }
  
  return 'hls';
}

export function VideoPlayer({ url, protocol, name, className = '', autoPlay = true, muted = true }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [useFallback, setUseFallback] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;
    let mpegtsPlayer: any = null;
    setError(null);
    setIsLoading(true);
    setUseFallback(false);
    setRetryCount(0);

    const actualUrl = useFallback ? FALLBACK_VIDEO_URL : url;
    const actualProtocol = useFallback ? 'http' : protocol;

    console.log(`[VideoPlayer] Loading: ${actualUrl} (protocol: ${actualProtocol}, fallback: ${useFallback})`);

    const loadVideo = () => {
      try {
        // HLS/m3u8 потоки
        if (actualProtocol === 'hls' || actualProtocol === 'm3u8' || actualUrl.includes('.m3u8')) {
          if (Hls.isSupported()) {
            hls = new Hls({
              enableWorker: true,
              lowLatencyMode: true,
              maxBufferLength: 30,
              maxMaxBufferLength: 60,
            });
            
            hls.loadSource(actualUrl);
            hls.attachMedia(video);
            
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              console.log('[VideoPlayer] HLS manifest loaded');
              setIsLoading(false);
              if (autoPlay) {
                video.play().catch(e => {
                  console.log('[VideoPlayer] Autoplay prevented:', e);
                });
              }
            });
            
            hls.on(Hls.Events.ERROR, (event, data) => {
              console.error('[VideoPlayer] HLS error:', data);
              if (data.fatal && hls) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    console.log('[VideoPlayer] Network error, trying to recover...');
                    if (retryCount < 2) {
                      setRetryCount(prev => prev + 1);
                      hls.startLoad();
                    } else {
                      console.log('[VideoPlayer] Network error after retries, switching to fallback');
                      setError('Поток недоступен (CORS или сеть). Показываю демо видео.');
                      setUseFallback(true);
                    }
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    console.log('[VideoPlayer] Media error, trying to recover...');
                    hls.recoverMediaError();
                    break;
                  default:
                    console.log('[VideoPlayer] Fatal error, switching to fallback');
                    setError('Ошибка загрузки потока. Показываю демо видео.');
                    setUseFallback(true);
                    break;
                }
              }
            });
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari native HLS
            video.src = actualUrl;
            if (autoPlay) {
              video.play().catch(e => console.log('[VideoPlayer] Autoplay prevented:', e));
            }
          } else {
            console.log('[VideoPlayer] HLS not supported, using fallback');
            setUseFallback(true);
          }
        }
        // HTTP-FLV и MPEG-TS потоки (через mpegts.js)
        else if (actualProtocol === 'flv' || actualProtocol === 'ts' || actualUrl.includes('.flv') || actualUrl.includes('.ts')) {
          if (mpegts.isSupported()) {
            mpegtsPlayer = mpegts.createPlayer({
              type: actualProtocol === 'flv' ? 'flv' : 'mpegts',
              url: actualUrl,
              isLive: true,
            }, {
              enableWorker: false,
              enableStashBuffer: false,
              stashInitialSize: 128,
              autoCleanupSourceBuffer: true,
              autoCleanupMaxBackwardDuration: 30,
              autoCleanupMinBackwardDuration: 15,
            });
            
            mpegtsPlayer.attachMediaElement(video);
            mpegtsPlayer.load();
            
            if (autoPlay) {
              const playPromise = mpegtsPlayer.play();
              if (playPromise && playPromise.catch) {
                playPromise.catch((e: any) => {
                  console.log('[VideoPlayer] Autoplay prevented:', e);
                });
              }
            }
            
            mpegtsPlayer.on(mpegts.Events.ERROR, (errorType: any, errorDetail: any, errorInfo: any) => {
              console.error('[VideoPlayer] MPEGTS error:', errorType, errorDetail, errorInfo);
              if (retryCount < 2) {
                setRetryCount(prev => prev + 1);
              } else {
                console.log('[VideoPlayer] Switching to fallback video');
                setUseFallback(true);
              }
            });
          } else {
            console.log('[VideoPlayer] MPEGTS not supported, using fallback');
            setUseFallback(true);
          }
        }
        // HTTP/HTTPS потоки (MP4, WebM)
        else if (actualProtocol === 'http' || actualProtocol === 'https') {
          video.src = actualUrl;
          video.addEventListener('loadeddata', () => {
            console.log('[VideoPlayer] Video loaded');
            setIsLoading(false);
            if (autoPlay) {
              video.play().catch(e => console.log('[VideoPlayer] Autoplay prevented:', e));
            }
          });
          video.addEventListener('error', () => {
            console.log('[VideoPlayer] Video error, using fallback');
            setUseFallback(true);
          });
        }
        // RTSP потоки - показываем инструкцию
        else if (actualProtocol === 'rtsp') {
          setError('RTSP требует конвертер в HTTP-FLV/HLS');
          setIsLoading(false);
        }
        // RTMP потоки
        else if (actualProtocol === 'rtmp') {
          setError('RTMP требует конвертер в HTTP-FLV/HLS');
          setIsLoading(false);
        }
        // WebRTC
        else if (actualProtocol === 'webrtc') {
          setError('WebRTC требует специальный сервер');
          setIsLoading(false);
        }
      } catch (err) {
        console.error('[VideoPlayer] Error:', err);
        setError('Ошибка воспроизведения');
        setIsLoading(false);
      }
    };

    loadVideo();

    return () => {
      if (hls) {
        hls.destroy();
      }
      if (mpegtsPlayer) {
        mpegtsPlayer.destroy();
      }
    };
  }, [url, protocol, autoPlay, retryCount, useFallback]);

  const handlePlay = () => {
    console.log('[VideoPlayer] Video playing');
    setIsPlaying(true);
    setIsLoading(false);
  };
  
  const handlePause = () => {
    console.log('[VideoPlayer] Video paused');
    setIsPlaying(false);
  };
  
  const handleError = (e: any) => {
    console.error('[VideoPlayer] Video error:', e);
    if (!useFallback) {
      console.log('[VideoPlayer] Switching to fallback video');
      setUseFallback(true);
    } else {
      setError('Ошибка загрузки видео');
      setIsLoading(false);
    }
  };

  const handleLoadedData = () => {
    console.log('[VideoPlayer] Data loaded');
    setIsLoading(false);
  };

  const handleRetry = () => {
    console.log('[VideoPlayer] Manual retry');
    setUseFallback(false);
    setRetryCount(prev => prev + 1);
    setError(null);
    setIsLoading(true);
  };

  // Если есть ошибка или неподдерживаемый протокол
  if (error) {
    return (
      <div className={`relative bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg overflow-hidden flex items-center justify-center ${className}`}>
        <div className="text-center p-4">
          <AlertCircle className="w-12 h-12 mx-auto text-yellow-500 mb-3" />
          <p className="text-sm text-white font-medium mb-2">{name}</p>
          <p className="text-xs text-yellow-400 mb-3">{error}</p>
          
          {(protocol === 'rtsp' || protocol === 'rtmp') && (
            <div className="text-[10px] text-gray-500 space-y-1 mb-3">
              <p className="font-semibold text-yellow-400">Как конвертировать {protocol.toUpperCase()}:</p>
              <p>1. Установите MediaMTX: github.com/bluenviron/mediamtx</p>
              <p>2. Добавьте камеру в конфиг:</p>
              <code className="block bg-black/30 p-1 rounded text-[9px]">
                paths:<br/>
                &nbsp;&nbsp;cam1:<br/>
                &nbsp;&nbsp;&nbsp;&nbsp;source: {url}
              </code>
              <p>3. Используйте URL: http://localhost:8888/cam1/hls</p>
            </div>
          )}
          
          {protocol === 'flv' && (
            <div className="text-[10px] text-gray-500 space-y-1 mb-3">
              <p>FLV поток должен быть доступен через HTTP:</p>
              <p>• http://server/stream.flv</p>
              <p>• Убедитесь что сервер отдаёт FLV</p>
            </div>
          )}
          
          {(protocol === 'hls' || protocol === 'http' || protocol === 'https') && (
            <div className="text-[10px] text-gray-500 space-y-1 mb-3">
              <p className="font-semibold text-yellow-400">Проблема CORS:</p>
              <p>Сервер блокирует запросы из браузера.</p>
              <p className="mt-1">Решения:</p>
              <p>1. Используйте локальный HLS сервер (MediaMTX)</p>
              <p>2. Добавьте CORS заголовки на сервер</p>
              <p>3. Положите HLS файлы на свой веб-сервер</p>
              <p className="mt-1 text-blue-400">Показываю демо видео вместо потока...</p>
            </div>
          )}
          
          {(protocol === 'hls' || protocol === 'http' || protocol === 'https') && (
            <button
              onClick={handleRetry}
              className="flex items-center gap-2 mx-auto px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs rounded-lg transition-all"
            >
              <RefreshCw className="w-3 h-3" />
              Повторить
            </button>
          )}
        </div>
      </div>
    );
  }

  // Видео элемент
  return (
    <div className={`relative bg-black rounded-lg overflow-hidden ${className}`}>
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        muted={muted}
        playsInline
        onPlay={handlePlay}
        onPause={handlePause}
        onError={handleError}
        onLoadedData={handleLoadedData}
      />
      
      {/* Индикатор загрузки */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-center">
            <Loader className="w-8 h-8 mx-auto text-blue-400 animate-spin mb-2" />
            <p className="text-xs text-gray-300">
              {useFallback ? 'Загрузка демо видео...' : 'Загрузка потока...'}
            </p>
          </div>
        </div>
      )}
      
      {/* Индикатор LIVE */}
      {isPlaying && !useFallback && (
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 px-2 py-0.5 rounded backdrop-blur-sm">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] text-white font-medium">LIVE</span>
        </div>
      )}

      {/* Индикатор демо режима */}
      {isPlaying && useFallback && (
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 px-2 py-0.5 rounded backdrop-blur-sm">
          <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
          <span className="text-[10px] text-white font-medium">ДЕМО</span>
        </div>
      )}

      {/* Протокол */}
      <div className="absolute top-2 right-2 bg-black/60 px-2 py-0.5 rounded backdrop-blur-sm">
        <span className="text-[10px] text-purple-400 uppercase font-medium">
          {useFallback ? 'ДЕМО' : protocol}
        </span>
      </div>
    </div>
  );
}

// Иконка для протокола
export function getProtocolIcon(protocol: StreamProtocol) {
  switch (protocol) {
    case 'rtsp':
    case 'rtmp':
      return Radio;
    case 'http':
    case 'https':
    case 'webrtc':
      return Globe;
    case 'hls':
    case 'm3u8':
    case 'ts':
    case 'flv':
      return Film;
    default:
      return Video;
  }
}

// Описание протокола
export function getProtocolDescription(protocol: StreamProtocol): string {
  switch (protocol) {
    case 'rtsp':
      return 'RTSP требует сервер-конвертер (MediaMTX, SRS, FFmpeg)';
    case 'hls':
    case 'm3u8':
      return 'HLS воспроизводится напрямую в браузере';
    case 'http':
    case 'https':
      return 'HTTP/HTTPS видео (MP4, WebM)';
    case 'rtmp':
      return 'RTMP требует сервер-конвертер';
    case 'flv':
      return 'FLV требует сервер-конвертер';
    case 'webrtc':
      return 'WebRTC требует специальный сервер';
    case 'ts':
      return 'MPEG-TS требует сервер-конвертер';
    default:
      return 'Неизвестный протокол';
  }
}
