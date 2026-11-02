/**
 * Подсказки по кодекам источника: что помешает показу с минимальной задержкой.
 * Названия дорожек — как их отдаёт MediaMTX (H264, H265, MPEG-4 Audio, Opus, G711 …).
 */
export interface CodecHint {
  level: 'warn' | 'error';
  text: string;
}

const WEBRTC_VIDEO = /^(H264|AVC|VP8|VP9|AV1)/i;
const WEBRTC_AUDIO = /^(Opus|G711|G722|LPCM)/i;
const AUDIO = /audio|opus|g71|g72|lpcm|ac-3|aac|mp3|mpeg-1\/2/i;

export function codecHints(tracks: string[]): CodecHint[] {
  const out: CodecHint[] = [];
  const video = tracks.filter((t) => !AUDIO.test(t));
  const audio = tracks.filter((t) => AUDIO.test(t));
  if (video.some((t) => /H265|HEVC/i.test(t))) {
    out.push({ level: 'warn', text: 'Видео H.265: многие браузеры не показывают его по WebRTC, будет HLS с задержкой около секунды. Переключите источник на H.264.' });
  } else if (video.length && !video.some((t) => WEBRTC_VIDEO.test(t))) {
    out.push({ level: 'error', text: `Видео ${video.join(', ')} браузер не покажет. Нужен H.264.` });
  }
  if (audio.length && !audio.some((t) => WEBRTC_AUDIO.test(t))) {
    out.push({ level: 'warn', text: `Звук ${audio.join(', ')} не передаётся по WebRTC (видео покажется, но без звука). Выберите в источнике Opus или G.711, либо отключите звук.` });
  }
  return out;
}
