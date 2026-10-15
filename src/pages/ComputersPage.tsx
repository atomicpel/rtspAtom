import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, Edit2, Trash2, Power, X, Check, Server, Video, 
  ChevronDown, ChevronRight, Monitor, AlertCircle
} from 'lucide-react';
import { Computer, RtspStream } from '../lib/types';
import { getComputers, saveComputers, generateId } from '../lib/storage';
import { logger } from '../lib/logger';
import { useToast } from '../components/Toast';
import { AnimatedCard, StaggerContainer, StaggerItem } from '../components/AnimatedCard';

export function ComputersPage() {
  const { toast } = useToast();
  const [computers, setComputers] = useState<Computer[]>(getComputers());
  const [showComputerForm, setShowComputerForm] = useState(false);
  const [editingComputer, setEditingComputer] = useState<Computer | null>(null);
  const [expandedComputers, setExpandedComputers] = useState<Set<string>>(new Set());
  const [showStreamForm, setShowStreamForm] = useState<string | null>(null);
  const [editingStream, setEditingStream] = useState<RtspStream | null>(null);
  
  const [computerForm, setComputerForm] = useState({
    name: '', hostname: '', ip: '', description: ''
  });
  const [streamForm, setStreamForm] = useState({
    name: '', url: '', sourceLogin: '', sourcePassword: ''
  });

  const resetComputerForm = () => {
    setComputerForm({ name: '', hostname: '', ip: '', description: '' });
    setEditingComputer(null);
    setShowComputerForm(false);
  };

  const resetStreamForm = () => {
    setStreamForm({ name: '', url: '', sourceLogin: '', sourcePassword: '' });
    setEditingStream(null);
    setShowStreamForm(null);
  };

  const handleSaveComputer = () => {
    if (!computerForm.name || !computerForm.ip) return;

    let updated: Computer[];
    if (editingComputer) {
      updated = computers.map(c => c.id === editingComputer.id ? {
        ...c,
        name: computerForm.name,
        hostname: computerForm.hostname,
        ip: computerForm.ip,
        description: computerForm.description,
      } : c);
      logger.admin(`Компьютер обновлён: ${computerForm.name}`);
      toast('success', `Компьютер "${computerForm.name}" обновлён`);
    } else {
      const newComputer: Computer = {
        id: generateId(),
        ...computerForm,
        rtspStreams: [],
        isActive: true,
        status: 'online',
        createdAt: new Date().toISOString(),
      };
      updated = [...computers, newComputer];
      logger.admin(`Компьютер добавлен: ${computerForm.name}`);
      toast('success', `Компьютер "${computerForm.name}" добавлен`);
    }

    saveComputers(updated);
    setComputers(updated);
    resetComputerForm();
  };

  const handleDeleteComputer = (computer: Computer) => {
    if (!confirm(`Удалить компьютер "${computer.name}" со всеми RTSP-потоками?`)) return;
    const updated = computers.filter(c => c.id !== computer.id);
    saveComputers(updated);
    setComputers(updated);
    logger.admin(`Компьютер удалён: ${computer.name}`);
    toast('info', `Компьютер "${computer.name}" удалён`);
  };

  const handleToggleComputer = (computer: Computer) => {
    const updated = computers.map(c => c.id === computer.id ? {
      ...c,
      isActive: !c.isActive,
      status: (!c.isActive ? 'online' : 'offline') as Computer['status']
    } : c);
    saveComputers(updated);
    setComputers(updated);
    logger.admin(`Компьютер ${computer.isActive ? 'отключён' : 'включён'}: ${computer.name}`);
    toast(computer.isActive ? 'warning' : 'success', `Компьютер "${computer.name}" ${computer.isActive ? 'отключён' : 'включён'}`);
  };

  const handleSaveStream = (computerId: string) => {
    if (!streamForm.name || !streamForm.url) return;

    const updated = computers.map(c => {
      if (c.id !== computerId) return c;
      
      let rtspStreams: RtspStream[];
      if (editingStream) {
        rtspStreams = c.rtspStreams.map(s => s.id === editingStream.id ? {
          ...s,
          name: streamForm.name,
          url: streamForm.url,
          sourceLogin: streamForm.sourceLogin,
          sourcePassword: streamForm.sourcePassword,
        } : s);
      } else {
        const newStream: RtspStream = {
          id: generateId(),
          ...streamForm,
          isActive: true,
          status: 'online',
        };
        rtspStreams = [...c.rtspStreams, newStream];
      }
      
      return { ...c, rtspStreams };
    });

    saveComputers(updated);
    setComputers(updated);
    
    if (editingStream) {
      toast('success', `RTSP-поток "${streamForm.name}" обновлён`);
      logger.admin(`RTSP-поток обновлён: ${streamForm.name}`);
    } else {
      toast('success', `RTSP-поток "${streamForm.name}" добавлен`);
      logger.admin(`RTSP-поток добавлен: ${streamForm.name}`);
    }
    
    resetStreamForm();
  };

  const handleDeleteStream = (computerId: string, stream: RtspStream) => {
    if (!confirm(`Удалить RTSP-поток "${stream.name}"?`)) return;
    const updated = computers.map(c => {
      if (c.id !== computerId) return c;
      return { ...c, rtspStreams: c.rtspStreams.filter(s => s.id !== stream.id) };
    });
    saveComputers(updated);
    setComputers(updated);
    toast('info', `RTSP-поток "${stream.name}" удалён`);
    logger.admin(`RTSP-поток удалён: ${stream.name}`);
  };

  const handleToggleStream = (computerId: string, stream: RtspStream) => {
    const updated = computers.map(c => {
      if (c.id !== computerId) return c;
      return {
        ...c,
        rtspStreams: c.rtspStreams.map(s => s.id === stream.id ? {
          ...s,
          isActive: !s.isActive,
          status: (!s.isActive ? 'online' : 'offline') as RtspStream['status']
        } : s)
      };
    });
    saveComputers(updated);
    setComputers(updated);
  };

  const toggleExpand = (computerId: string) => {
    const newExpanded = new Set(expandedComputers);
    if (newExpanded.has(computerId)) {
      newExpanded.delete(computerId);
    } else {
      newExpanded.add(computerId);
    }
    setExpandedComputers(newExpanded);
  };

  const startEditStream = (computerId: string, stream: RtspStream) => {
    setStreamForm({
      name: stream.name,
      url: stream.url,
      sourceLogin: stream.sourceLogin,
      sourcePassword: stream.sourcePassword,
    });
    setEditingStream(stream);
    setShowStreamForm(computerId);
  };

  const totalStreams = computers.reduce((sum, c) => sum + c.rtspStreams.length, 0);
  const activeStreams = computers.reduce((sum, c) => sum + c.rtspStreams.filter(s => s.isActive).length, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between flex-wrap gap-4"
      >
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-400" />
            Компьютеры
          </h2>
          <p className="text-sm text-gray-500">
            Удалённые компьютеры с RTSP-потоками • {computers.length} компьютеров • {activeStreams}/{totalStreams} потоков активно
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowComputerForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-medium rounded-xl transition-all shadow-lg shadow-blue-500/20"
        >
          <Plus className="w-4 h-4" />
          Добавить компьютер
        </motion.button>
      </motion.div>

      {/* Computers List */}
      <StaggerContainer className="space-y-3">
        {computers.map(computer => {
          const isExpanded = expandedComputers.has(computer.id);
          
          return (
            <StaggerItem key={computer.id}>
              <AnimatedCard className="overflow-hidden">
                {/* Computer Header */}
                <div className="p-4 flex items-center gap-3">
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => toggleExpand(computer.id)}
                    className="p-1 rounded-lg hover:bg-gray-800 text-gray-400"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5" />
                    ) : (
                      <ChevronRight className="w-5 h-5" />
                    )}
                  </motion.button>

                  <div className={`w-3 h-3 rounded-full ${
                    computer.status === 'online' ? 'bg-green-500 shadow-lg shadow-green-500/50' :
                    computer.status === 'reconnecting' ? 'bg-yellow-500 shadow-lg shadow-yellow-500/50' :
                    'bg-red-500 shadow-lg shadow-red-500/50'
                  }`} />

                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-white">{computer.name}</h3>
                    <p className="text-xs text-gray-500 font-mono">
                      {computer.hostname} • {computer.ip} • {computer.rtspStreams.length} RTSP-потоков
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <motion.button
                      whileHover={{ scale: 1.2 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handleToggleComputer(computer)}
                      className={`p-1.5 rounded-lg transition-all ${
                        computer.isActive ? 'text-green-400 hover:bg-green-950/30' : 'text-gray-500 hover:bg-gray-800'
                      }`}
                      title={computer.isActive ? 'Отключить' : 'Включить'}
                    >
                      <Power className="w-4 h-4" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.2 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => {
                        setComputerForm({
                          name: computer.name,
                          hostname: computer.hostname,
                          ip: computer.ip,
                          description: computer.description,
                        });
                        setEditingComputer(computer);
                        setShowComputerForm(true);
                      }}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-800 transition-all"
                      title="Редактировать"
                    >
                      <Edit2 className="w-4 h-4" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.2, rotate: 10 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handleDeleteComputer(computer)}
                      className="p-1.5 rounded-lg text-red-400 hover:bg-red-950/30 transition-all"
                      title="Удалить"
                    >
                      <Trash2 className="w-4 h-4" />
                    </motion.button>
                  </div>
                </div>

                {/* Streams List */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="border-t border-gray-800/50 overflow-hidden"
                    >
                      <div className="p-4 space-y-2">
                        {computer.description && (
                          <p className="text-xs text-gray-500 mb-3">{computer.description}</p>
                        )}

                        {computer.rtspStreams.map(stream => (
                          <motion.div
                            key={stream.id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-center gap-3 p-2.5 bg-gray-800/30 rounded-lg border border-gray-700/30 group hover:border-blue-500/30 transition-all"
                          >
                            <div className={`w-2 h-2 rounded-full ${
                              stream.status === 'online' ? 'bg-green-500' :
                              stream.status === 'reconnecting' ? 'bg-yellow-500' :
                              'bg-red-500'
                            }`} />
                            <Video className="w-4 h-4 text-gray-500" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-white">{stream.name}</p>
                              <p className="text-[10px] text-gray-500 font-mono truncate">{stream.url}</p>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <motion.button
                                whileHover={{ scale: 1.2 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleToggleStream(computer.id, stream)}
                                className={`p-1 rounded ${stream.isActive ? 'text-green-400' : 'text-gray-500'}`}
                              >
                                <Power className="w-3 h-3" />
                              </motion.button>
                              <motion.button
                                whileHover={{ scale: 1.2 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => startEditStream(computer.id, stream)}
                                className="p-1 rounded text-gray-400 hover:bg-gray-700"
                              >
                                <Edit2 className="w-3 h-3" />
                              </motion.button>
                              <motion.button
                                whileHover={{ scale: 1.2 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleDeleteStream(computer.id, stream)}
                                className="p-1 rounded text-red-400 hover:bg-red-950/30"
                              >
                                <Trash2 className="w-3 h-3" />
                              </motion.button>
                            </div>
                          </motion.div>
                        ))}

                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => {
                            setStreamForm({ name: '', url: '', sourceLogin: '', sourcePassword: '' });
                            setEditingStream(null);
                            setShowStreamForm(computer.id);
                          }}
                          className="w-full py-2 px-3 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 text-xs font-medium rounded-lg transition-all border border-blue-500/20 flex items-center justify-center gap-2"
                        >
                          <Plus className="w-3 h-3" />
                          Добавить RTSP-поток
                        </motion.button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </AnimatedCard>
            </StaggerItem>
          );
        })}
      </StaggerContainer>

      {computers.length === 0 && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-16 text-gray-500"
        >
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <Server className="w-16 h-16 mx-auto mb-4 opacity-30" />
          </motion.div>
          <p className="text-lg">Нет настроенных компьютеров</p>
          <p className="text-sm mt-2 text-gray-600">Нажмите «Добавить компьютер» для начала работы</p>
        </motion.div>
      )}

      {/* Add/Edit Computer Modal */}
      <AnimatePresence>
        {showComputerForm && (
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
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Monitor className="w-5 h-5 text-blue-400" />
                  {editingComputer ? 'Редактировать компьютер' : 'Новый компьютер'}
                </h3>
                <motion.button 
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={resetComputerForm} 
                  className="p-1.5 rounded-xl hover:bg-gray-800 text-gray-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              <div className="space-y-4 relative">
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Название компьютера</label>
                  <input
                    type="text"
                    value={computerForm.name}
                    onChange={e => setComputerForm({...computerForm, name: e.target.value})}
                    className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="КПП-1 (Центральный пост)"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-gray-300 mb-1.5">Hostname</label>
                    <input
                      type="text"
                      value={computerForm.hostname}
                      onChange={e => setComputerForm({...computerForm, hostname: e.target.value})}
                      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                      placeholder="kpp1-server"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1.5">IP-адрес</label>
                    <input
                      type="text"
                      value={computerForm.ip}
                      onChange={e => setComputerForm({...computerForm, ip: e.target.value})}
                      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                      placeholder="192.168.1.10"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Описание</label>
                  <textarea
                    value={computerForm.description}
                    onChange={e => setComputerForm({...computerForm, description: e.target.value})}
                    rows={2}
                    className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all resize-none"
                    placeholder="Описание компьютера..."
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6 relative">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={resetComputerForm}
                  className="flex-1 py-2.5 px-4 bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 text-sm rounded-xl transition-all border border-gray-700/50"
                >
                  Отмена
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSaveComputer}
                  className="flex-1 py-2.5 px-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                >
                  <Check className="w-4 h-4" />
                  {editingComputer ? 'Сохранить' : 'Добавить'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add/Edit Stream Modal */}
      <AnimatePresence>
        {showStreamForm && (
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
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 pointer-events-none" />
              <div className="flex items-center justify-between mb-5 relative">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Video className="w-5 h-5 text-purple-400" />
                  {editingStream ? 'Редактировать RTSP-поток' : 'Новый RTSP-поток'}
                </h3>
                <motion.button 
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={resetStreamForm} 
                  className="p-1.5 rounded-xl hover:bg-gray-800 text-gray-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              <div className="space-y-4 relative">
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Название потока</label>
                  <input
                    type="text"
                    value={streamForm.name}
                    onChange={e => setStreamForm({...streamForm, name: e.target.value})}
                    className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="Камера въезда"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">RTSP URL</label>
                  <input
                    type="text"
                    value={streamForm.url}
                    onChange={e => setStreamForm({...streamForm, url: e.target.value})}
                    className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="rtsp://192.168.1.100:554/stream1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-gray-300 mb-1.5">Логин</label>
                    <input
                      type="text"
                      value={streamForm.sourceLogin}
                      onChange={e => setStreamForm({...streamForm, sourceLogin: e.target.value})}
                      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1.5">Пароль</label>
                    <input
                      type="password"
                      value={streamForm.sourcePassword}
                      onChange={e => setStreamForm({...streamForm, sourcePassword: e.target.value})}
                      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6 relative">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={resetStreamForm}
                  className="flex-1 py-2.5 px-4 bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 text-sm rounded-xl transition-all border border-gray-700/50"
                >
                  Отмена
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSaveStream(showStreamForm)}
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
    </div>
  );
}
