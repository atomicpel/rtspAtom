import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Save, Shield, Clock, Wifi, FileText, AlertTriangle, Check, Video, Archive } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { Settings as SettingsType } from '../lib/types';
import { useAuth } from '../contexts/AuthContext';
import { hints } from '../lib/platform';
import { useToast } from '../components/Toast';
import { AnimatedCard, StaggerContainer, StaggerItem } from '../components/AnimatedCard';

export function SettingsPage() {
  const { toast } = useToast();
  const h = hints(useAuth().platform);
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings().then(setSettings).catch((err) => toast('error', errorMessage(err)));
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const { tlsEnabled: _tls, ...values } = settings;
      setSettings(await api.saveSettings(values));
      setSaved(true);
      toast('success', 'Настройки сохранены');
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <div className="text-sm text-gray-500">Загрузка настроек…</div>;
  }

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
            <p className={`text-sm ${settings.tlsEnabled ? 'text-green-400' : 'text-yellow-400'}`}>
              {settings.tlsEnabled ? 'HTTPS включён' : 'HTTPS выключен'}
            </p>
            <p className="text-xs text-gray-500 mt-2 flex items-start gap-1 bg-gray-800/30 p-2 rounded-lg border border-gray-700/30">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-yellow-500" />
              <span>
                Включается при установке (<span className="font-mono">{h.installTls}</span>) или в файле
                {' '}<span className="font-mono">{h.configFile}</span> (раздел tls) с последующим
                {' '}<span className="font-mono">{h.restart}</span>.
              </span>
            </p>
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
                <p className="text-xs text-gray-500">Автоматический выход после периода бездействия</p>
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
                <p className="text-xs text-gray-500">Максимум одновременно просматриваемых видеопотоков (по всем пользователям)</p>
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
                  min={30}
                  max={6000}
                  value={settings.rateLimitApi}
                  onChange={e => setSettings({...settings, rateLimitApi: parseInt(e.target.value) || 600})}
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
                <p className="text-xs text-gray-500">Формат вывода событий в системный журнал ({h.logs})</p>
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
        {/* Режим камер */}
        <StaggerItem>
          <AnimatedCard className="p-5 group">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-pink-950/50 text-pink-400">
                <Video className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-white">Подключение к камерам</h3>
                <p className="text-xs text-gray-500">Как сервер забирает видео с камер</p>
              </div>
            </div>
            <div className="flex gap-3">
              {[
                { v: true, t: 'Постоянно', d: 'видео открывается мгновенно, статус камер виден всегда' },
                { v: false, t: 'По запросу', d: 'камера подключается только когда кто-то смотрит — меньше трафика' },
              ].map(o => (
                <button key={String(o.v)} onClick={() => setSettings({ ...settings, camerasAlwaysOn: o.v })}
                  className={`flex-1 py-2.5 px-3 rounded-xl text-left transition-all ${
                    settings.camerasAlwaysOn === o.v
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-500/20'
                      : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
                  }`}
                >
                  <div className="text-sm font-medium">{o.t}</div>
                  <div className="text-[11px] opacity-80">{o.d}</div>
                </button>
              ))}
            </div>
          </AnimatedCard>
        </StaggerItem>

        {/* Хранение журнала */}
        <StaggerItem>
          <AnimatedCard className="p-5 group">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-emerald-950/50 text-emerald-400">
                <Archive className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-white">Хранение журнала</h3>
                <p className="text-xs text-gray-500">Записи старше указанного срока удаляются автоматически</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number" min={1} max={3650}
                value={settings.logRetentionDays}
                onChange={e => setSettings({ ...settings, logRetentionDays: parseInt(e.target.value) || 90 })}
                className="w-32 px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 transition-all"
              />
              <span className="text-sm text-gray-400">дней</span>
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
          disabled={saving}
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
