import React, { useRef, useEffect, useState } from 'react';
import Hls from 'hls.js';
import { StreamProtocol } from '../lib/types';
import { AlertCircle, Video, Radio, Globe, Film, Wifi } from 'lucide-react';

interface VideoPlayerProps {
  url: string;
  protocol: StreamProtocol;
  name: string;
  className?: string;
  autoPlay?: boolean;
  muted?: boolean;
}

export function VideoPlayer({ url, protocol, name, className = '', autoPlay = true, muted = true }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    let hls: Hls | null = null;
    setError(null);

    try {
      // HLS/m3u8 потоки
      if (protocol === 'hls' || protocol === 'm3u8' || url.includes('.m3u8')) {
        if (Hls.isSupported()) {
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
          });
          hls.loadSource(url);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (autoPlay) {
              video.play().catch(e => console.log('Autoplay prevented:', e));
            }
          });
          hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS error:', data);
            if (data.fatal) {
              setError(`HLS ошибка: ${data.type}`);
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
      // HTTP/HTTPS потоки (MP4, WebM)
      else if (protocol === 'http' || protocol === 'https') {
        video.src = url;
        if (autoPlay) {
          video.play().catch(e => console.log('Autoplay prevented:', e));
        }
      }
      // FLV потоки (через video тег не работают, нужна библиотека flv.js)
      else if (protocol === 'flv') {
        setError('FLV требует сервер-конвертер (MediaMTX, SRS)');
      }
      // RTSP потоки (браузер не поддерживает напрямую)
      else if (protocol === 'rtsp') {
        setError('RTSP требует сервер-конвертер в HLS/WebRTC');
      }
      // RTMP потоки
      else if (protocol === 'rtmp') {
        setError('RTMP требует сервер-конвертер в HLS/WebRTC');
      }
      // WebRTC
      else if (protocol === 'webrtc') {
        setError('WebRTC требует специальный сервер (Janus, mediasoup)');
      }
      // MPEG-TS
      else if (protocol === 'ts') {
        setError('MPEG-TS требует сервер-конвертер');
      }
    } catch (err) {
      console.error('Video player error:', err);
      setError('Ошибка воспроизведения');
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [url, protocol, autoPlay]);

  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);
  const handleError = () => setError('Ошибка загрузки видео');

  // Если есть ошибка или неподдерживаемый протокол
  if (error) {
    return (
      <div className={`relative bg-gradient-to-br from-gray-900 to-gray-800 rounded-lg overflow-hidden flex items-center justify-center ${className}`}>
        <div className="text-center p-4">
          <AlertCircle className="w-12 h-12 mx-auto text-yellow-500 mb-3" />
          <p className="text-sm text-white font-medium mb-2">{name}</p>
          <p className="text-xs text-yellow-400 mb-3">{error}</p>
          <div className="text-[10px] text-gray-500 space-y-1">
            <p>Для воспроизведения {protocol.toUpperCase()} нужен:</p>
            <p>• MediaMTX, SRS или FFmpeg сервер</p>
            <p>• Конвертация в HLS/WebRTC</p>
          </div>
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
