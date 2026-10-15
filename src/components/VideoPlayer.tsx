import React, { useRef, useEffect, useState } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { StreamProtocol } from '../lib/types';
import { AlertCircle, Video, Radio, Globe, Film, RefreshCw } from 'lucide-react';

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
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    let hls: Hls | null = null;
    let mpegtsPlayer: any = null;
    setError(null);
    setRetryCount(0);

    const loadVideo = () => {
      try {
        // HLS/m3u8 потоки
        if (protocol === 'hls' || protocol === 'm3u8' || url.includes('.m3u8')) {
          if (Hls.isSupported()) {
            hls = new Hls({
              enableWorker: true,
              lowLatencyMode: true,
              maxBufferLength: 30,
              maxMaxBufferLength: 60,
            });
            
            hls.loadSource(url);
            hls.attachMedia(video);
            
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              console.log('HLS manifest loaded for:', url);
              if (autoPlay) {
                video.play().catch(e => {
                  console.log('Autoplay prevented:', e);
                });
              }
            });
            
            hls.on(Hls.Events.ERROR, (event, data) => {
              console.error('HLS error:', data);
              if (data.fatal && hls) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    console.log('Network error, trying to recover...');
                    hls.startLoad();
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    console.log('Media error, trying to recover...');
                    hls.recoverMediaError();
                    break;
                  default:
                    setError('Ошибка загрузки потока');
                    break;
                }
              }
            });
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari native HLS
            video.src = url;
            if (autoPlay) {
              video.play().catch(e => console.log('Autoplay prevented:', e));
            }
          } else {
            setError('HLS не поддерживается в этом браузере');
          }
        }
        // HTTP-FLV и MPEG-TS потоки (через mpegts.js)
        else if (protocol === 'flv' || protocol === 'ts' || url.includes('.flv') || url.includes('.ts')) {
          if (mpegts.isSupported()) {
            mpegtsPlayer = mpegts.createPlayer({
              type: protocol === 'flv' ? 'flv' : 'mpegts',
              url: url,
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
                  console.log('Autoplay prevented:', e);
                });
              }
            }
            
            mpegtsPlayer.on(mpegts.Events.ERROR, (errorType: any, errorDetail: any, errorInfo: any) => {
              console.error('MPEGTS error:', errorType, errorDetail, errorInfo);
              setError(`Ошибка ${errorType}: ${errorDetail}`);
            });
          } else {
            setError('MPEG-TS/FLV не поддерживается в этом браузере');
          }
        }
        // HTTP/HTTPS потоки (MP4, WebM)
        else if (protocol === 'http' || protocol === 'https') {
          video.src = url;
          video.addEventListener('loadeddata', () => {
            if (autoPlay) {
              video.play().catch(e => console.log('Autoplay prevented:', e));
            }
          });
        }
        // RTSP потоки - показываем инструкцию
        else if (protocol === 'rtsp') {
          setError('RTSP требует конвертер в HTTP-FLV/HLS');
        }
        // RTMP потоки
        else if (protocol === 'rtmp') {
          setError('RTMP требует конвертер в HTTP-FLV/HLS');
        }
        // WebRTC
        else if (protocol === 'webrtc') {
          setError('WebRTC требует специальный сервер');
        }
      } catch (err) {
        console.error('Video player error:', err);
        setError('Ошибка воспроизведения');
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
  }, [url, protocol, autoPlay, retryCount]);

  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);
  const handleError = () => {
    setError('Ошибка загрузки видео');
  };

  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
    setError(null);
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
      />
      
      {/* Индикатор LIVE */}
      {isPlaying && (
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 px-2 py-0.5 rounded backdrop-blur-sm">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] text-white font-medium">LIVE</span>
        </div>
      )}

      {/* Протокол */}
      <div className="absolute top-2 right-2 bg-black/60 px-2 py-0.5 rounded backdrop-blur-sm">
        <span className="text-[10px] text-purple-400 uppercase font-medium">{protocol}</span>
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
