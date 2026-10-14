import React, { useState, useEffect } from 'react';
import { 
  Plus, Edit2, Trash2, Power, Eye, AlertCircle, X, Check, Video
} from 'lucide-react';
import { Stream } from '../lib/types';
import { getStreams, saveStreams, generateId } from '../lib/storage';
import { logger } from '../lib/logger';
import { useAuth } from '../contexts/AuthContext';

export function StreamsPage() {
  const { user } = useAuth();
  const [streams, setStreams] = useState<Stream[]>(getStreams());
  const [showForm, setShowForm] = useState(false);
  const [editingStream, setEditingStream] = useState<Stream | null>(null);
  const [previewStream, setPreviewStream] = useState<Stream | null>(null);
  const [form, setForm] = useState({
    name: '', url: '', sourceLogin: '', sourcePassword: '', priority: 1
  });

  const canEdit = user?.role === 'admin' || user?.role === 'operator';

  const resetForm = () => {
    setForm({ name: '', url: '', sourceLogin: '', sourcePassword: '', priority: 1 });
    setEditingStream(null);
    setShowForm(false);
  };

  const handleSave = () => {
    if (!form.name || !form.url) return;

    let updated: Stream[];
    if (editingStream) {
      updated = streams.map(s => s.id === editingStream.id ? {
        ...s, ...form, status: s.status
      } : s);
      logger.stream(`Поток обновлён: ${form.name}`, form.name);
    } else {
      const newStream: Stream = {
        id: generateId(),
        ...form,
        isActive: true,
        status: 'online' as const,
        createdAt: new Date().toISOString(),
      };
      updated = [...streams, newStream];
      logger.stream(`Поток добавлен: ${form.name}`, form.name);
    }

    saveStreams(updated);
    setStreams(updated);
    resetForm();
  };

  const handleDelete = (stream: Stream) => {
    if (!confirm(`Удалить поток "${stream.name}"?`)) return;
    const updated = streams.filter(s => s.id !== stream.id);
    saveStreams(updated);
    setStreams(updated);
    logger.stream(`Поток удалён: ${stream.name}`, stream.name);
  };

  const handleToggle = (stream: Stream) => {
    const updated: Stream[] = streams.map(s => s.id === stream.id ? {
      ...s, 
      isActive: !s.isActive,
      status: (!s.isActive ? 'online' : 'offline') as Stream['status']
    } : s);
    saveStreams(updated);
    setStreams(updated);
    logger.stream(`Поток ${stream.isActive ? 'отключён' : 'включён'}: ${stream.name}`, stream.name);
  };

  const startEdit = (stream: Stream) => {
    setForm({
      name: stream.name,
      url: stream.url,
      sourceLogin: stream.sourceLogin,
      sourcePassword: stream.sourcePassword,
      priority: stream.priority,
    });
    setEditingStream(stream);
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">RTSP-потоки</h2>
          <p className="text-sm text-gray-500">Управление источниками видеотрансляции</p>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Добавить поток
          </button>
        )}
      </div>

      {/* Stream Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {streams.map(stream => (
          <div key={stream.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${
                  stream.status === 'online' ? 'bg-green-500' :
                  stream.status === 'reconnecting' ? 'bg-yellow-500 animate-pulse' :
                  'bg-red-500'
                }`} />
                <div>
                  <h3 className="text-sm font-medium text-white">{stream.name}</h3>
                  <p className="text-xs text-gray-500 font-mono">{stream.url}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {canEdit && (
                  <>
                    <button
                      onClick={() => handleToggle(stream)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        stream.isActive ? 'text-green-400 hover:bg-green-950/30' : 'text-gray-500 hover:bg-gray-800'
                      }`}
                      title={stream.isActive ? 'Отключить' : 'Включить'}
                    >
                      <Power className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => startEdit(stream)}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-800 transition-colors"
                      title="Редактировать"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(stream)}
                      className="p-1.5 rounded-lg text-red-400 hover:bg-red-950/30 transition-colors"
                      title="Удалить"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => setPreviewStream(stream)}
                  className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-950/30 transition-colors"
                  title="Предпросмотр"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-800/50 rounded p-2">
                <span className="text-gray-500">Приоритет:</span>
                <span className="ml-1 text-white">{stream.priority}</span>
              </div>
              <div className="bg-gray-800/50 rounded p-2">
                <span className="text-gray-500">Статус:</span>
                <span className={`ml-1 ${
                  stream.status === 'online' ? 'text-green-400' :
                  stream.status === 'reconnecting' ? 'text-yellow-400' :
                  'text-red-400'
                }`}>
                  {stream.status === 'online' ? 'Онлайн' : stream.status === 'reconnecting' ? 'Переподкл.' : 'Офлайн'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {streams.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Video className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Нет настроенных потоков</p>
          {canEdit && <p className="text-sm mt-1">Нажмите «Добавить поток» для начала работы</p>}
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">
                {editingStream ? 'Редактировать поток' : 'Новый поток'}
              </h3>
              <button onClick={resetForm} className="p-1 rounded hover:bg-gray-800 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Название</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Камера КПП"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">RTSP URL</label>
                <input
                  type="text"
                  value={form.url}
                  onChange={e => setForm({...form, url: e.target.value})}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                  placeholder="rtsp://192.168.1.100:554/stream1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Логин источника</label>
                  <input
                    type="text"
                    value={form.sourceLogin}
                    onChange={e => setForm({...form, sourceLogin: e.target.value})}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Пароль источника</label>
                  <input
                    type="password"
                    value={form.sourcePassword}
                    onChange={e => setForm({...form, sourcePassword: e.target.value})}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Приоритет</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={form.priority}
                  onChange={e => setForm({...form, priority: parseInt(e.target.value) || 1})}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={resetForm}
                className="flex-1 py-2 px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleSave}
                className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                {editingStream ? 'Сохранить' : 'Добавить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewStream && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">{previewStream.name}</h3>
              <button onClick={() => setPreviewStream(null)} className="p-1 rounded hover:bg-gray-800 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Video placeholder */}
            <div className="aspect-video bg-black rounded-lg border border-gray-700 flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-gray-800 opacity-50" />
              <div className="text-center z-10">
                <Video className="w-16 h-16 mx-auto text-gray-600 mb-3" />
                <p className="text-gray-400 text-sm">Предпросмотр потока</p>
                <p className="text-gray-600 text-xs mt-1 font-mono">{previewStream.url}</p>
              </div>
              {previewStream.status === 'online' && (
                <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 px-2 py-1 rounded">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs text-white">LIVE</span>
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2 text-xs text-yellow-500">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>WebRTC/HLS подключается в продакшен-версии. Здесь показана заглушка.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
