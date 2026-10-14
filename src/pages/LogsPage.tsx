import React, { useState, useMemo } from 'react';
import { ScrollText, Download, Filter, Search } from 'lucide-react';
import { getLogs } from '../lib/storage';
import { LogEntry, LogCategory, LogLevel } from '../lib/types';

const categories: LogCategory[] = ['auth', 'access', 'stream', 'error', 'admin'];
const levels: LogLevel[] = ['info', 'warning', 'error', 'debug'];

export function LogsPage() {
  const [activeTab, setActiveTab] = useState<LogCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLevel, setFilterLevel] = useState<LogLevel | ''>('');
  const [filterUser, setFilterUser] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const allLogs = getLogs();

  const filteredLogs = useMemo(() => {
    let logs = allLogs;

    if (activeTab !== 'all') {
      logs = logs.filter(l => l.category === activeTab);
    }
    if (filterLevel) {
      logs = logs.filter(l => l.level === filterLevel);
    }
    if (filterUser) {
      logs = logs.filter(l => l.user.toLowerCase().includes(filterUser.toLowerCase()));
    }
    if (searchQuery) {
      logs = logs.filter(l => l.message.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    if (dateFrom) {
      logs = logs.filter(l => l.timestamp >= dateFrom);
    }
    if (dateTo) {
      logs = logs.filter(l => l.timestamp <= dateTo + 'T23:59:59');
    }

    return logs;
  }, [allLogs, activeTab, filterLevel, filterUser, searchQuery, dateFrom, dateTo]);

  const exportCsv = () => {
    const headers = ['Дата/Время', 'Уровень', 'Категория', 'Пользователь', 'IP', 'Поток', 'Сообщение'];
    const rows = filteredLogs.map(l => [
      new Date(l.timestamp).toLocaleString('ru-RU'),
      l.level,
      l.category,
      l.user,
      l.ip,
      l.stream,
      `"${l.message.replace(/"/g, '""')}"`,
    ]);

    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getLevelColor = (level: LogLevel) => {
    switch (level) {
      case 'info': return 'text-blue-400';
      case 'warning': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      case 'debug': return 'text-gray-400';
    }
  };

  const getCategoryColor = (category: LogCategory) => {
    switch (category) {
      case 'auth': return 'bg-blue-950/50 text-blue-400';
      case 'access': return 'bg-green-950/50 text-green-400';
      case 'stream': return 'bg-purple-950/50 text-purple-400';
      case 'error': return 'bg-red-950/50 text-red-400';
      case 'admin': return 'bg-yellow-950/50 text-yellow-400';
    }
  };

  const tabs: { id: LogCategory | 'all'; label: string; count: number }[] = [
    { id: 'all', label: 'Все', count: allLogs.length },
    ...categories.map(cat => ({
      id: cat,
      label: cat === 'auth' ? 'Авторизация' : cat === 'access' ? 'Доступ' : cat === 'stream' ? 'Потоки' : cat === 'error' ? 'Ошибки' : 'Админ',
      count: allLogs.filter(l => l.category === cat).length,
    })),
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Журналы событий</h2>
          <p className="text-sm text-gray-500">auth.log, access.log, stream.log, error.log</p>
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
        >
          <Download className="w-4 h-4" />
          Экспорт CSV
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-xs opacity-60">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-400">Фильтры</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск по сообщению..."
              className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <select
            value={filterLevel}
            onChange={e => setFilterLevel(e.target.value as LogLevel | '')}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="">Все уровни</option>
            {levels.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <input
            type="text"
            value={filterUser}
            onChange={e => setFilterUser(e.target.value)}
            placeholder="Пользователь..."
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          />
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/30">
                <th className="text-left p-3 text-gray-400 font-medium w-40">Время</th>
                <th className="text-left p-3 text-gray-400 font-medium w-20">Уровень</th>
                <th className="text-left p-3 text-gray-400 font-medium w-24">Категория</th>
                <th className="text-left p-3 text-gray-400 font-medium w-24">Пользователь</th>
                <th className="text-left p-3 text-gray-400 font-medium w-28">IP</th>
                <th className="text-left p-3 text-gray-400 font-medium">Сообщение</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">
                    <ScrollText className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p>Нет записей</p>
                  </td>
                </tr>
              ) : (
                filteredLogs.slice(0, 200).map(log => (
                  <tr key={log.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                    <td className="p-3 text-gray-400 text-xs font-mono">
                      {new Date(log.timestamp).toLocaleString('ru-RU', { 
                        day: '2-digit', month: '2-digit', 
                        hour: '2-digit', minute: '2-digit', second: '2-digit' 
                      })}
                    </td>
                    <td className="p-3">
                      <span className={`text-xs font-medium ${getLevelColor(log.level)}`}>
                        {log.level}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${getCategoryColor(log.category)}`}>
                        {log.category}
                      </span>
                    </td>
                    <td className="p-3 text-gray-300 text-xs">{log.user}</td>
                    <td className="p-3 text-gray-400 text-xs font-mono">{log.ip}</td>
                    <td className="p-3 text-gray-300 text-xs">{log.message}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filteredLogs.length > 200 && (
          <div className="p-3 text-center text-xs text-gray-500 border-t border-gray-800">
            Показано 200 из {filteredLogs.length} записей. Используйте фильтры для уточнения.
          </div>
        )}
      </div>
    </div>
  );
}
