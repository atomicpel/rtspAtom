import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import type { StreamStatus } from '../lib/types';

/* Набор простых элементов интерфейса в одной строгой стилистике. */

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'subtle';

const BTN: Record<BtnVariant, string> = {
  primary: 'bg-fg text-ink hover:bg-white',
  subtle: 'bg-raised text-fg hover:bg-line-strong',
  ghost: 'text-muted hover:text-fg hover:bg-raised',
  danger: 'text-alarm hover:bg-alarm/10',
};

export function Button({
  variant = 'subtle', busy, icon: Icon, children, className = '', ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; busy?: boolean; icon?: React.ElementType }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${BTN[variant]} ${className}`}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : Icon ? <Icon className="w-4 h-4" /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon: Icon, label, active, className = '', ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ElementType; label: string; active?: boolean }) {
  return (
    <button
      {...rest}
      title={label}
      aria-label={label}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors disabled:opacity-40 ${
        active ? 'bg-raised text-fg' : 'text-muted hover:text-fg hover:bg-raised'
      } ${className}`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

export const inputCls =
  'w-full h-9 px-3 rounded-md bg-raised border border-line text-fg placeholder:text-muted/70 ' +
  'focus:outline-none focus:border-steel transition-colors disabled:opacity-60';

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[13px] text-muted mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted mt-1.5">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 text-sm"
    >
      <span className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-steel' : 'bg-line-strong'}`}>
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          className="absolute top-0.5 w-4 h-4 rounded-full bg-fg"
          style={{ left: checked ? 18 : 2 }}
        />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}

const STATUS_COLOR: Record<StreamStatus, string> = {
  online: 'bg-ok',
  reconnecting: 'bg-warn',
  idle: 'bg-steel',
  offline: 'bg-line-strong',
};

export const STATUS_TEXT: Record<StreamStatus, string> = {
  online: 'В сети',
  reconnecting: 'Нет сигнала',
  idle: 'По запросу',
  offline: 'Отключён',
};

export function StatusDot({ status, className = '' }: { status: StreamStatus; className?: string }) {
  return (
    <span className={`relative inline-flex w-2 h-2 shrink-0 ${className}`} title={STATUS_TEXT[status]}>
      {status === 'online' && <span className="absolute inset-0 rounded-full bg-ok opacity-60 animate-ping" style={{ animationDuration: '2.4s' }} />}
      <span className={`relative w-2 h-2 rounded-full ${STATUS_COLOR[status]}`} />
    </span>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="text-muted mt-1">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  );
}

export function Section({ title, desc, children, className = '' }: { title: string; desc?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`grid gap-4 md:grid-cols-[240px_1fr] py-6 border-t border-line first:border-t-0 ${className}`}>
      <div>
        <h2 className="font-bold">{title}</h2>
        {desc && <p className="text-[13px] text-muted mt-1">{desc}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function Modal({
  open, onClose, title, children, footer, wide,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] flex flex-col bg-panel border border-line rounded-lg shadow-[0_20px_60px_rgba(0,0,0,0.5)]`}
          >
            <div className="flex items-center justify-between px-5 h-14 border-b border-line shrink-0">
              <h2 className="font-bold text-base">{title}</h2>
              <IconButton icon={X} label="Закрыть" onClick={onClose} />
            </div>
            <div className="p-5 overflow-y-auto">{children}</div>
            {footer && <div className="flex justify-end gap-2 px-5 py-4 border-t border-line shrink-0">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-4">
      <Icon className="w-10 h-10 text-line-strong mb-4" strokeWidth={1.25} />
      <p className="text-base font-bold">{title}</p>
      {children && <div className="text-muted mt-1.5 max-w-sm">{children}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: React.ReactNode }) {
  const cls = tone === 'error' ? 'border-alarm/40 text-[#e9a29b]' : tone === 'warn' ? 'border-warn/40 text-[#e0c88f]' : 'border-line text-muted';
  return <div className={`border-l-2 pl-3 py-1 text-[13px] ${cls}`}>{children}</div>;
}
