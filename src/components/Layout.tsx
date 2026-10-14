import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { 
  LayoutDashboard, Video, Users, Shield, ScrollText, 
  Settings, Info, LogOut, Sun, Moon, Menu, X, Monitor
} from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
}

const menuItems = [
  { id: 'dashboard', label: 'Панель управления', icon: LayoutDashboard, roles: ['admin', 'operator', 'viewer'] },
  { id: 'streams', label: 'Потоки', icon: Video, roles: ['admin', 'operator', 'viewer'] },
  { id: 'users', label: 'Пользователи', icon: Users, roles: ['admin'] },
  { id: 'ip-filter', label: 'IP-фильтр', icon: Shield, roles: ['admin'] },
  { id: 'logs', label: 'Журналы', icon: ScrollText, roles: ['admin', 'operator'] },
  { id: 'settings', label: 'Настройки', icon: Settings, roles: ['admin'] },
  { id: 'about', label: 'О системе', icon: Info, roles: ['admin', 'operator', 'viewer'] },
];

export function Layout({ children, currentPage, onNavigate }: LayoutProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const filteredMenu = menuItems.filter(item => 
    user && item.roles.includes(user.role)
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50
        w-64 bg-gray-900 border-r border-gray-800 
        flex flex-col transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo area */}
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <Monitor className="w-8 h-8 text-blue-500" />
            <div>
              <h1 className="text-sm font-bold text-white">RTSP Сервер</h1>
              <p className="text-xs text-blue-400 font-semibold">115 обрОсН</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {filteredMenu.map(item => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { onNavigate(item.id); setSidebarOpen(false); }}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors
                  ${isActive 
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30' 
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'}
                `}
              >
                <Icon className="w-4.5 h-4.5" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* User info */}
        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">
              {user?.login.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.login}</p>
              <p className="text-xs text-gray-500">
                {user?.role === 'admin' ? 'Администратор' : 
                 user?.role === 'operator' ? 'Оператор' : 'Наблюдатель'}
              </p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-red-400 hover:bg-red-950/30 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Выйти
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Header */}
        <header className="h-14 bg-gray-900/80 backdrop-blur border-b border-gray-800 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-gray-800 text-gray-400"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <h2 className="text-sm font-medium text-gray-300">
              {filteredMenu.find(m => m.id === currentPage)?.label || 'Панель управления'}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-xs font-bold text-blue-400 bg-blue-950/50 px-2 py-1 rounded">
              115 обрОсН
            </span>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
              title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          {children}
        </main>

        {/* Footer */}
        <footer className="h-10 bg-gray-900/50 border-t border-gray-800 flex items-center justify-between px-4 lg:px-6 text-xs text-gray-500">
          <span>RTSP Сервер видеотрансляции • Изолированная сеть</span>
          <span className="font-semibold text-blue-500">115 обрОсН</span>
        </footer>
      </div>
    </div>
  );
}
