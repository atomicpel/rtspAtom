import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, Edit2, Trash2, Power, Eye, AlertCircle, X, Check, Video, Radio
} from 'lucide-react';
import { Stream } from '../lib/types';
import { getStreams, saveStreams, generateId } from '../lib/storage';
import { logger } from '../lib/logger';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { AnimatedCard, StaggerContainer, StaggerItem } from '../components/AnimatedCard';

export function StreamsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
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
      toast('success', `Поток "${form.name}" обновлён`);
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
      toast('success', `Поток "${form.name}" добавлен`);
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
    toast('info', `Поток "${stream.name}" удалён`);
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
    toast(stream.isActive ? 'warning' : 'success', `Поток "${stream.name}" ${stream.isActive ? 'отключён' : 'включён'}`);
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
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Video className="w-5 h-5 text-blue-400" />
            RTSP-потоки
          </h2>
          <p className="text-sm text-gray-500">Управление источниками видеотрансляции</p>
        </div>
        {canEdit && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-medium rounded-xl transition-all shadow-lg shadow-blue-500/20"
          >
            <motion.div whileHover={{ rotate: 90 }} transition={{ duration: 0.3 }}>
              <Plus className="w-4 h-4" />
            </motion.div>
            Добавить поток
          </motion.button>
        )}
      </motion.div>

      {/* Stream Cards */}
      <StaggerContainer className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {streams.map((stream, index) => (
          <StaggerItem key={stream.id}>
            <AnimatedCard className="p-5 group relative overflow-hidden">
              {/* Animated status indicator */}
              <motion.div
                className={`absolute top-0 left-0 right-0 h-0.5 ${
                  stream.status === 'online' ? 'bg-gradient-to-r from-green-500 to-emerald-400' :
                  stream.status === 'reconnecting' ? 'bg-gradient-to-r from-yellow-500 to-orange-400' :
                  'bg-gradient-to-r from-red-500 to-pink-400'
                }`}
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              />

              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <motion.div
                    animate={{ 
                      scale: stream.status === 'online' ? [1, 1.3, 1] : 1,
                    }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className={`w-3.5 h-3.5 rounded-full ${
                      stream.status === 'online' ? 'bg-green-500 shadow-lg shadow-green-500/50' :
                      stream.status === 'reconnecting' ? 'bg-yellow-500 shadow-lg shadow-yellow-500/50' :
                      'bg-red-500 shadow-lg shadow-red-500/50'
                    }`}
                  />
                  <div>
                    <h3 className="text-sm font-medium text-white group-hover:text-blue-400 transition-colors">{stream.name}</h3>
                    <p className="text-xs text-gray-500 font-mono">{stream.url}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {canEdit && (
                    <>
                      <motion.button
                        whileHover={{ scale: 1.2 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleToggle(stream)}
                        className={`p-1.5 rounded-lg transition-all ${
                          stream.isActive ? 'text-green-400 hover:bg-green-950/30' : 'text-gray-500 hover:bg-gray-800'
                        }`}
                        title={stream.isActive ? 'Отключить' : 'Включить'}
                      >
                        <Power className="w-4 h-4" />
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.2 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => startEdit(stream)}
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-800 transition-all"
                        title="Редактировать"
                      >
                        <Edit2 className="w-4 h-4" />
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.2, rotate: 10 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleDelete(stream)}
                        className="p-1.5 rounded-lg text-red-400 hover:bg-red-950/30 transition-all"
                        title="Удалить"
                      >
                        <Trash2 className="w-4 h-4" />
                      </motion.button>
                    </>
                  )}
                  <motion.button
                    whileHover={{ scale: 1.2 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setPreviewStream(stream)}
                    className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-950/30 transition-all"
                    title="Предпросмотр"
                  >
                    <Eye className="w-4 h-4" />
                  </motion.button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <motion.div 
                  whileHover={{ scale: 1.02 }}
                  className="bg-gray-800/50 rounded-lg p-2.5 border border-gray-700/30"
                >
                  <span className="text-gray-500">Приоритет:</span>
                  <span className="ml-1 text-white font-medium">{stream.priority}</span>
                </motion.div>
                <motion.div 
                  whileHover={{ scale: 1.02 }}
                  className="bg-gray-800/50 rounded-lg p-2.5 border border-gray-700/30"
                >
                  <span className="text-gray-500">Статус:</span>
                  <span className={`ml-1 font-medium ${
                    stream.status === 'online' ? 'text-green-400' :
                    stream.status === 'reconnecting' ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>
                    {stream.status === 'online' ? 'Онлайн' : stream.status === 'reconnecting' ? 'Переподкл.' : 'Офлайн'}
                  </span>
                </motion.div>
              </div>
            </AnimatedCard>
          </StaggerItem>
        ))}
      </StaggerContainer>

      {streams.length === 0 && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-16 text-gray-500"
        >
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <Video className="w-16 h-16 mx-auto mb-4 opacity-30" />
          </motion.div>
          <p className="text-lg">Нет настроенных потоков</p>
          {canEdit && <p className="text-sm mt-2 text-gray-600">Нажмите «Добавить поток» для начала работы</p>}
        </motion.div>
      )}

      {/* Add/Edit Form Modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="glass-strong rounded-2xl w-full max-w-md p-6 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 pointer-events-none" />
              <div className="flex items-center justify-between mb-5 relative">
                <h3 className="text-lg font-semibold text-white">
                  {editingStream ? 'Редактировать поток' : 'Новый поток'}
                </h3>
                <motion.button 
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={resetForm} 
                  className="p-1.5 rounded-xl hover:bg-gray-800 text-gray-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              <div className="space-y-4 relative">
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Название</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({...form, name: e.target.value})}
                    className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="Камера КПП"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">RTSP URL</label>
                  <input
                    type="text"
                    value={form.url}
                    onChange={e => setForm({...form, url: e.target.value})}
                    className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="rtsp://192.168.1.100:554/stream1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-gray-300 mb-1.5">Логин источника</label>
                    <input
                      type="text"
                      value={form.sourceLogin}
                      onChange={e => setForm({...form, sourceLogin: e.target.value})}
                      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1.5">Пароль источника</label>
                    <input
                      type="password"
                      value={form.sourcePassword}
                      onChange={e => setForm({...form, sourcePassword: e.target.value})}
                      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Приоритет</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={form.priority}
                    onChange={e => setForm({...form, priority: parseInt(e.target.value) || 1})}
                    className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6 relative">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={resetForm}
                  className="flex-1 py-2.5 px-4 bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 text-sm rounded-xl transition-all border border-gray-700/50"
                >
                  Отмена
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSave}
                  className="flex-1 py-2.5 px-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                >
                  <Check className="w-4 h-4" />
                  {editingStream ? 'Сохранить' : 'Добавить'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preview Modal */}
      <AnimatePresence>
        {previewStream && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="glass-strong rounded-2xl w-full max-w-2xl p-6 relative overflow-hidden"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Radio className="w-5 h-5 text-blue-400" />
                  {previewStream.name}
                </h3>
                <motion.button 
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setPreviewStream(null)} 
                  className="p-1.5 rounded-xl hover:bg-gray-800 text-gray-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              {/* Video placeholder */}
              <div className="aspect-video bg-black rounded-xl border border-gray-700/50 flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 to-purple-900/20" />
                <motion.div
                  animate={{ opacity: [0.3, 0.6, 0.3] }}
                  transition={{ duration: 3, repeat: Infinity }}
                  className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.1)_0%,transparent_70%)]"
                />
                <div className="text-center z-10">
                  <motion.div
                    animate={{ y: [0, -5, 0] }}
                    transition={{ duration: 3, repeat: Infinity }}
                  >
                    <Video className="w-20 h-20 mx-auto text-gray-600 mb-3" />
                  </motion.div>
                  <p className="text-gray-400 text-sm">Предпросмотр потока</p>
                  <p className="text-gray-600 text-xs mt-1 font-mono">{previewStream.url}</p>
                </div>
                {previewStream.status === 'online' && (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 px-2.5 py-1 rounded-lg backdrop-blur-sm border border-red-500/30"
                  >
                    <motion.div 
                      animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className="w-2 h-2 rounded-full bg-red-500" 
                    />
                    <span className="text-xs text-white font-medium">LIVE</span>
                  </motion.div>
                )}
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs text-yellow-500 bg-yellow-950/20 p-2.5 rounded-lg border border-yellow-700/30">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>WebRTC/HLS подключается в продакшен-версии. Здесь показана заглушка.</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
