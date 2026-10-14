import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { 
  LayoutDashboard, LayoutGrid, Server, Video, Users, Shield, ScrollText, 
  Settings, Info, LogOut, Sun, Moon, Menu, X, Monitor, Sparkles
} from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
}

const menuItems = [
  { id: 'dashboard', label: 'Панель управления', icon: LayoutDashboard, roles: ['admin', 'operator', 'viewer'] },
  { id: 'video-wall', label: 'Видеостена', icon: LayoutGrid, roles: ['admin', 'operator', 'viewer'] },
  { id: 'systems', label: 'Системы', icon: Server, roles: ['admin'] },
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
    <div className="min-h-screen flex relative">
      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        initial={{ x: -280 }}
        animate={{ x: sidebarOpen ? 0 : 0 }}
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-64 glass-strong flex flex-col
          transition-transform duration-300 ease-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo area */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-4 border-b border-gray-800/50"
        >
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ 
                rotate: [0, 5, -5, 0],
              }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="relative"
            >
              <Monitor className="w-8 h-8 text-blue-400" />
              <motion.div
                animate={{ opacity: [0.3, 0.7, 0.3] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute inset-0 bg-blue-500/30 blur-lg rounded-full"
              />
            </motion.div>
            <div>
              <h1 className="text-sm font-bold text-white">RTSP Сервер</h1>
              <p className="text-xs text-gradient font-semibold flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                115 обрОсН
              </p>
            </div>
          </div>
        </motion.div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {filteredMenu.map((item, index) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <motion.button
                key={item.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + index * 0.05 }}
                whileHover={{ x: 4 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => { onNavigate(item.id); setSidebarOpen(false); }}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all relative overflow-hidden group
                  ${isActive 
                    ? 'bg-gradient-to-r from-blue-600/20 to-purple-600/20 text-blue-400 border border-blue-500/30 shadow-lg shadow-blue-500/10' 
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/50'}
                `}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <Icon className="w-4.5 h-4.5 relative z-10" />
                <span className="relative z-10">{item.label}</span>
                {isActive && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute right-2 w-1.5 h-1.5 rounded-full bg-blue-400"
                  />
                )}
              </motion.button>
            );
          })}
        </nav>

        {/* User info */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="p-4 border-t border-gray-800/50"
        >
          <div className="flex items-center gap-3 mb-3">
            <motion.div 
              whileHover={{ scale: 1.1, rotate: 5 }}
              className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-xs font-bold shadow-lg shadow-blue-500/30"
            >
              {user?.login.charAt(0).toUpperCase()}
            </motion.div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-white">{user?.login}</p>
              <p className="text-xs text-gray-500">
                {user?.role === 'admin' ? 'Администратор' : 
                 user?.role === 'operator' ? 'Оператор' : 'Наблюдатель'}
              </p>
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-400 hover:text-red-400 hover:bg-red-950/30 transition-all group"
          >
            <LogOut className="w-4 h-4 group-hover:rotate-12 transition-transform" />
            Выйти
          </motion.button>
        </motion.div>
      </motion.aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Header */}
        <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="h-14 glass border-b border-gray-800/50 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30"
        >
          <div className="flex items-center gap-3">
            <motion.button 
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-xl hover:bg-gray-800/50 text-gray-400 transition-colors"
            >
              <AnimatePresence mode="wait">
                {sidebarOpen ? (
                  <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}>
                    <X className="w-5 h-5" />
                  </motion.div>
                ) : (
                  <motion.div key="menu" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }}>
                    <Menu className="w-5 h-5" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
            <motion.h2 
              key={currentPage}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-sm font-medium text-gray-300"
            >
              {filteredMenu.find(m => m.id === currentPage)?.label || 'Панель управления'}
            </motion.h2>
          </div>

          <div className="flex items-center gap-3">
            <motion.span 
              whileHover={{ scale: 1.05 }}
              className="hidden sm:block text-xs font-bold text-gradient bg-blue-950/50 px-3 py-1.5 rounded-lg border border-blue-500/20"
            >
              115 обрОсН
            </motion.span>
            <motion.button
              whileHover={{ scale: 1.1, rotate: 180 }}
              whileTap={{ scale: 0.9 }}
              onClick={toggleTheme}
              className="p-2 rounded-xl hover:bg-gray-800/50 text-gray-400 hover:text-white transition-all"
              title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={theme}
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </motion.div>
              </AnimatePresence>
            </motion.button>
          </div>
        </motion.header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPage}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Footer */}
        <motion.footer 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="h-10 glass border-t border-gray-800/50 flex items-center justify-between px-4 lg:px-6 text-xs text-gray-500"
        >
          <span>RTSP Сервер видеотрансляции • Изолированная сеть</span>
          <span className="font-semibold text-gradient">115 обрОсН</span>
        </motion.footer>
      </div>
    </div>
  );
}
