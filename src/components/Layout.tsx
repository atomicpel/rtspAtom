import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, KeyRound, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api, errorMessage } from '../lib/api';
import { useToast } from './Toast';
import { Button, Field, Modal, inputCls } from './ui';

export interface NavItem {
  id: string;
  label: string;
}

const ROLE_NAME: Record<string, string> = { admin: 'администратор', operator: 'оператор', viewer: 'наблюдатель' };

export function Clock({ className = '' }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className={`tabular ${className}`}>
      {now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
      {'  '}
      <span className="text-fg">{now.toLocaleTimeString('ru-RU')}</span>
    </span>
  );
}

export function Layout({
  items, current, onNavigate, children,
}: { items: NavItem[]; current: string; onNavigate: (id: string) => void; children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [pwError, setPwError] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const changePassword = async () => {
    setPwError('');
    if (pw.next.length < 8) return setPwError('Новый пароль должен быть не короче 8 символов');
    if (pw.next !== pw.repeat) return setPwError('Пароли не совпадают');
    setPwBusy(true);
    try {
      await api.changeOwnPassword(pw.current, pw.next);
      toast('success', 'Пароль изменён. Другие сеансы завершены.');
      setPwOpen(false);
      setPw({ current: '', next: '', repeat: '' });
    } catch (err) {
      setPwError(errorMessage(err));
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="h-12 shrink-0 flex items-center gap-6 px-4 border-b border-line bg-ink">
        <span className="font-bold tracking-tight select-none">RTSP Atom</span>

        <nav className="flex items-stretch h-full gap-1 overflow-x-auto" aria-label="Разделы">
          {items.map((item) => {
            const active = item.id === current;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`relative px-3 text-sm whitespace-nowrap transition-colors ${active ? 'text-fg' : 'text-muted hover:text-fg'}`}
              >
                {item.label}
                {active && (
                  <motion.span
                    layoutId="nav-underline"
                    className="absolute left-2 right-2 -bottom-px h-0.5 bg-fg"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          <Clock className="hidden md:inline text-[13px] text-muted whitespace-pre" />
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 h-8 px-2 rounded-md text-sm text-muted hover:text-fg hover:bg-raised"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              {user?.login}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 top-10 z-40 w-56 bg-panel border border-line rounded-md py-1 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
                >
                  <div className="px-3 py-2 text-[13px] text-muted border-b border-line mb-1">
                    {user?.login}, {ROLE_NAME[user?.role || 'viewer']}
                  </div>
                  <button role="menuitem" onClick={() => { setMenuOpen(false); setPwOpen(true); setPwError(''); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-raised">
                    <KeyRound className="w-4 h-4 text-muted" /> Сменить пароль
                  </button>
                  <button role="menuitem" onClick={() => { setMenuOpen(false); logout(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-raised">
                    <LogOut className="w-4 h-4 text-muted" /> Выйти
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 relative">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current}
            className="absolute inset-0 overflow-auto"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      <Modal
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title="Смена пароля"
        footer={<>
          <Button variant="ghost" onClick={() => setPwOpen(false)}>Отмена</Button>
          <Button variant="primary" busy={pwBusy} onClick={changePassword}>Сменить пароль</Button>
        </>}
      >
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); changePassword(); }}>
          {pwError && <p className="text-sm text-alarm">{pwError}</p>}
          <Field label="Текущий пароль">
            <input type="password" autoComplete="current-password" className={inputCls}
              value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoFocus />
          </Field>
          <Field label="Новый пароль" hint="Не короче 8 символов">
            <input type="password" autoComplete="new-password" className={inputCls}
              value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <Field label="Повторите новый пароль">
            <input type="password" autoComplete="new-password" className={inputCls}
              value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} />
          </Field>
          <button type="submit" className="hidden" />
        </form>
      </Modal>
    </div>
  );
}
