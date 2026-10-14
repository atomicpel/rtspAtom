import React from 'react';
import { Monitor, Shield, Server, Network, Lock, Database } from 'lucide-react';

export function AboutPage() {
  return (
    <div className="space-y-8 max-w-3xl">
      {/* Hero */}
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-blue-600/20 border border-blue-600/30 mb-6">
          <Monitor className="w-10 h-10 text-blue-500" />
        </div>
        <h1 className="text-4xl font-bold text-white mb-2">RTSP Сервер</h1>
        <p className="text-2xl font-bold text-blue-400 mb-4">115 обрОсН</p>
        <p className="text-gray-400 max-w-lg mx-auto">
          Панель управления сервером RTSP-видеотрансляции для развёртывания 
          в изолированной локальной сети
        </p>
      </div>

      {/* Main Label */}
      <div className="bg-gradient-to-r from-blue-950/50 to-purple-950/50 border border-blue-800/30 rounded-2xl p-8 text-center">
        <p className="text-5xl font-black text-blue-400 tracking-wider">
          115 обрОсН
        </p>
        <p className="text-sm text-gray-400 mt-3">
          Система видеонаблюдения и ретрансляции
        </p>
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-blue-950/50 text-blue-400">
              <Server className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-medium text-white">RTSP-ретрансляция</h3>
          </div>
          <p className="text-xs text-gray-400">
            Приём и ретрансляция RTSP-потоков с IP-камер. Поддержка HLS/WebRTC для клиентов.
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-green-950/50 text-green-400">
              <Shield className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-medium text-white">Безопасность</h3>
          </div>
          <p className="text-xs text-gray-400">
            JWT-аутентификация, RBAC, IP-фильтрация, rate limiting, аудит действий.
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-purple-950/50 text-purple-400">
              <Network className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-medium text-white">Изолированная сеть</h3>
          </div>
          <p className="text-xs text-gray-400">
            Полностью автономная работа без доступа в Интернет. Astra Linux совместимость.
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-orange-950/50 text-orange-400">
              <Lock className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-medium text-white">Ролевой доступ</h3>
          </div>
          <p className="text-xs text-gray-400">
            Три роли: администратор, оператор, наблюдатель. Гибкое управление правами.
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-cyan-950/50 text-cyan-400">
              <Database className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-medium text-white">Локальное хранение</h3>
          </div>
          <p className="text-xs text-gray-400">
            SQLite база данных, локальные журналы, экспорт в CSV. Без облачных сервисов.
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-yellow-950/50 text-yellow-400">
              <Monitor className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-medium text-white">Мониторинг</h3>
          </div>
          <p className="text-xs text-gray-400">
            Метрики CPU/RAM, сетевой трафик, статусы потоков, подключённые клиенты в реальном времени.
          </p>
        </div>
      </div>

      {/* Technical Info */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
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
          <div className="text-blue-400 font-bold">115 обрОсН</div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-4 border-t border-gray-800">
        <p className="text-3xl font-black text-blue-400 mb-2">115 обрОсН</p>
        <p className="text-xs text-gray-500">
          Панель управления RTSP-сервером видеотрансляции
        </p>
        <p className="text-xs text-gray-600 mt-1">
          © 2024 • Изолированная локальная сеть • Все права защищены
        </p>
      </div>
    </div>
  );
}
