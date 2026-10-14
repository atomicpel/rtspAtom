import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, Edit2, Trash2, Power, X, Check, Server, Video, 
  ChevronDown, ChevronRight, Monitor, AlertCircle
} from 'lucide-react';
import { System, Camera } from '../lib/types';
import { getSystems, saveSystems, generateId } from '../lib/storage';
import { logger } from '../lib/logger';
import { useToast } from '../components/Toast';
import { AnimatedCard, StaggerContainer, StaggerItem } from '../components/AnimatedCard';

export function SystemsPage() {
  const { toast } = useToast();
  const [systems, setSystems] = useState<System[]>(getSystems());
  const [showSystemForm, setShowSystemForm] = useState(false);
  const [editingSystem, setEditingSystem] = useState<System | null>(null);
  const [expandedSystems, setExpandedSystems] = useState<Set<string>>(new Set());
  const [showCameraForm, setShowCameraForm] = useState<string | null>(null); // systemId
  const [editingCamera, setEditingCamera] = useState<Camera | null>(null);
  
  const [systemForm, setSystemForm] = useState({
    name: '', hostname: '', ip: '', description: ''
  });
  const [cameraForm, setCameraForm] = useState({
    name: '', url: '', sourceLogin: '', sourcePassword: ''
  });

  const resetSystemForm = () => {
    setSystemForm({ name: '', hostname: '', ip: '', description: '' });
    setEditingSystem(null);
    setShowSystemForm(false);
  };

  const resetCameraForm = () => {
    setCameraForm({ name: '', url: '', sourceLogin: '', sourcePassword: '' });
    setEditingCamera(null);
    setShowCameraForm(null);
  };

  const handleSaveSystem = () => {
    if (!systemForm.name || !systemForm.ip) return;

    let updated: System[];
    if (editingSystem) {
      updated = systems.map(s => s.id === editingSystem.id ? {
        ...s,
        name: systemForm.name,
        hostname: systemForm.hostname,
        ip: systemForm.ip,
        description: systemForm.description,
      } : s);
      logger.admin(`Система обновлена: ${systemForm.name}`);
      toast('success', `Система "${systemForm.name}" обновлена`);
    } else {
      const newSystem: System = {
        id: generateId(),
        ...systemForm,
        cameras: [],
        isActive: true,
        status: 'online',
        createdAt: new Date().toISOString(),
      };
      updated = [...systems, newSystem];
      logger.admin(`Система добавлена: ${systemForm.name}`);
      toast('success', `Система "${systemForm.name}" добавлена`);
    }

    saveSystems(updated);
    setSystems(updated);
    resetSystemForm();
  };

  const handleDeleteSystem = (system: System) => {
    if (!confirm(`Удалить систему "${system.name}" со всеми камерами?`)) return;
    const updated = systems.filter(s => s.id !== system.id);
    saveSystems(updated);
    setSystems(updated);
    logger.admin(`Система удалена: ${system.name}`);
    toast('info', `Система "${system.name}" удалена`);
  };

  const handleToggleSystem = (system: System) => {
    const updated = systems.map(s => s.id === system.id ? {
      ...s,
      isActive: !s.isActive,
      status: (!s.isActive ? 'online' : 'offline') as System['status']
    } : s);
    saveSystems(updated);
    setSystems(updated);
    logger.admin(`Система ${system.isActive ? 'отключена' : 'включена'}: ${system.name}`);
    toast(system.isActive ? 'warning' : 'success', `Система "${system.name}" ${system.isActive ? 'отключена' : 'включена'}`);
  };

  const handleSaveCamera = (systemId: string) => {
    if (!cameraForm.name || !cameraForm.url) return;

    const updated = systems.map(s => {
      if (s.id !== systemId) return s;
      
      let cameras: Camera[];
      if (editingCamera) {
        cameras = s.cameras.map(c => c.id === editingCamera.id ? {
          ...c,
          name: cameraForm.name,
          url: cameraForm.url,
          sourceLogin: cameraForm.sourceLogin,
          sourcePassword: cameraForm.sourcePassword,
        } : c);
      } else {
        const newCamera: Camera = {
          id: generateId(),
          ...cameraForm,
          isActive: true,
          status: 'online',
        };
        cameras = [...s.cameras, newCamera];
      }
      
      return { ...s, cameras };
    });

    saveSystems(updated);
    setSystems(updated);
    
    if (editingCamera) {
      toast('success', `Камера "${cameraForm.name}" обновлена`);
      logger.admin(`Камера обновлена: ${cameraForm.name}`);
    } else {
      toast('success', `Камера "${cameraForm.name}" добавлена`);
      logger.admin(`Камера добавлена: ${cameraForm.name}`);
    }
    
    resetCameraForm();
  };

  const handleDeleteCamera = (systemId: string, camera: Camera) => {
    if (!confirm(`Удалить камеру "${camera.name}"?`)) return;
    const updated = systems.map(s => {
      if (s.id !== systemId) return s;
      return { ...s, cameras: s.cameras.filter(c => c.id !== camera.id) };
    });
    saveSystems(updated);
    setSystems(updated);
    toast('info', `Камера "${camera.name}" удалена`);
    logger.admin(`Камера удалена: ${camera.name}`);
  };

  const handleToggleCamera = (systemId: string, camera: Camera) => {
    const updated = systems.map(s => {
      if (s.id !== systemId) return s;
      return {
        ...s,
        cameras: s.cameras.map(c => c.id === camera.id ? {
          ...c,
          isActive: !c.isActive,
          status: (!c.isActive ? 'online' : 'offline') as Camera['status']
        } : c)
      };
    });
    saveSystems(updated);
    setSystems(updated);
  };

  const toggleExpand = (systemId: string) => {
    const newExpanded = new Set(expandedSystems);
    if (newExpanded.has(systemId)) {
      newExpanded.delete(systemId);
    } else {
      newExpanded.add(systemId);
    }
    setExpandedSystems(newExpanded);
  };

  const startEditCamera = (systemId: string, camera: Camera) => {
    setCameraForm({
      name: camera.name,
      url: camera.url,
      sourceLogin: camera.sourceLogin,
      sourcePassword: camera.sourcePassword,
    });
    setEditingCamera(camera);
    setShowCameraForm(systemId);
  };

  const totalCameras = systems.reduce((sum, s) => sum + s.cameras.length, 0);
  const activeCameras = systems.reduce((sum, s) => sum + s.cameras.filter(c => c.isActive).length, 0);

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
            Системы
          </h2>
          <p className="text-sm text-gray-500">
            Удалённые рабочие столы с камерами • {systems.length} систем • {activeCameras}/{totalCameras} камер активно
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowSystemForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-medium rounded-xl transition-all shadow-lg shadow-blue-500/20"
        >
          <Plus className="w-4 h-4" />
          Добавить систему
        </motion.button>
      </motion.div>

      {/* Systems List */}
      <StaggerContainer className="space-y-3">
        {systems.map(system => {
          const isExpanded = expandedSystems.has(system.id);
          
          return (
            <StaggerItem key={system.id}>
              <AnimatedCard className="overflow-hidden">
                {/* System Header */}
                <div className="p-4 flex items-center gap-3">
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => toggleExpand(system.id)}
                    className="p-1 rounded-lg hover:bg-gray-800 text-gray-400"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5" />
                    ) : (
                      <ChevronRight className="w-5 h-5" />
                    )}
                  </motion.button>

                  <div className={`w-3 h-3 rounded-full ${
                    system.status === 'online' ? 'bg-green-500 shadow-lg shadow-green-500/50' :
                    system.status === 'reconnecting' ? 'bg-yellow-500 shadow-lg shadow-yellow-500/50' :
                    'bg-red-500 shadow-lg shadow-red-500/50'
                  }`} />

                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-white">{system.name}</h3>
                    <p className="text-xs text-gray-500 font-mono">
                      {system.hostname} • {system.ip} • {system.cameras.length} камер
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <motion.button
                      whileHover={{ scale: 1.2 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handleToggleSystem(system)}
                      className={`p-1.5 rounded-lg transition-all ${
                        system.isActive ? 'text-green-400 hover:bg-green-950/30' : 'text-gray-500 hover:bg-gray-800'
                      }`}
                      title={system.isActive ? 'Отключить' : 'Включить'}
                    >
                      <Power className="w-4 h-4" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.2 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => {
                        setSystemForm({
                          name: system.name,
                          hostname: system.hostname,
                          ip: system.ip,
                          description: system.description,
                        });
                        setEditingSystem(system);
                        setShowSystemForm(true);
                      }}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-800 transition-all"
                      title="Редактировать"
                    >
                      <Edit2 className="w-4 h-4" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.2, rotate: 10 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handleDeleteSystem(system)}
                      className="p-1.5 rounded-lg text-red-400 hover:bg-red-950/30 transition-all"
                      title="Удалить"
                    >
                      <Trash2 className="w-4 h-4" />
                    </motion.button>
                  </div>
                </div>

                {/* Cameras List */}
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
                        {system.description && (
                          <p className="text-xs text-gray-500 mb-3">{system.description}</p>
                        )}

                        {system.cameras.map(camera => (
                          <motion.div
                            key={camera.id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-center gap-3 p-2.5 bg-gray-800/30 rounded-lg border border-gray-700/30 group hover:border-blue-500/30 transition-all"
                          >
                            <div className={`w-2 h-2 rounded-full ${
                              camera.status === 'online' ? 'bg-green-500' :
                              camera.status === 'reconnecting' ? 'bg-yellow-500' :
                              'bg-red-500'
                            }`} />
                            <Video className="w-4 h-4 text-gray-500" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-white">{camera.name}</p>
                              <p className="text-[10px] text-gray-500 font-mono truncate">{camera.url}</p>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <motion.button
                                whileHover={{ scale: 1.2 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleToggleCamera(system.id, camera)}
                                className={`p-1 rounded ${camera.isActive ? 'text-green-400' : 'text-gray-500'}`}
                              >
                                <Power className="w-3 h-3" />
                              </motion.button>
                              <motion.button
                                whileHover={{ scale: 1.2 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => startEditCamera(system.id, camera)}
                                className="p-1 rounded text-gray-400 hover:bg-gray-700"
                              >
                                <Edit2 className="w-3 h-3" />
                              </motion.button>
                              <motion.button
                                whileHover={{ scale: 1.2 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleDeleteCamera(system.id, camera)}
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
                            setCameraForm({ name: '', url: '', sourceLogin: '', sourcePassword: '' });
                            setEditingCamera(null);
                            setShowCameraForm(system.id);
                          }}
                          className="w-full py-2 px-3 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 text-xs font-medium rounded-lg transition-all border border-blue-500/20 flex items-center justify-center gap-2"
                        >
                          <Plus className="w-3 h-3" />
                          Добавить камеру
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

      {systems.length === 0 && (
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
          <p className="text-lg">Нет настроенных систем</p>
          <p className="text-sm mt-2 text-gray-600">Нажмите «Добавить систему» для начала работы</p>
        </motion.div>
      )}

      {/* Add/Edit System Modal */}
      <AnimatePresence>
        {showSystemForm && (
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
                  {editingSystem ? 'Редактировать систему' : 'Новая система'}
                </h3>
                <motion.button 
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={resetSystemForm} 
                  className="p-1.5 rounded-xl hover:bg-gray-800 text-gray-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              <div className="space-y-4 relative">
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Название системы</label>
                  <input
                    type="text"
                    value={systemForm.name}
                    onChange={e => setSystemForm({...systemForm, name: e.target.value})}
                    className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="КПП-1 (Центральный пост)"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-gray-300 mb-1.5">Hostname</label>
                    <input
                      type="text"
                      value={systemForm.hostname}
                      onChange={e => setSystemForm({...systemForm, hostname: e.target.value})}
                      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                      placeholder="kpp1-server"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1.5">IP-адрес</label>
                    <input
                      type="text"
                      value={systemForm.ip}
                      onChange={e => setSystemForm({...systemForm, ip: e.target.value})}
                      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                      placeholder="192.168.1.10"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Описание</label>
                  <textarea
                    value={systemForm.description}
                    onChange={e => setSystemForm({...systemForm, description: e.target.value})}
                    rows={2}
                    className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all resize-none"
                    placeholder="Описание системы..."
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6 relative">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={resetSystemForm}
                  className="flex-1 py-2.5 px-4 bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 text-sm rounded-xl transition-all border border-gray-700/50"
                >
                  Отмена
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSaveSystem}
                  className="flex-1 py-2.5 px-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                >
                  <Check className="w-4 h-4" />
                  {editingSystem ? 'Сохранить' : 'Добавить'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add/Edit Camera Modal */}
      <AnimatePresence>
        {showCameraForm && (
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
                  {editingCamera ? 'Редактировать камеру' : 'Новая камера'}
                </h3>
                <motion.button 
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={resetCameraForm} 
                  className="p-1.5 rounded-xl hover:bg-gray-800 text-gray-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              <div className="space-y-4 relative">
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Название камеры</label>
                  <input
                    type="text"
                    value={cameraForm.name}
                    onChange={e => setCameraForm({...cameraForm, name: e.target.value})}
                    className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="Камера въезда"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">RTSP URL</label>
                  <input
                    type="text"
                    value={cameraForm.url}
                    onChange={e => setCameraForm({...cameraForm, url: e.target.value})}
                    className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="rtsp://192.168.1.100:554/stream1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-gray-300 mb-1.5">Логин</label>
                    <input
                      type="text"
                      value={cameraForm.sourceLogin}
                      onChange={e => setCameraForm({...cameraForm, sourceLogin: e.target.value})}
                      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1.5">Пароль</label>
                    <input
                      type="password"
                      value={cameraForm.sourcePassword}
                      onChange={e => setCameraForm({...cameraForm, sourcePassword: e.target.value})}
                      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6 relative">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={resetCameraForm}
                  className="flex-1 py-2.5 px-4 bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 text-sm rounded-xl transition-all border border-gray-700/50"
                >
                  Отмена
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSaveCamera(showCameraForm)}
                  className="flex-1 py-2.5 px-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                >
                  <Check className="w-4 h-4" />
                  {editingCamera ? 'Сохранить' : 'Добавить'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
