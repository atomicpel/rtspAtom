import React, { useState } from 'react';
import { Save, Shield, Clock, Wifi, FileText, AlertTriangle } from 'lucide-react';
import { getSettings, saveSettings } from '../lib/storage';
import { Settings as SettingsType } from '../lib/types';
import { logger } from '../lib/logger';

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsType>(getSettings());
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    saveSettings(settings);
    logger.admin('Настройки обновлены');
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-white">Настройки системы</h2>
        <p className="text-sm text-gray-500">Конфигурация сервера RTSP-трансляции</p>
      </div>

      {/* TLS */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-green-950/50 text-green-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white">TLS/SSL</h3>
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
            <div className="w-10 h-5 bg-gray-700 rounded-full peer-checked:bg-blue-600 transition-colors" />
            <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
          </div>
          <span className="text-sm text-gray-300">
            {settings.tlsEnabled ? 'Включено' : 'Отключено'}
          </span>
        </label>
        {!settings.tlsEnabled && (
          <p className="text-xs text-yellow-500 mt-2 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Рекомендуется включить TLS для продакшена
          </p>
        )}
      </div>

      {/* Session TTL */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-blue-950/50 text-blue-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white">Время жизни сессии</h3>
            <p className="text-xs text-gray-500">Автоматический выход при неактивности</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={900}
            max={86400}
            step={900}
            value={settings.sessionTtl}
            onChange={e => setSettings({...settings, sessionTtl: parseInt(e.target.value)})}
            className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
          <span className="text-sm text-white font-mono w-20 text-right">
            {settings.sessionTtl >= 3600 
              ? `${Math.floor(settings.sessionTtl / 3600)} ч` 
              : `${Math.floor(settings.sessionTtl / 60)} мин`}
          </span>
        </div>
      </div>

      {/* Max Connections */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-purple-950/50 text-purple-400">
            <Wifi className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white">Лимит подключений</h3>
            <p className="text-xs text-gray-500">Максимальное число одновременных клиентов</p>
          </div>
        </div>
        <input
          type="number"
          min={1}
          max={1000}
          value={settings.maxConnections}
          onChange={e => setSettings({...settings, maxConnections: parseInt(e.target.value) || 100})}
          className="w-32 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Rate Limits */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-orange-950/50 text-orange-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white">Rate Limiting</h3>
            <p className="text-xs text-gray-500">Ограничение частоты запросов</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Попытки входа (за 15 мин)</label>
            <input
              type="number"
              min={1}
              max={20}
              value={settings.rateLimitLogin}
              onChange={e => setSettings({...settings, rateLimitLogin: parseInt(e.target.value) || 5})}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">API запросы (в минуту)</label>
            <input
              type="number"
              min={10}
              max={600}
              value={settings.rateLimitApi}
              onChange={e => setSettings({...settings, rateLimitApi: parseInt(e.target.value) || 60})}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Log Format */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-cyan-950/50 text-cyan-400">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white">Формат логов</h3>
            <p className="text-xs text-gray-500">Формат записи в журнал событий</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setSettings({...settings, logFormat: 'json'})}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${
              settings.logFormat === 'json' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            JSON
          </button>
          <button
            onClick={() => setSettings({...settings, logFormat: 'syslog'})}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${
              settings.logFormat === 'syslog' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Syslog
          </button>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Save className="w-4 h-4" />
          Сохранить настройки
        </button>
        {saved && (
          <span className="text-sm text-green-400 animate-pulse">✓ Сохранено</span>
        )}
      </div>
    </div>
  );
}
