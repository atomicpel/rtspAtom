import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Grid3x3, LayoutGrid, Maximize2, Minimize2, Plus, X, Save, 
  Video, Radio, Settings, Server, ChevronDown, ChevronRight
} from 'lucide-react';
import { System, Camera } from '../lib/types';
import { getSystemsForUser } from '../lib/storage';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { AnimatedCard, StaggerContainer, StaggerItem } from '../components/AnimatedCard';

type LayoutType = '1x1' | '2x2' | '3x3' | '4x4';

// Cell data: systemId + cameraId (or null)
interface CellData {
  systemId: string | null;
  cameraId: string | null;
}

interface VideoWallConfig {
  id: string;
  name: string;
  layout: LayoutType;
  cells: CellData[];
  createdAt: string;
}

export function VideoWallPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const availableSystems = getSystemsForUser(user);
  
  const [layout, setLayout] = useState<LayoutType>('2x2');
  const [cells, setCells] = useState<CellData[]>(() => {
    const arr: CellData[] = [];
    for (let i = 0; i < 16; i++) arr.push({ systemId: null, cameraId: null });
    return arr;
  });
  const [showPicker, setShowPicker] = useState<number | null>(null);
  const [expandedSystems, setExpandedSystems] = useState<Set<string>>(
    new Set(availableSystems.map(s => s.id))
  );
  const [fullscreenCell, setFullscreenCell] = useState<number | null>(null);
  const [configs, setConfigs] = useState<VideoWallConfig[]>(() => {
    const saved = localStorage.getItem('rtsp_video_wall_configs_v2');
    return saved ? JSON.parse(saved) : [];
  });

  const getGridClass = () => {
    switch (layout) {
      case '1x1': return 'grid-cols-1 grid-rows-1';
      case '2x2': return 'grid-cols-2 grid-rows-2';
      case '3x3': return 'grid-cols-3 grid-rows-3';
      case '4x4': return 'grid-cols-4 grid-rows-4';
      default: return 'grid-cols-2 grid-rows-2';
    }
  };

  const getCellCount = () => {
    switch (layout) {
      case '1x1': return 1;
      case '2x2': return 4;
      case '3x3': return 9;
      case '4x4': return 16;
      default: return 4;
    }
  };

  const getCellData = (index: number): { system: System | null; camera: Camera | null } => {
    const cell = cells[index];
    if (!cell || !cell.systemId || !cell.cameraId) {
      return { system: null, camera: null };
    }
    const system = availableSystems.find(s => s.id === cell.systemId) || null;
    const camera = system?.cameras.find(c => c.id === cell.cameraId) || null;
    return { system, camera };
  };

  const handleCellClick = (index: number) => {
    setShowPicker(index);
  };

  const handleCameraSelect = (systemId: string, cameraId: string) => {
    if (showPicker !== null) {
      const updated: CellData[] = [...cells];
      updated[showPicker] = { systemId, cameraId };
      setCells(updated);
      setShowPicker(null);
      
      const system = availableSystems.find(s => s.id === systemId);
      const camera = system?.cameras.find(c => c.id === cameraId);
      toast('success', `${system?.name} → ${camera?.name}`);
    }
  };

  const handleClearCell = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = [...cells];
    updated[index] = { systemId: null, cameraId: null };
    setCells(updated);
    toast('info', 'Ячейка очищена');
  };

  const handleSaveConfig = () => {
    const name = prompt('Название конфигурации:');
    if (!name) return;

    const config: VideoWallConfig = {
      id: Date.now().toString(36),
      name,
      layout,
      cells: cells.slice(0, getCellCount()),
      createdAt: new Date().toISOString(),
    };

    const updated = [...configs, config];
    setConfigs(updated);
    localStorage.setItem('rtsp_video_wall_configs_v2', JSON.stringify(updated));
    toast('success', `Конфигурация "${name}" сохранена`);
  };

  const handleLoadConfig = (config: VideoWallConfig) => {
    setLayout(config.layout);
    const newCells: CellData[] = [];
    for (let i = 0; i < 16; i++) newCells.push({ systemId: null, cameraId: null });
    config.cells.forEach((c, i) => {
      if (i < 16) newCells[i] = c;
    });
    setCells(newCells);
    toast('success', `Конфигурация "${config.name}" загружена`);
  };

  const handleDeleteConfig = (configId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Удалить конфигурацию?')) return;
    const updated = configs.filter(c => c.id !== configId);
    setConfigs(updated);
    localStorage.setItem('rtsp_video_wall_configs_v2', JSON.stringify(updated));
    toast('info', 'Конфигурация удалена');
  };

  const handleAutoFill = () => {
    const allCameras: { systemId: string; camera: Camera }[] = [];
    availableSystems.forEach(system => {
      system.cameras.filter(c => c.isActive && c.status === 'online').forEach(camera => {
        allCameras.push({ systemId: system.id, camera });
      });
    });

    const newCells: CellData[] = [];
    for (let i = 0; i < 16; i++) newCells.push({ systemId: null, cameraId: null });
    allCameras.slice(0, getCellCount()).forEach((item, i) => {
      newCells[i] = { systemId: item.systemId, cameraId: item.camera.id };
    });
    setCells(newCells);
    toast('success', `Автоматически заполнено ${Math.min(allCameras.length, getCellCount())} ячеек`);
  };

  const handleClearAll = () => {
    setCells(Array(16).fill(null).map(() => ({ systemId: null, cameraId: null })));
    toast('info', 'Все ячейки очищены');
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
            <LayoutGrid className="w-5 h-5 text-blue-400" />
            Видеостена
          </h2>
          <p className="text-sm text-gray-500">
            {availableSystems.length} систем доступно • {availableSystems.reduce((s, sys) => s + sys.cameras.length, 0)} камер
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Layout Selector */}
          <div className="flex items-center gap-1 bg-gray-900/50 border border-gray-800/50 rounded-xl p-1">
            {[
              { id: '1x1' as LayoutType, label: '1×1' },
              { id: '2x2' as LayoutType, label: '2×2' },
              { id: '3x3' as LayoutType, label: '3×3' },
              { id: '4x4' as LayoutType, label: '4×4' },
            ].map(item => (
              <motion.button
                key={item.id}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setLayout(item.id)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  layout === item.id
                    ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                }`}
              >
                {item.label}
              </motion.button>
            ))}
          </div>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleAutoFill}
            className="px-3 py-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs font-medium rounded-xl transition-all border border-green-700/30"
          >
            Авто
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleClearAll}
            className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs font-medium rounded-xl transition-all border border-red-700/30"
          >
            Очистить
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSaveConfig}
            className="px-3 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-xs font-medium rounded-xl transition-all shadow-lg shadow-blue-500/20 flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            Сохранить
          </motion.button>
        </div>
      </motion.div>

      {/* Saved Configs */}
      {configs.length > 0 && (
        <AnimatedCard className="p-4" delay={0.1}>
          <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Сохранённые конфигурации
          </h3>
          <div className="flex gap-2 flex-wrap">
            {configs.map(config => (
              <motion.div
                key={config.id}
                whileHover={{ scale: 1.05 }}
                className="relative group"
              >
                <button
                  onClick={() => handleLoadConfig(config)}
                  className="px-3 py-2 bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 text-xs rounded-xl transition-all border border-gray-700/50 flex items-center gap-2"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  {config.name}
                  <span className="text-gray-500">({config.layout})</span>
                </button>
                <motion.button
                  whileHover={{ scale: 1.2 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={(e) => handleDeleteConfig(config.id, e)}
                  className="absolute -top-1 -right-1 p-1 bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-2.5 h-2.5" />
                </motion.button>
              </motion.div>
            ))}
          </div>
        </AnimatedCard>
      )}

      {/* Video Wall Grid */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
        className={`grid ${getGridClass()} gap-3 aspect-video bg-gray-900/30 border border-gray-800/50 rounded-2xl p-3 backdrop-blur-sm`}
      >
        {Array.from({ length: getCellCount() }).map((_, index) => {
          const { system, camera } = getCellData(index);

          return (
            <motion.div
              key={index}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.05 * index }}
              whileHover={{ scale: 1.02 }}
              onClick={() => handleCellClick(index)}
              className="relative bg-black/50 border border-gray-700/30 rounded-xl overflow-hidden cursor-pointer group"
            >
              {camera && system ? (
                <>
                  {/* Video placeholder */}
                  <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-gray-800">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.1)_0%,transparent_70%)]" />
                  </div>

                  {/* Stream info */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center px-2">
                      <motion.div
                        animate={{ y: [0, -5, 0] }}
                        transition={{ duration: 3, repeat: Infinity }}
                      >
                        <Video className="w-8 h-8 mx-auto text-gray-600 mb-2" />
                      </motion.div>
                      <p className="text-xs text-gray-400 font-medium">{camera.name}</p>
                      <p className="text-[10px] text-gray-600 mt-0.5">{system.name}</p>
                    </div>
                  </div>

                  {/* LIVE indicator */}
                  {camera.status === 'online' && (
                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 px-2 py-0.5 rounded-lg backdrop-blur-sm border border-red-500/30"
                    >
                      <motion.div
                        animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }}
                        transition={{ duration: 1, repeat: Infinity }}
                        className="w-1.5 h-1.5 rounded-full bg-red-500"
                      />
                      <span className="text-[10px] text-white font-medium">LIVE</span>
                    </motion.div>
                  )}

                  {/* Status indicator */}
                  <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${
                    camera.status === 'online' ? 'bg-green-500 shadow-lg shadow-green-500/50' :
                    camera.status === 'reconnecting' ? 'bg-yellow-500 shadow-lg shadow-yellow-500/50' :
                    'bg-red-500 shadow-lg shadow-red-500/50'
                  }`} />

                  {/* Clear button */}
                  <motion.button
                    whileHover={{ scale: 1.2 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={(e) => handleClearCell(index, e)}
                    className="absolute bottom-2 right-2 p-1.5 bg-red-600/80 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
                  >
                    <X className="w-3 h-3" />
                  </motion.button>

                  {/* Fullscreen button */}
                  <motion.button
                    whileHover={{ scale: 1.2 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={(e) => { e.stopPropagation(); setFullscreenCell(index); }}
                    className="absolute bottom-2 left-2 p-1.5 bg-blue-600/80 hover:bg-blue-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
                  >
                    <Maximize2 className="w-3 h-3" />
                  </motion.button>
                </>
              ) : (
                /* Empty cell */
                <div className="absolute inset-0 flex items-center justify-center">
                  <motion.div
                    animate={{ opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="text-center"
                  >
                    <Plus className="w-8 h-8 mx-auto text-gray-600 mb-2" />
                    <p className="text-xs text-gray-600">Ячейка {index + 1}</p>
                    <p className="text-[10px] text-gray-700 mt-1">Нажмите для выбора</p>
                  </motion.div>
                </div>
              )}

              <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/5 transition-colors" />
            </motion.div>
          );
        })}
      </motion.div>

      {/* Camera Picker Modal — grouped by system */}
      <AnimatePresence>
        {showPicker !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowPicker(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-strong rounded-2xl w-full max-w-lg p-6 relative overflow-hidden max-h-[80vh] flex flex-col"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 pointer-events-none" />
              <div className="flex items-center justify-between mb-4 relative shrink-0">
                <h3 className="text-lg font-semibold text-white">
                  Выберите камеру — ячейка {showPicker + 1}
                </h3>
                <motion.button
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowPicker(null)}
                  className="p-1.5 rounded-xl hover:bg-gray-800 text-gray-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              <div className="space-y-3 overflow-y-auto flex-1 relative pr-1">
                {availableSystems.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Server className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>Нет доступных систем</p>
                    <p className="text-xs mt-1">Обратитесь к администратору для предоставления доступа</p>
                  </div>
                ) : (
                  availableSystems.map(system => {
                    const isExpanded = expandedSystems.has(system.id);
                    
                    return (
                      <div key={system.id} className="bg-gray-800/30 rounded-xl border border-gray-700/30 overflow-hidden">
                        {/* System Header */}
                        <motion.button
                          whileHover={{ backgroundColor: 'rgba(59, 130, 246, 0.05)' }}
                          onClick={() => toggleExpand(system.id)}
                          className="w-full flex items-center gap-3 p-3 text-left"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                          )}
                          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            system.status === 'online' ? 'bg-green-500 shadow-lg shadow-green-500/50' :
                            system.status === 'reconnecting' ? 'bg-yellow-500' :
                            'bg-red-500'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{system.name}</p>
                            <p className="text-[10px] text-gray-500 font-mono">{system.ip} • {system.cameras.length} камер</p>
                          </div>
                          <Server className="w-4 h-4 text-gray-600 shrink-0" />
                        </motion.button>

                        {/* Cameras */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="border-t border-gray-700/30 overflow-hidden"
                            >
                              <div className="p-2 space-y-1">
                                {system.cameras.length === 0 ? (
                                  <p className="text-xs text-gray-500 text-center py-2">Нет камер</p>
                                ) : (
                                  system.cameras.map(camera => (
                                    <motion.button
                                      key={camera.id}
                                      whileHover={{ scale: 1.01, x: 2 }}
                                      whileTap={{ scale: 0.99 }}
                                      onClick={() => handleCameraSelect(system.id, camera.id)}
                                      className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-gray-700/30 transition-all text-left group"
                                    >
                                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                                        camera.status === 'online' ? 'bg-green-500' :
                                        camera.status === 'reconnecting' ? 'bg-yellow-500' :
                                        'bg-red-500'
                                      }`} />
                                      <Video className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-white group-hover:text-blue-400 transition-colors truncate">
                                          {camera.name}
                                        </p>
                                      </div>
                                      {camera.status === 'online' && (
                                        <span className="text-[9px] text-green-400 bg-green-950/30 px-1.5 py-0.5 rounded">ONLINE</span>
                                      )}
                                    </motion.button>
                                  ))
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })
                )}
              </div>

              {cells[showPicker]?.systemId && (
                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    const updated = [...cells];
                    updated[showPicker] = { systemId: null, cameraId: null };
                    setCells(updated);
                    setShowPicker(null);
                  }}
                  className="w-full mt-3 py-2.5 px-4 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-medium rounded-xl transition-all border border-red-700/30 relative shrink-0"
                >
                  Убрать камеру из ячейки
                </motion.button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fullscreen Modal */}
      <AnimatePresence>
        {fullscreenCell !== null && (() => {
          const { system, camera } = getCellData(fullscreenCell);
          if (!system || !camera) return null;

          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-8"
              onClick={() => setFullscreenCell(null)}
            >
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.8 }}
                className="relative w-full h-full max-w-6xl max-h-[80vh] bg-black rounded-2xl overflow-hidden border border-gray-700/50"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-gray-800">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.1)_0%,transparent_70%)]" />
                </div>

                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <motion.div
                      animate={{ y: [0, -10, 0] }}
                      transition={{ duration: 3, repeat: Infinity }}
                    >
                      <Video className="w-24 h-24 mx-auto text-gray-600 mb-4" />
                    </motion.div>
                    <p className="text-xl text-gray-400 font-medium">{camera.name}</p>
                    <p className="text-sm text-gray-600 mt-1">{system.name} • {system.ip}</p>
                    <p className="text-xs text-gray-700 font-mono mt-2">{camera.url}</p>
                  </div>
                </div>

                {camera.status === 'online' && (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-xl backdrop-blur-sm border border-red-500/30"
                  >
                    <motion.div
                      animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className="w-2 h-2 rounded-full bg-red-500"
                    />
                    <span className="text-sm text-white font-medium">LIVE</span>
                  </motion.div>
                )}

                <motion.button
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setFullscreenCell(null)}
                  className="absolute top-4 right-4 p-2 bg-gray-800/80 hover:bg-gray-700 text-white rounded-xl backdrop-blur-sm transition-colors"
                >
                  <Minimize2 className="w-5 h-5" />
                </motion.button>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
