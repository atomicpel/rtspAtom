import React, { createContext, useCallback, useContext, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextType {
  toast: (type: ToastType, message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const BAR: Record<ToastType, string> = {
  success: 'bg-ok',
  error: 'bg-alarm',
  warning: 'bg-warn',
  info: 'bg-steel',
};

let seq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((type: ToastType, message: string, duration = 3200) => {
    const id = ++seq;
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="pointer-events-auto flex items-stretch min-w-[260px] max-w-[380px] bg-panel border border-line rounded-md overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.4)] cursor-pointer"
            >
              <span className={`w-1 shrink-0 ${BAR[t.type]}`} />
              <span className="px-3.5 py-2.5 text-sm">{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
