import React, { useEffect, useMemo, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';
import { Layout, NavItem } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { VideoWallPage } from './pages/VideoWallPage';
import { StreamsPage } from './pages/StreamsPage';
import { UsersPage } from './pages/UsersPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';
import type { User } from './lib/types';

const PAGES: (NavItem & { allowed: (u: User) => boolean })[] = [
  { id: 'wall', label: 'Видеостена', allowed: () => true },
  { id: 'streams', label: 'Потоки', allowed: (u) => u.isAdmin },
  { id: 'users', label: 'Пользователи', allowed: (u) => u.isAdmin },
  { id: 'logs', label: 'Журнал', allowed: (u) => u.isAdmin || u.role === 'operator' },
  { id: 'settings', label: 'Настройки', allowed: (u) => u.isAdmin },
];

const pageFromHash = () => window.location.hash.replace(/^#\/?/, '') || 'wall';

function AppContent() {
  const { user, checking } = useAuth();
  const [page, setPage] = useState(pageFromHash);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const items = useMemo(() => (user ? PAGES.filter((p) => p.allowed(user)) : []), [user]);
  const current = items.some((i) => i.id === page) ? page : 'wall';
  const navigate = (id: string) => { window.location.hash = `/${id}`; };

  if (checking) return null;
  if (!user) return <LoginPage />;

  return (
    <Layout items={items} current={current} onNavigate={navigate}>
      {current === 'wall' && <VideoWallPage onNavigate={navigate} />}
      {current === 'streams' && <StreamsPage />}
      {current === 'users' && <UsersPage />}
      {current === 'logs' && <LogsPage />}
      {current === 'settings' && <SettingsPage />}
    </Layout>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ToastProvider>
    </MotionConfig>
  );
}
