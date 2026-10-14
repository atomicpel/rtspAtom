import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Grid3x3, LayoutGrid, Maximize2, Minimize2, Plus, X, Save, 
  Video, Radio, Settings, Download, Upload, Trash2
} from 'lucide-react';
import { Stream } from '../lib/types';
import { getStreams } from '../lib/storage';
import { useToast } from '../components/Toast';
import { AnimatedCard, StaggerContainer, StaggerItem } from '../components/AnimatedCard';

type LayoutType = '1x1' | '2x2' | '3x3' | '4x4' | 'custom';

interface VideoWallConfig {
  id: string;
  name: string;
  layout: LayoutType;
  streams: (string | null)[];
  createdAt: string;
}

export function VideoWallPage() {
  const { toast } = useToast();
  const streams = getStreams();
  const [layout, setLayout] = useState<LayoutType>('2x2');
  const [selectedStreams, setSelectedStreams] = useState<(string | null)[]>(
    Array(16).fill(null)
  );
  const [showStreamPicker, setShowStreamPicker] = useState<number | null>(null);
  const [fullscreenCell, setFullscreenCell] = useState<number | null>(null);
  const [configs, setConfigs] = useState<VideoWallConfig[]>(() => {
    const saved = localStorage.getItem('rtsp_video_wall_configs');
    return saved ? JSON.parse(saved) : [];
  });

  const getGridClass = () => {
    switch (layout) {
      case '1x1': return 'grid-cols-1 grid-rows-1';
      case '2x2': return 'grid-cols-2 grid-rows-2';
      case '3x3': return 'grid-cols-3 grid-rows-3';
      case '4x4': return 'grid-cols-4 grid-rows-4';
      case 'custom': return 'grid-cols-3 grid-rows-3';
      default: return 'grid-cols-2 grid-rows-2';
    }
  };

  const getCellCount = () => {
    switch (layout) {
      case '1x1': return 1;
      case '2x2': return 4;
      case '3x3': return 9;
      case '4x4': return 16;
      case 'custom': return 9;
      default: return 4;
    }
  };

  const handleCellClick = (index: number) => {
    setShowStreamPicker(index);
  };

  const handleStreamSelect = (streamId: string | null) => {
    if (showStreamPicker !== null) {
      const updated = [...selectedStreams];
      updated[showStreamPicker] = streamId;
      setSelectedStreams(updated);
      setShowStreamPicker(null);
      if (streamId) {
        const stream = streams.find(s => s.id === streamId);
        toast('success', `Камера "${stream?.name}" добавлена в ячейку ${showStreamPicker + 1}`);
      }
    }
  };

  const handleClearCell = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = [...selectedStreams];
    updated[index] = null;
    setSelectedStreams(updated);
    toast('info', 'Ячейка очищена');
  };

  const handleSaveConfig = () => {
    const name = prompt('Название конфигурации:');
    if (!name) return;

    const config: VideoWallConfig = {
      id: Date.now().toString(36),
      name,
      layout,
      streams: selectedStreams.slice(0, getCellCount()),
      createdAt: new Date().toISOString(),
    };

    const updated = [...configs, config];
    setConfigs(updated);
    localStorage.setItem('rtsp_video_wall_configs', JSON.stringify(updated));
    toast('success', `Конфигурация "${name}" сохранена`);
  };

  const handleLoadConfig = (config: VideoWallConfig) => {
    setLayout(config.layout);
    const newStreams = Array(16).fill(null);
    config.streams.forEach((s, i) => {
      newStreams[i] = s;
    });
    setSelectedStreams(newStreams);
    toast('success', `Конфигурация "${config.name}" загружена`);
  };

  const handleDeleteConfig = (configId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Удалить конфигурацию?')) return;
    const updated = configs.filter(c => c.id !== configId);
    setConfigs(updated);
    localStorage.setItem('rtsp_video_wall_configs', JSON.stringify(updated));
    toast('info', 'Конфигурация удалена');
  };

  const handleAutoFill = () => {
    const activeStreams = streams.filter(s => s.isActive && s.status === 'online');
    const newStreams = Array(16).fill(null);
    activeStreams.slice(0, getCellCount()).forEach((s, i) => {
      newStreams[i] = s.id;
    });
    setSelectedStreams(newStreams);
    toast('success', `Автоматически заполнено ${Math.min(activeStreams.length, getCellCount())} ячеек`);
  };

  const handleClearAll = () => {
    setSelectedStreams(Array(16).fill(null));
    toast('info', 'Все ячейки очищены');
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
          <p className="text-sm text-gray-500">Настройте сетку и выберите камеры для отображения</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Layout Selector */}
          <div className="flex items-center gap-1 bg-gray-900/50 border border-gray-800/50 rounded-xl p-1">
            {[
              { id: '1x1', icon: Maximize2, label: '1×1' },
              { id: '2x2', icon: Grid3x3, label: '2×2' },
              { id: '3x3', icon: Grid3x3, label: '3×3' },
              { id: '4x4', icon: Grid3x3, label: '4×4' },
            ].map(item => {
              const Icon = item.icon;
              return (
                <motion.button
                  key={item.id}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setLayout(item.id as LayoutType)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                    layout === item.id
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </motion.button>
              );
            })}
          </div>

          {/* Actions */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleAutoFill}
            className="px-3 py-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs font-medium rounded-xl transition-all border border-green-700/30"
          >
            Автозаполнение
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
          const streamId = selectedStreams[index];
          const stream = streamId ? streams.find(s => s.id === streamId) : null;

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
              {stream ? (
                <>
                  {/* Video placeholder */}
                  <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-gray-800">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.1)_0%,transparent_70%)]" />
                  </div>

                  {/* Stream info */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <motion.div
                        animate={{ y: [0, -5, 0] }}
                        transition={{ duration: 3, repeat: Infinity }}
                      >
                        <Video className="w-8 h-8 mx-auto text-gray-600 mb-2" />
                      </motion.div>
                      <p className="text-xs text-gray-400 font-medium">{stream.name}</p>
                      <p className="text-[10px] text-gray-600 font-mono mt-1">{stream.url}</p>
                    </div>
                  </div>

                  {/* LIVE indicator */}
                  {stream.status === 'online' && (
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
                    stream.status === 'online' ? 'bg-green-500 shadow-lg shadow-green-500/50' :
                    stream.status === 'reconnecting' ? 'bg-yellow-500 shadow-lg shadow-yellow-500/50' :
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

              {/* Hover overlay */}
              <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/5 transition-colors" />
            </motion.div>
          );
        })}
      </motion.div>

      {/* Stream Picker Modal */}
      <AnimatePresence>
        {showStreamPicker !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowStreamPicker(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-strong rounded-2xl w-full max-w-md p-6 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 pointer-events-none" />
              <div className="flex items-center justify-between mb-5 relative">
                <h3 className="text-lg font-semibold text-white">
                  Выберите камеру для ячейки {showStreamPicker + 1}
                </h3>
                <motion.button
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowStreamPicker(null)}
                  className="p-1.5 rounded-xl hover:bg-gray-800 text-gray-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto relative">
                {streams.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">Нет доступных камер</p>
                ) : (
                  <StaggerContainer className="space-y-2">
                    {streams.map(stream => (
                      <StaggerItem key={stream.id}>
                        <motion.button
                          whileHover={{ scale: 1.02, x: 4 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => handleStreamSelect(stream.id)}
                          className="w-full p-3 bg-gray-800/30 hover:bg-gray-700/50 border border-gray-700/30 hover:border-blue-500/30 rounded-xl transition-all text-left group"
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-2.5 h-2.5 rounded-full ${
                              stream.status === 'online' ? 'bg-green-500 shadow-lg shadow-green-500/50' :
                              stream.status === 'reconnecting' ? 'bg-yellow-500 shadow-lg shadow-yellow-500/50' :
                              'bg-red-500 shadow-lg shadow-red-500/50'
                            }`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-white group-hover:text-blue-400 transition-colors truncate">
                                {stream.name}
                              </p>
                              <p className="text-xs text-gray-500 font-mono truncate">{stream.url}</p>
                            </div>
                            <Video className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-colors" />
                          </div>
                        </motion.button>
                      </StaggerItem>
                    ))}
                  </StaggerContainer>
                )}
              </div>

              {selectedStreams[showStreamPicker] && (
                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleStreamSelect(null)}
                  className="w-full mt-4 py-2.5 px-4 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-medium rounded-xl transition-all border border-red-700/30 relative"
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
        {fullscreenCell !== null && selectedStreams[fullscreenCell] && (
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
              {(() => {
                const stream = streams.find(s => s.id === selectedStreams[fullscreenCell]);
                if (!stream) return null;

                return (
                  <>
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
                        <p className="text-xl text-gray-400 font-medium">{stream.name}</p>
                        <p className="text-sm text-gray-600 font-mono mt-2">{stream.url}</p>
                      </div>
                    </div>

                    {stream.status === 'online' && (
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
                  </>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
