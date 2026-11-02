/**
 * Связь браузера с сервером панели. Любой неудачный запрос (сеть, сервер перезапускается)
 * переводит в состояние «нет связи»: каждые 2 секунды проверяется /api/auth/status, интерфейс
 * показывает плашку, а после восстановления страницы сами обновляют данные и видео —
 * перезагружать страницу не нужно. Об обрыве дольше 3 секунд сообщается в журнал сервера.
 */
export const RECONNECTED_EVENT = 'rtspatom:reconnected';

type Listener = (s: ConnectionState) => void;
export interface ConnectionState {
  online: boolean;
  since: number | null; // когда пропала связь
}

let state: ConnectionState = { online: true, since: null };
const listeners = new Set<Listener>();
let probeTimer: ReturnType<typeof setTimeout> | null = null;

function set(next: ConnectionState) {
  state = next;
  listeners.forEach((l) => l(state));
}

export function connectionState() {
  return state;
}

export function subscribeConnection(l: Listener) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

async function probe() {
  probeTimer = null;
  try {
    const r = await fetch('/api/auth/status', { credentials: 'same-origin', cache: 'no-store' });
    if (r.status < 500) { markOnline(); return; }
  } catch { /* по-прежнему нет связи */ }
  probeTimer = setTimeout(probe, 2000);
}

export function markOffline() {
  if (!state.online) return;
  set({ online: false, since: Date.now() });
  if (!probeTimer) probeTimer = setTimeout(probe, 1000);
}

export function markOnline() {
  if (state.online) return;
  const since = state.since || Date.now();
  const downMs = Date.now() - since;
  if (probeTimer) { clearTimeout(probeTimer); probeTimer = null; }
  set({ online: true, since: null });
  window.dispatchEvent(new CustomEvent(RECONNECTED_EVENT, { detail: { downMs, since } }));
  if (downMs >= 3000) {
    // в журнал сервера: когда и насколько браузер терял связь
    fetch('/api/client-event', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-RTSPAtom': '1' },
      body: JSON.stringify({ kind: 'connection-lost', since: new Date(since).toISOString(), downMs }),
    }).catch(() => {});
  }
}

/** Вызвать функцию после каждого восстановления связи. */
export function onReconnected(fn: () => void) {
  const h = () => fn();
  window.addEventListener(RECONNECTED_EVENT, h);
  return () => window.removeEventListener(RECONNECTED_EVENT, h);
}
