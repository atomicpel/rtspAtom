import React, { createContext, useContext, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextType {
  toast: (type: ToastType, message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((type: ToastType, message: string, duration = 3000) => {
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
    setToasts(prev => [...prev, { id, type, message, duration }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const getIcon = (type: ToastType) => {
    switch (type) {
      case 'success': return <CheckCircle className="w-5 h-5 text-green-400" />;
      case 'error': return <AlertCircle className="w-5 h-5 text-red-400" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
      case 'info': return <Info className="w-5 h-5 text-blue-400" />;
    }
  };

  const getBg = (type: ToastType) => {
    switch (type) {
      case 'success': return 'from-green-950/90 to-green-900/70 border-green-700/50';
      case 'error': return 'from-red-950/90 to-red-900/70 border-red-700/50';
      case 'warning': return 'from-yellow-950/90 to-yellow-900/70 border-yellow-700/50';
      case 'info': return 'from-blue-950/90 to-blue-900/70 border-blue-700/50';
    }
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] space-y-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 100, scale: 0.8 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 100, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl bg-gradient-to-r ${getBg(t.type)} shadow-2xl min-w-[280px] max-w-[400px]`}
            >
              {getIcon(t.type)}
              <span className="text-sm text-white flex-1">{t.message}</span>
              <button
                onClick={() => removeToast(t.id)}
                className="p-0.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
