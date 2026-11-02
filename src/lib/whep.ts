/**
 * Просмотр по WebRTC (протокол WHEP) с минимальной задержкой.
 * Сигнализация идёт через панель (/webrtc/<id>/whep) с проверкой входа и прав,
 * само видео — напрямую от MediaMTX по порту ICE.
 */

import { markOffline } from './connection';

export class WhepError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface WhepSession {
  pc: RTCPeerConnection;
  close: () => void;
}

const CONNECT_TIMEOUT_MS = 6000;

function waitGathering(pc: RTCPeerConnection, ms: number) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    });
  });
}

/** Минимальный буфер воспроизведения (Chrome/Edge; в остальных браузерах свойство игнорируется). */
function minimizeBuffer(receiver: RTCRtpReceiver) {
  const r = receiver as RTCRtpReceiver & { jitterBufferTarget?: number; playoutDelayHint?: number };
  try { r.jitterBufferTarget = 0; } catch { /* не поддерживается */ }
  try { r.playoutDelayHint = 0; } catch { /* не поддерживается */ }
}

export async function startWhep(
  video: HTMLVideoElement,
  streamId: string,
  onDisconnect: () => void,
): Promise<WhepSession> {
  const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
  let location: string | null = null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    pc.close();
    if (location) {
      fetch(location, { method: 'DELETE', headers: { 'X-RTSPAtom': '1' }, keepalive: true }).catch(() => {});
    }
  };

  try {
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    const stream = new MediaStream();
    pc.ontrack = (e) => {
      minimizeBuffer(e.receiver);
      stream.addTrack(e.track);
      if (video.srcObject !== stream) video.srcObject = stream;
    };

    await pc.setLocalDescription(await pc.createOffer());
    // В локальной сети кандидаты собираются за миллисекунды; ждём не дольше секунды.
    await waitGathering(pc, 1000);

    let res: Response;
    try {
      res = await fetch(`/webrtc/${encodeURIComponent(streamId)}/whep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp', 'X-RTSPAtom': '1' },
        body: pc.localDescription!.sdp,
        credentials: 'same-origin',
      });
    } catch {
      markOffline();
      // нет связи с самим сервером панели — это не повод отказываться от WebRTC
      throw new WhepError(-1, 'нет связи с сервером');
    }
    if (res.status !== 201) {
      let msg = `код ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch { /* не JSON */ }
      throw new WhepError(res.status, msg);
    }
    location = res.headers.get('Location');
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new WhepError(0, 'нет связи по WebRTC (порт видео закрыт?)')), CONNECT_TIMEOUT_MS);
      const check = () => {
        if (pc.connectionState === 'connected') { clearTimeout(t); resolve(); }
        if (pc.connectionState === 'failed') { clearTimeout(t); reject(new WhepError(0, 'соединение WebRTC не установлено')); }
      };
      pc.addEventListener('connectionstatechange', check);
      check();
    });

    pc.addEventListener('connectionstatechange', () => {
      if (!closed && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed')) {
        onDisconnect();
      }
    });
    return { pc, close };
  } catch (err) {
    close();
    throw err;
  }
}

/** Оценка задержки сети и буфера плеера по статистике WebRTC, мс. */
export async function webrtcLatencyMs(pc: RTCPeerConnection): Promise<number | null> {
  try {
    const stats = await pc.getStats();
    let buffer: number | null = null;
    let rtt = 0;
    stats.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video' && s.jitterBufferEmittedCount > 0) {
        buffer = (s.jitterBufferDelay / s.jitterBufferEmittedCount) * 1000;
      }
      if (s.type === 'candidate-pair' && s.nominated && s.currentRoundTripTime) rtt = s.currentRoundTripTime * 1000;
    });
    return buffer === null ? null : Math.round((buffer as number) + rtt / 2);
  } catch {
    return null;
  }
}
