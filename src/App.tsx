import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './components/Toast';
import { AnimatedBackground } from './components/AnimatedBackground';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { VideoWallPage } from './pages/VideoWallPage';
import { ComputersPage } from './pages/ComputersPage';
import { UsersPage } from './pages/UsersPage';
import { IpFilterPage } from './pages/IpFilterPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AboutPage } from './pages/AboutPage';

const PAGE_ROLES: Record<string, string[]> = {
  'dashboard': ['admin', 'operator', 'viewer'],
  'video-wall': ['admin', 'operator', 'viewer'],
  'computers': ['admin'],
  'users': ['admin'],
  'ip-filter': ['admin'],
  'logs': ['admin', 'operator'],
  'settings': ['admin'],
  'about': ['admin', 'operator', 'viewer'],
};

function AppContent() {
  const { user, checking } = useAuth();
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [isWallFullscreen, setIsWallFullscreen] = useState(false);

  const canAccessPage = (page: string): boolean => {
    if (!user) return false;
    const allowedRoles = PAGE_ROLES[page] || [];
    if (user.isAdmin) return true;
    return allowedRoles.includes(user.role);
  };

  const handleNavigate = (page: string) => {
    if (canAccessPage(page)) {
      setCurrentPage(page);
    } else {
      setCurrentPage('dashboard');
    }
  };

  useEffect(() => {
    if (user && !canAccessPage(currentPage)) {
      setCurrentPage('dashboard');
    }
  }, [user, currentPage]);

  useEffect(() => {
    const handleFullscreenStart = () => setIsWallFullscreen(true);
    const handleFullscreenEnd = () => setIsWallFullscreen(false);

    window.addEventListener('videowall:fullscreen:start', handleFullscreenStart);
    window.addEventListener('videowall:fullscreen:end', handleFullscreenEnd);

    return () => {
      window.removeEventListener('videowall:fullscreen:start', handleFullscreenStart);
      window.removeEventListener('videowall:fullscreen:end', handleFullscreenEnd);
    };
  }, []);

  if (checking) {
    return (
      <>
        <AnimatedBackground />
        <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Загрузка…</div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <AnimatedBackground />
        <LoginPage />
      </>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <DashboardPage />;
      case 'video-wall': return <VideoWallPage />;
      case 'computers': return canAccessPage('computers') ? <ComputersPage /> : <DashboardPage />;
      case 'users': return canAccessPage('users') ? <UsersPage /> : <DashboardPage />;
      case 'ip-filter': return canAccessPage('ip-filter') ? <IpFilterPage /> : <DashboardPage />;
      case 'logs': return canAccessPage('logs') ? <LogsPage /> : <DashboardPage />;
      case 'settings': return canAccessPage('settings') ? <SettingsPage /> : <DashboardPage />;
      case 'about': return <AboutPage />;
      default: return <DashboardPage />;
    }
  };

  if (isWallFullscreen && currentPage === 'video-wall') {
    return (
      <>
        <AnimatedBackground />
        {renderPage()}
      </>
    );
  }

  return (
    <>
      <AnimatedBackground />
      <Layout currentPage={currentPage} onNavigate={handleNavigate}>
        {renderPage()}
      </Layout>
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
