import React from 'react';
import { motion } from 'framer-motion';
import { Monitor, Shield, Server, Network, Lock, Database, Sparkles } from 'lucide-react';
import { AnimatedCard, StaggerContainer, StaggerItem } from '../components/AnimatedCard';

export function AboutPage() {
  return (
    <div className="space-y-8 max-w-3xl">
      {/* Hero */}
      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center py-8"
      >
        <motion.div
          animate={{ 
            rotate: [0, 5, -5, 0],
            scale: [1, 1.05, 1]
          }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="inline-flex items-center justify-center w-24 h-24 rounded-2xl bg-gradient-to-br from-blue-600/30 to-purple-600/30 border border-blue-500/30 mb-6 relative"
        >
          <Monitor className="w-12 h-12 text-blue-400" />
          <motion.div
            animate={{ opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 blur-xl"
          />
        </motion.div>
        <motion.h1 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="text-5xl font-bold text-gradient mb-3"
        >
          RTSP Сервер
        </motion.h1>
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-3xl font-bold text-blue-400 flex items-center justify-center gap-3 mb-4"
        >
          <Sparkles className="w-6 h-6 animate-pulse" />
          115 обрОсН
          <Sparkles className="w-6 h-6 animate-pulse" style={{ animationDelay: '0.5s' }} />
        </motion.p>
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-gray-400 max-w-lg mx-auto"
        >
          Панель управления сервером RTSP-видеотрансляции для развёртывания 
          в изолированной локальной сети
        </motion.p>
      </motion.div>

      {/* Main Label */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.5 }}
        className="relative overflow-hidden rounded-2xl p-10 text-center"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-blue-950/50 via-purple-950/50 to-pink-950/50 border border-blue-800/30 rounded-2xl" />
        <motion.div
          animate={{ 
            backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
          }}
          transition={{ duration: 5, repeat: Infinity }}
          className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10"
          style={{ backgroundSize: '200% 200%' }}
        />
        <motion.p 
          animate={{ 
            scale: [1, 1.02, 1],
          }}
          transition={{ duration: 3, repeat: Infinity }}
          className="text-6xl font-black text-gradient tracking-wider relative"
        >
          115 обрОсН
        </motion.p>
        <p className="text-sm text-gray-400 mt-4 relative">
          Система видеонаблюдения и ретрансляции
        </p>
      </motion.div>

      {/* Features */}
      <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StaggerItem>
          <AnimatedCard className="p-5 group">
            <div className="flex items-center gap-3 mb-3">
              <motion.div 
                whileHover={{ scale: 1.2, rotate: 10 }}
                className="p-2.5 rounded-xl bg-blue-950/50 text-blue-400"
              >
                <Server className="w-5 h-5" />
              </motion.div>
              <h3 className="text-sm font-medium text-white group-hover:text-blue-400 transition-colors">RTSP-ретрансляция</h3>
            </div>
            <p className="text-xs text-gray-400">
              Приём и ретрансляция RTSP-потоков с IP-камер. Поддержка HLS/WebRTC для клиентов.
            </p>
          </AnimatedCard>
        </StaggerItem>

        <StaggerItem>
          <AnimatedCard className="p-5 group">
            <div className="flex items-center gap-3 mb-3">
              <motion.div 
                whileHover={{ scale: 1.2, rotate: 10 }}
                className="p-2.5 rounded-xl bg-green-950/50 text-green-400"
              >
                <Shield className="w-5 h-5" />
              </motion.div>
              <h3 className="text-sm font-medium text-white group-hover:text-green-400 transition-colors">Безопасность</h3>
            </div>
            <p className="text-xs text-gray-400">
              JWT-аутентификация, RBAC, IP-фильтрация, rate limiting, аудит действий.
            </p>
          </AnimatedCard>
        </StaggerItem>

        <StaggerItem>
          <AnimatedCard className="p-5 group">
            <div className="flex items-center gap-3 mb-3">
              <motion.div 
                whileHover={{ scale: 1.2, rotate: 10 }}
                className="p-2.5 rounded-xl bg-purple-950/50 text-purple-400"
              >
                <Network className="w-5 h-5" />
              </motion.div>
              <h3 className="text-sm font-medium text-white group-hover:text-purple-400 transition-colors">Изолированная сеть</h3>
            </div>
            <p className="text-xs text-gray-400">
              Полностью автономная работа без доступа в Интернет. Astra Linux совместимость.
            </p>
          </AnimatedCard>
        </StaggerItem>

        <StaggerItem>
          <AnimatedCard className="p-5 group">
            <div className="flex items-center gap-3 mb-3">
              <motion.div 
                whileHover={{ scale: 1.2, rotate: 10 }}
                className="p-2.5 rounded-xl bg-orange-950/50 text-orange-400"
              >
                <Lock className="w-5 h-5" />
              </motion.div>
              <h3 className="text-sm font-medium text-white group-hover:text-orange-400 transition-colors">Ролевой доступ</h3>
            </div>
            <p className="text-xs text-gray-400">
              Три роли: администратор, оператор, наблюдатель. Гибкое управление правами.
            </p>
          </AnimatedCard>
        </StaggerItem>

        <StaggerItem>
          <AnimatedCard className="p-5 group">
            <div className="flex items-center gap-3 mb-3">
              <motion.div 
                whileHover={{ scale: 1.2, rotate: 10 }}
                className="p-2.5 rounded-xl bg-cyan-950/50 text-cyan-400"
              >
                <Database className="w-5 h-5" />
              </motion.div>
              <h3 className="text-sm font-medium text-white group-hover:text-cyan-400 transition-colors">Локальное хранение</h3>
            </div>
            <p className="text-xs text-gray-400">
              SQLite база данных, локальные журналы, экспорт в CSV. Без облачных сервисов.
            </p>
          </AnimatedCard>
        </StaggerItem>

        <StaggerItem>
          <AnimatedCard className="p-5 group">
            <div className="flex items-center gap-3 mb-3">
              <motion.div 
                whileHover={{ scale: 1.2, rotate: 10 }}
                className="p-2.5 rounded-xl bg-yellow-950/50 text-yellow-400"
              >
                <Monitor className="w-5 h-5" />
              </motion.div>
              <h3 className="text-sm font-medium text-white group-hover:text-yellow-400 transition-colors">Мониторинг</h3>
            </div>
            <p className="text-xs text-gray-400">
              Метрики CPU/RAM, сетевой трафик, статусы потоков, подключённые клиенты в реальном времени.
            </p>
          </AnimatedCard>
        </StaggerItem>
      </StaggerContainer>

      {/* Technical Info */}
      <AnimatedCard className="p-5" delay={0.3}>
        <h3 className="text-sm font-medium text-white mb-4">Техническая информация</h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="text-gray-400">Платформа:</div>
          <div className="text-white">React + TypeScript + Vite</div>
          <div className="text-gray-400">Стилизация:</div>
          <div className="text-white">Tailwind CSS</div>
          <div className="text-gray-400">Хранилище:</div>
          <div className="text-white">localStorage (имитация SQLite)</div>
          <div className="text-gray-400">Аутентификация:</div>
          <div className="text-white">JWT + bcrypt (mock)</div>
          <div className="text-gray-400">RTSP:</div>
          <div className="text-white">Mock-модуль (TODO: FFmpeg)</div>
          <div className="text-gray-400">ОС:</div>
          <div className="text-white">Astra Linux (изолированная сеть)</div>
          <div className="text-gray-400">Версия:</div>
          <div className="text-white">1.0.0</div>
          <div className="text-gray-400">Обозначение:</div>
          <div className="text-gradient font-bold">115 обрОсН</div>
        </div>
      </AnimatedCard>

      {/* Footer */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="text-center py-6 border-t border-gray-800/50"
      >
        <motion.p 
          animate={{ 
            scale: [1, 1.05, 1],
          }}
          transition={{ duration: 3, repeat: Infinity }}
          className="text-4xl font-black text-gradient mb-3"
        >
          115 обрОсН
        </motion.p>
        <p className="text-xs text-gray-500">
          Панель управления RTSP-сервером видеотрансляции
        </p>
        <p className="text-xs text-gray-600 mt-2">
          © 2024 • Изолированная локальная сеть • Все права защищены
        </p>
      </motion.div>
    </div>
  );
}
