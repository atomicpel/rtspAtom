import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Wifi } from 'lucide-react';
import { RECONNECTED_EVENT, connectionState, subscribeConnection } from '../lib/connection';

/** Плашка «нет связи с сервером»: появляется при обрыве, исчезает сама после восстановления. */
export function ConnectionBanner() {
  const [st, setSt] = useState(connectionState());
  const [, tick] = useState(0);
  const [restored, setRestored] = useState<number | null>(null);

  useEffect(() => subscribeConnection(setSt), []);
  useEffect(() => {
    if (st.online) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [st.online]);
  useEffect(() => {
    const h = (e: Event) => {
      const down = (e as CustomEvent).detail?.downMs || 0;
      if (down < 1500) return;
      setRestored(down);
      setTimeout(() => setRestored(null), 3000);
    };
    window.addEventListener(RECONNECTED_EVENT, h);
    return () => window.removeEventListener(RECONNECTED_EVENT, h);
  }, []);

  const secs = st.since ? Math.round((Date.now() - st.since) / 1000) : 0;
  return (
    <AnimatePresence>
      {(!st.online || restored !== null) && (
        <motion.div role="status" aria-live="polite"
          initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -40, opacity: 0 }}
          className={`fixed top-2 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-3.5 py-2 rounded-md border text-[13px] shadow-[0_8px_30px_rgba(0,0,0,0.5)] ${
            st.online ? 'bg-panel border-ok/50 text-fg' : 'bg-panel border-alarm/60 text-fg'}`}>
          {st.online ? (
            <><Wifi className="w-4 h-4 text-ok" /> Связь с сервером восстановлена (перерыв {Math.round((restored || 0) / 1000)} с)</>
          ) : (
            <><Loader2 className="w-4 h-4 text-alarm animate-spin" /> Нет связи с сервером — переподключаюсь{secs >= 2 ? ` (${secs} с)` : ''}. Перезагружать страницу не нужно.</>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
