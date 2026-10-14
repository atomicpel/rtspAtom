import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { initializeDb } from './lib/storage';
import { initializeRtspMock } from './lib/rtsp-mock';
import { getStreams } from './lib/storage';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { StreamsPage } from './pages/StreamsPage';
import { UsersPage } from './pages/UsersPage';
import { IpFilterPage } from './pages/IpFilterPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AboutPage } from './pages/AboutPage';

function AppContent() {
  const { user, isFirstRun } = useAuth();
  const [currentPage, setCurrentPage] = useState('dashboard');

  // Initialize DB and mock on mount
  useEffect(() => {
    initializeDb();
    const streams = getStreams();
    initializeRtspMock(streams);
  }, []);

  // Show login if not authenticated
  if (!user && !isFirstRun) {
    return <LoginPage />;
  }

  // Show first-run setup
  if (isFirstRun) {
    return <LoginPage />;
  }

  // Render page based on current route
  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <DashboardPage />;
      case 'streams': return <StreamsPage />;
      case 'users': return <UsersPage />;
      case 'ip-filter': return <IpFilterPage />;
      case 'logs': return <LogsPage />;
      case 'settings': return <SettingsPage />;
      case 'about': return <AboutPage />;
      default: return <DashboardPage />;
    }
  };

  return (
    <Layout currentPage={currentPage} onNavigate={setCurrentPage}>
      {renderPage()}
    </Layout>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
