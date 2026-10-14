import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './components/Toast';
import { AnimatedBackground } from './components/AnimatedBackground';
import { initializeDb, getSystems } from './lib/storage';
import { initializeRtspMock } from './lib/rtsp-mock';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { VideoWallPage } from './pages/VideoWallPage';
import { SystemsPage } from './pages/SystemsPage';
import { UsersPage } from './pages/UsersPage';
import { IpFilterPage } from './pages/IpFilterPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AboutPage } from './pages/AboutPage';

// Роли, которым доступна каждая страница
const PAGE_ROLES: Record<string, string[]> = {
  'dashboard': ['admin', 'operator', 'viewer'],
  'video-wall': ['admin', 'operator', 'viewer'],
  'systems': ['admin'],
  'users': ['admin'],
  'ip-filter': ['admin'],
  'logs': ['admin', 'operator'],
  'settings': ['admin'],
  'about': ['admin', 'operator', 'viewer'],
};

function AppContent() {
  const { user, isFirstRun } = useAuth();
  const [currentPage, setCurrentPage] = useState('dashboard');

  // Initialize DB and mock on mount
  useEffect(() => {
    initializeDb();
    const systems = getSystems();
    initializeRtspMock(systems);
  }, []);

  // Проверка доступа к странице
  const canAccessPage = (page: string): boolean => {
    if (!user) return false;
    const allowedRoles = PAGE_ROLES[page] || [];
    // Администраторы (isAdmin=true) имеют доступ ко всему
    if (user.isAdmin) return true;
    return allowedRoles.includes(user.role);
  };

  // Обёртка для навигации с проверкой прав
  const handleNavigate = (page: string) => {
    if (canAccessPage(page)) {
      setCurrentPage(page);
    } else {
      setCurrentPage('dashboard');
    }
  };

  // Если пользователь пытается зайти на недоступную страницу — редирект
  useEffect(() => {
    if (user && !canAccessPage(currentPage)) {
      setCurrentPage('dashboard');
    }
  }, [user, currentPage]);

  // Show login / first-run setup
  if (!user || isFirstRun) {
    return (
      <>
        <AnimatedBackground />
        <LoginPage />
      </>
    );
  }

  // Render page based on current route
  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <DashboardPage />;
      case 'video-wall': return <VideoWallPage />;
      case 'systems': return canAccessPage('systems') ? <SystemsPage /> : <DashboardPage />;
      case 'users': return canAccessPage('users') ? <UsersPage /> : <DashboardPage />;
      case 'ip-filter': return canAccessPage('ip-filter') ? <IpFilterPage /> : <DashboardPage />;
      case 'logs': return canAccessPage('logs') ? <LogsPage /> : <DashboardPage />;
      case 'settings': return canAccessPage('settings') ? <SettingsPage /> : <DashboardPage />;
      case 'about': return <AboutPage />;
      default: return <DashboardPage />;
    }
  };

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
