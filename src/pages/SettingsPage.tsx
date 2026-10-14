import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Save, Shield, Clock, Wifi, FileText, AlertTriangle, Check } from 'lucide-react';
import { getSettings, saveSettings } from '../lib/storage';
import { Settings as SettingsType } from '../lib/types';
import { logger } from '../lib/logger';
import { useToast } from '../components/Toast';
import { AnimatedCard, StaggerContainer, StaggerItem } from '../components/AnimatedCard';

export function SettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SettingsType>(getSettings());
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    saveSettings(settings);
    logger.admin('Настройки обновлены');
    setSaved(true);
    toast('success', 'Настройки сохранены');
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-400" />
          Настройки системы
        </h2>
        <p className="text-sm text-gray-500">Конфигурация сервера RTSP-трансляции</p>
      </motion.div>

      <StaggerContainer className="space-y-4">
        {/* TLS */}
        <StaggerItem>
          <AnimatedCard className="p-5 group">
            <div className="flex items-center gap-3 mb-4">
              <motion.div 
                whileHover={{ scale: 1.2, rotate: 10 }}
                className="p-2.5 rounded-xl bg-green-950/50 text-green-400"
              >
                <Shield className="w-5 h-5" />
              </motion.div>
              <div>
                <h3 className="text-sm font-medium text-white group-hover:text-green-400 transition-colors">TLS/SSL</h3>
                <p className="text-xs text-gray-500">Шифрование соединений</p>
              </div>
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={settings.tlsEnabled}
                  onChange={e => setSettings({...settings, tlsEnabled: e.target.checked})}
                  className="sr-only peer"
                />
                <div className="w-12 h-6 bg-gray-700 rounded-full peer-checked:bg-gradient-to-r peer-checked:from-blue-600 peer-checked:to-purple-600 transition-all" />
                <motion.div 
                  animate={{ x: settings.tlsEnabled ? 24 : 2 }}
                  className="absolute left-0 top-1 w-4 h-4 bg-white rounded-full shadow-lg"
                />
              </div>
              <span className="text-sm text-gray-300">
                {settings.tlsEnabled ? 'Включено' : 'Отключено'}
              </span>
            </label>
            {!settings.tlsEnabled && (
              <motion.p 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="text-xs text-yellow-500 mt-3 flex items-center gap-1 bg-yellow-950/20 p-2 rounded-lg border border-yellow-700/30"
              >
                <AlertTriangle className="w-3 h-3" />
                Рекомендуется включить TLS для продакшена
              </motion.p>
            )}
          </AnimatedCard>
        </StaggerItem>

        {/* Session TTL */}
        <StaggerItem>
          <AnimatedCard className="p-5 group">
            <div className="flex items-center gap-3 mb-4">
              <motion.div 
                whileHover={{ scale: 1.2, rotate: 10 }}
                className="p-2.5 rounded-xl bg-blue-950/50 text-blue-400"
              >
                <Clock className="w-5 h-5" />
              </motion.div>
              <div>
                <h3 className="text-sm font-medium text-white group-hover:text-blue-400 transition-colors">Время жизни сессии</h3>
                <p className="text-xs text-gray-500">Автоматический выход при неактивности</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={900}
                max={86400}
                step={900}
                value={settings.sessionTtl}
                onChange={e => setSettings({...settings, sessionTtl: parseInt(e.target.value)})}
                className="flex-1"
              />
              <motion.span 
                key={settings.sessionTtl}
                initial={{ scale: 1.2 }}
                animate={{ scale: 1 }}
                className="text-sm text-white font-mono w-20 text-right bg-gray-800/50 px-3 py-1.5 rounded-lg border border-gray-700/30"
              >
                {settings.sessionTtl >= 3600 
                  ? `${Math.floor(settings.sessionTtl / 3600)} ч` 
                  : `${Math.floor(settings.sessionTtl / 60)} мин`}
              </motion.span>
            </div>
          </AnimatedCard>
        </StaggerItem>

        {/* Max Connections */}
        <StaggerItem>
          <AnimatedCard className="p-5 group">
            <div className="flex items-center gap-3 mb-4">
              <motion.div 
                whileHover={{ scale: 1.2, rotate: 10 }}
                className="p-2.5 rounded-xl bg-purple-950/50 text-purple-400"
              >
                <Wifi className="w-5 h-5" />
              </motion.div>
              <div>
                <h3 className="text-sm font-medium text-white group-hover:text-purple-400 transition-colors">Лимит подключений</h3>
                <p className="text-xs text-gray-500">Максимальное число одновременных клиентов</p>
              </div>
            </div>
            <motion.input
              whileFocus={{ scale: 1.02 }}
              type="number"
              min={1}
              max={1000}
              value={settings.maxConnections}
              onChange={e => setSettings({...settings, maxConnections: parseInt(e.target.value) || 100})}
              className="w-32 px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
          </AnimatedCard>
        </StaggerItem>

        {/* Rate Limits */}
        <StaggerItem>
          <AnimatedCard className="p-5 group">
            <div className="flex items-center gap-3 mb-4">
              <motion.div 
                whileHover={{ scale: 1.2, rotate: 10 }}
                className="p-2.5 rounded-xl bg-orange-950/50 text-orange-400"
              >
                <Shield className="w-5 h-5" />
              </motion.div>
              <div>
                <h3 className="text-sm font-medium text-white group-hover:text-orange-400 transition-colors">Rate Limiting</h3>
                <p className="text-xs text-gray-500">Ограничение частоты запросов</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Попытки входа (за 15 мин)</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.rateLimitLogin}
                  onChange={e => setSettings({...settings, rateLimitLogin: parseInt(e.target.value) || 5})}
                  className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">API запросы (в минуту)</label>
                <input
                  type="number"
                  min={10}
                  max={600}
                  value={settings.rateLimitApi}
                  onChange={e => setSettings({...settings, rateLimitApi: parseInt(e.target.value) || 60})}
                  className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>
            </div>
          </AnimatedCard>
        </StaggerItem>

        {/* Log Format */}
        <StaggerItem>
          <AnimatedCard className="p-5 group">
            <div className="flex items-center gap-3 mb-4">
              <motion.div 
                whileHover={{ scale: 1.2, rotate: 10 }}
                className="p-2.5 rounded-xl bg-cyan-950/50 text-cyan-400"
              >
                <FileText className="w-5 h-5" />
              </motion.div>
              <div>
                <h3 className="text-sm font-medium text-white group-hover:text-cyan-400 transition-colors">Формат логов</h3>
                <p className="text-xs text-gray-500">Формат записи в журнал событий</p>
              </div>
            </div>
            <div className="flex gap-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setSettings({...settings, logFormat: 'json'})}
                className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all ${
                  settings.logFormat === 'json' 
                    ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-500/20' 
                    : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
                }`}
              >
                JSON
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setSettings({...settings, logFormat: 'syslog'})}
                className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all ${
                  settings.logFormat === 'syslog' 
                    ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-500/20' 
                    : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
                }`}
              >
                Syslog
              </motion.button>
            </div>
          </AnimatedCard>
        </StaggerItem>
      </StaggerContainer>

      {/* Save Button */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="flex items-center gap-4"
      >
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleSave}
          className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-medium rounded-xl transition-all shadow-lg shadow-blue-500/20"
        >
          <Save className="w-4 h-4" />
          Сохранить настройки
        </motion.button>
        {saved && (
          <motion.span 
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            className="text-sm text-green-400 flex items-center gap-1"
          >
            <Check className="w-4 h-4" />
            Сохранено
          </motion.span>
        )}
      </motion.div>
    </div>
  );
}
