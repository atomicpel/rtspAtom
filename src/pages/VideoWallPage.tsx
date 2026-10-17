import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutGrid, Maximize2, Minimize2, Plus, X, Save,
  Video, Settings, Server, ChevronDown, ChevronRight, RefreshCw
} from 'lucide-react';
import { Computer, Stream, WallConfig } from '../lib/types';
import { api, errorMessage } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useToast } from '../components/Toast';
import { AnimatedCard, StaggerContainer, StaggerItem } from '../components/AnimatedCard';
import { VideoPlayer } from '../components/VideoPlayer';
type LayoutType = '1x1' | '2x2' | '3x3' | '4x4';

const REFRESH_INTERVALS = [
  { value: 0, label: 'Выкл' },
  { value: 15, label: '15 сек' },
  { value: 30, label: '30 сек' },
  { value: 60, label: '1 мин' },
  { value: 180, label: '3 мин' },
  { value: 300, label: '5 мин' },
  { value: 600, label: '10 мин' },
  { value: 900, label: '15 мин' },
  { value: 1800, label: '30 мин' },
  { value: 3600, label: '1 час' },
  { value: 7200, label: '2 часа' },
  { value: 10800, label: '3 часа' },
  { value: 18000, label: '5 часов' },
];

interface CellData {
  computerId: string | null;
  streamId: string | null;
}


const createEmptyCells = (): CellData[] => {
  const arr: CellData[] = [];
  for (let i = 0; i < 16; i++) arr.push({ computerId: null, streamId: null });
  return arr;
};

export function VideoWallPage() {
  const { toast } = useToast();
  const { data: computersData } = usePolling(api.computers, 10000);
  const availableComputers: Computer[] = computersData || [];

  const [loaded, setLoaded] = useState(false);
  const [layout, setLayout] = useState<LayoutType>('2x2');
  const [cells, setCells] = useState<CellData[]>(createEmptyCells());
  const [showPicker, setShowPicker] = useState<number | null>(null);
  const [expandedComputers, setExpandedComputers] = useState<Set<string>>(new Set());
  const [fullscreenCell, setFullscreenCell] = useState<number | null>(null);
  const [isWallFullscreen, setIsWallFullscreen] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState<number>(0);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [configs, setConfigs] = useState<WallConfig[]>([]);

  // Загрузка сохранённого состояния видеостены пользователя с сервера
  useEffect(() => {
    let alive = true;
    Promise.all([api.wallState(), api.wallConfigs()])
      .then(([state, cfgs]) => {
        if (!alive) return;
        const full = createEmptyCells();
        (state.cells || []).forEach((c, i) => { if (i < 16) full[i] = c; });
        setLayout(state.layout || '2x2');
        setCells(full);
        setRefreshInterval(state.refreshInterval || 0);
        setConfigs(cfgs);
      })
      .catch((err) => toast('error', `Не удалось загрузить видеостену: ${errorMessage(err)}`))
      .finally(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, []);

  // Раскрываем список компьютеров в окне выбора при первой загрузке
  useEffect(() => {
    if (computersData && expandedComputers.size === 0) {
      setExpandedComputers(new Set(computersData.map(c => c.id)));
    }
  }, [computersData]);

  // Сохранение состояния на сервере (с задержкой, чтобы не слать запрос на каждое действие)
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      api.saveWallState({ layout, cells, refreshInterval }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [layout, cells, refreshInterval, loaded]);

  // Auto-refresh
  useEffect(() => {
    if (refreshInterval === 0) return;
    const interval = setInterval(() => {
      setLastRefresh(new Date());
    }, refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [refreshInterval]);

  // Fullscreen handling - NO page reload
  const enterFullscreen = useCallback(() => {
    setIsWallFullscreen(true);
    // Use CSS fullscreen instead of Fullscreen API to avoid page reload
    document.body.style.overflow = 'hidden';
  }, []);

  const exitFullscreen = useCallback(() => {
    setIsWallFullscreen(false);
    document.body.style.overflow = '';
  }, []);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isWallFullscreen) {
        exitFullscreen();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isWallFullscreen, exitFullscreen]);

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

  const getCellData = (index: number): { computer: Computer | null; stream: Stream | null } => {
    const cell = cells[index];
    if (!cell || !cell.computerId || !cell.streamId) {
      return { computer: null, stream: null };
    }
    const computer = availableComputers.find(c => c.id === cell.computerId) || null;
    const stream = computer?.streams.find(s => s.id === cell.streamId) || null;
    return { computer, stream };
  };

  const handleCellClick = (index: number) => {
    if (isWallFullscreen) return; // Don't allow editing in fullscreen
    setShowPicker(index);
  };

  const handleStreamSelect = (computerId: string, streamId: string) => {
    if (showPicker !== null) {
      const updated: CellData[] = [...cells];
      updated[showPicker] = { computerId, streamId };
      setCells(updated);
      setShowPicker(null);
      
      const computer = availableComputers.find(c => c.id === computerId);
      const stream = computer?.streams.find(s => s.id === streamId);
      toast('success', `${computer?.name} → ${stream?.name}`);
    }
  };

  const handleClearCell = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = [...cells];
    updated[index] = { computerId: null, streamId: null };
    setCells(updated);
    toast('info', 'Ячейка очищена');
  };

  const handleSaveConfig = async () => {
    const name = prompt('Название конфигурации:');
    if (!name) return;
    try {
      setConfigs(await api.addWallConfig({ name, layout, cells: cells.slice(0, getCellCount()) }));
      toast('success', `Конфигурация «${name}» сохранена`);
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  const handleLoadConfig = (config: WallConfig) => {
    setLayout(config.layout);
    const newCells = createEmptyCells();
    config.cells.forEach((c, i) => {
      if (i < 16) newCells[i] = c;
    });
    setCells(newCells);
    toast('success', `Конфигурация «${config.name}» загружена`);
  };

  const handleDeleteConfig = async (configId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Удалить конфигурацию?')) return;
    try {
      setConfigs(await api.deleteWallConfig(configId));
      toast('info', 'Конфигурация удалена');
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  const handleAutoFill = () => {
    const allStreams: { computerId: string; stream: Stream }[] = [];
    availableComputers.forEach(computer => {
      (computer.streams || []).filter(s => s.isActive && (s.status === 'online' || s.status === 'idle')).forEach(stream => {
        allStreams.push({ computerId: computer.id, stream });
      });
    });

    const newCells = createEmptyCells();
    allStreams.slice(0, getCellCount()).forEach((item, i) => {
      newCells[i] = { computerId: item.computerId, streamId: item.stream.id };
    });
    setCells(newCells);
    toast('success', `Автоматически заполнено ${Math.min(allStreams.length, getCellCount())} ячеек`);
  };

  const handleClearAll = () => {
    setCells(createEmptyCells());
    toast('info', 'Все ячейки очищены');
  };

  const toggleExpand = (computerId: string) => {
    const newExpanded = new Set(expandedComputers);
    if (newExpanded.has(computerId)) newExpanded.delete(computerId);
    else newExpanded.add(computerId);
    setExpandedComputers(newExpanded);
  };

  // Render a single cell
  const renderCell = (index: number, isFullscreenMode: boolean) => {
    const { computer, stream } = getCellData(index);
    return (
      <motion.div
        key={index}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.02 * index, duration: 0.3 }}
        whileHover={!isFullscreenMode ? { scale: 1.02 } : undefined}
        onClick={() => handleCellClick(index)}
        className={`relative border border-gray-700/30 rounded-xl overflow-hidden cursor-pointer group ${
          isFullscreenMode ? 'bg-black/80 rounded-lg' : 'bg-black/50'
        }`}
      >
        {stream && computer ? (
          <>
            <VideoPlayer
              streamId={stream.id}
              name={stream.name}
              reloadKey={lastRefresh.getTime()}
              disabled={!stream.isActive || !computer.isActive}
              className="absolute inset-0"
            />

            {/* Название потока */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 pointer-events-none">
              <p className={`${isFullscreenMode ? 'text-sm' : 'text-xs'} text-white font-medium truncate`}>
                {stream.name}
              </p>
              <p className={`${isFullscreenMode ? 'text-xs' : 'text-[10px]'} text-gray-300 truncate`}>
                {computer.name}
              </p>
            </div>

            <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${
              stream.status === 'online' ? 'bg-green-500 shadow-lg shadow-green-500/50' :
              stream.status === 'reconnecting' ? 'bg-yellow-500' : stream.status === 'idle' ? 'bg-blue-400' : 'bg-red-500'
            }`} />
            {!isFullscreenMode && (
              <>
                <motion.button
                  whileHover={{ scale: 1.2 }} whileTap={{ scale: 0.9 }}
                  onClick={(e) => handleClearCell(index, e)}
                  className="absolute bottom-2 right-2 p-1.5 bg-red-600/80 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
                >
                  <X className="w-3 h-3" />
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.2 }} whileTap={{ scale: 0.9 }}
                  onClick={(e) => { e.stopPropagation(); setFullscreenCell(index); }}
                  className="absolute bottom-2 left-2 p-1.5 bg-blue-600/80 hover:bg-blue-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
                >
                  <Maximize2 className="w-3 h-3" />
                </motion.button>
              </>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.div
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="text-center"
            >
              <Plus className={`${isFullscreenMode ? 'w-10 h-10' : 'w-8 h-8'} mx-auto text-gray-600 mb-2`} />
              <p className={`${isFullscreenMode ? 'text-xs' : 'text-[10px]'} text-gray-600`}>
                {isFullscreenMode ? '' : `Ячейка ${index + 1}`}
              </p>
            </motion.div>
          </div>
        )}
        <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/5 transition-colors" />
      </motion.div>
    );
  };

  // Fullscreen wall view (CSS-based, no page reload)
  if (isWallFullscreen) {
    return (
      <div className="fixed inset-0 z-[200] bg-black flex flex-col">
        {/* Compact toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <LayoutGrid className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-medium text-white">Видеостена</span>
            {refreshInterval > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                <RefreshCw className="w-2.5 h-2.5 animate-spin" style={{ animationDuration: '3s' }} />
                <span>{REFRESH_INTERVALS.find(i => i.value === refreshInterval)?.label}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5 bg-gray-800/50 rounded-lg p-0.5">
              {(['1x1', '2x2', '3x3', '4x4'] as LayoutType[]).map(id => (
                <button key={id} onClick={() => setLayout(id)}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                    layout === id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {id.replace('x', '×')}
                </button>
              ))}
            </div>
            <select value={refreshInterval} onChange={e => setRefreshInterval(parseInt(e.target.value))}
              className="bg-gray-800/50 text-[10px] text-gray-300 rounded-lg px-1.5 py-1 border-none focus:outline-none"
            >
              {REFRESH_INTERVALS.map(i => (
                <option key={i.value} value={i.value}>{i.label}</option>
              ))}
            </select>
            <button onClick={handleAutoFill} className="px-2 py-1 bg-green-600/20 text-green-400 text-[10px] rounded-lg">
              Авто
            </button>
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={exitFullscreen}
              className="p-1.5 bg-gray-800/80 hover:bg-gray-700 text-white rounded-lg"
              title="Выйти (Esc)"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </motion.button>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 p-1.5 min-h-0">
          <div className={`grid ${getGridClass()} gap-1.5 h-full`}>
            {Array.from({ length: getCellCount() }).map((_, index) => renderCell(index, true))}
          </div>
        </div>

        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-gray-600 bg-gray-900/80 px-2 py-1 rounded backdrop-blur-sm">
          Esc — выйти
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between flex-wrap gap-4"
      >
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <LayoutGrid className="w-5 h-5 text-blue-400" />
            Видеостена
          </h2>
          <p className="text-sm text-gray-500 flex items-center gap-2">
            <span>{availableComputers.length} компьютеров • {availableComputers.reduce((s, c) => s + (c.streams?.length || 0), 0)} потоков</span>
            {refreshInterval > 0 && (
              <span className="flex items-center gap-1 text-xs text-blue-400">
                <motion.div key={lastRefresh.getTime()} initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }} className="w-1.5 h-1.5 rounded-full bg-blue-400"
                />
                Обновлено: {lastRefresh.toLocaleTimeString('ru-RU')}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-gray-900/50 border border-gray-800/50 rounded-xl p-1">
            {(['1x1', '2x2', '3x3', '4x4'] as LayoutType[]).map(item => (
              <motion.button key={item} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => setLayout(item)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  layout === item ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                }`}
              >
                {item.replace('x', '×')}
              </motion.button>
            ))}
          </div>

          <div className="flex items-center gap-1 bg-gray-900/50 border border-gray-800/50 rounded-xl px-2 py-1">
            <RefreshCw className={`w-3.5 h-3.5 text-gray-400 ${refreshInterval > 0 ? 'animate-spin' : ''}`} style={{ animationDuration: '3s' }} />
            <select value={refreshInterval} onChange={e => setRefreshInterval(parseInt(e.target.value))}
              className="bg-transparent text-xs text-gray-300 focus:outline-none cursor-pointer"
            >
              {REFRESH_INTERVALS.map(i => (
                <option key={i.value} value={i.value} className="bg-gray-900">{i.label}</option>
              ))}
            </select>
          </div>

          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={handleAutoFill}
            className="px-3 py-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs font-medium rounded-xl transition-all border border-green-700/30"
          >
            Авто
          </motion.button>

          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={handleClearAll}
            className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs font-medium rounded-xl transition-all border border-red-700/30"
          >
            Очистить
          </motion.button>

          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={handleSaveConfig}
            className="px-3 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white text-xs font-medium rounded-xl transition-all shadow-lg shadow-blue-500/20 flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            Сохранить
          </motion.button>

          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={enterFullscreen}
            className="px-3 py-2 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 text-xs font-medium rounded-xl transition-all border border-cyan-700/30 flex items-center gap-1.5"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">На весь экран</span>
          </motion.button>
        </div>
      </motion.div>

      {configs.length > 0 && (
        <AnimatedCard className="p-4" delay={0.1}>
          <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Сохранённые конфигурации
          </h3>
          <div className="flex gap-2 flex-wrap">
            {configs.map(config => (
              <motion.div key={config.id} whileHover={{ scale: 1.05 }} className="relative group">
                <button onClick={() => handleLoadConfig(config)}
                  className="px-3 py-2 bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 text-xs rounded-xl transition-all border border-gray-700/50 flex items-center gap-2"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  {config.name}
                </button>
                <motion.button whileHover={{ scale: 1.2 }} whileTap={{ scale: 0.9 }}
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

      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}
        className={`grid ${getGridClass()} gap-3 aspect-video bg-gray-900/30 border border-gray-800/50 rounded-2xl p-3 backdrop-blur-sm`}
      >
        {Array.from({ length: getCellCount() }).map((_, index) => renderCell(index, false))}
      </motion.div>

      {/* Stream Picker Modal */}
      <AnimatePresence>
        {showPicker !== null && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowPicker(null)}
          >
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-strong rounded-2xl w-full max-w-lg p-6 relative overflow-hidden max-h-[80vh] flex flex-col"
            >
              <div className="flex items-center justify-between mb-4 shrink-0">
                <h3 className="text-lg font-semibold text-white">
                  Выберите поток — ячейка {showPicker + 1}
                </h3>
                <motion.button whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                  onClick={() => setShowPicker(null)}
                  className="p-1.5 rounded-xl hover:bg-gray-800 text-gray-400"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              <div className="space-y-3 overflow-y-auto flex-1 pr-1">
                {availableComputers.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Server className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>Нет доступных компьютеров</p>
                  </div>
                ) : (
                  availableComputers.map(computer => {
                    const isExpanded = expandedComputers.has(computer.id);
                    return (
                      <div key={computer.id} className="bg-gray-800/30 rounded-xl border border-gray-700/30 overflow-hidden">
                        <motion.button
                          whileHover={{ backgroundColor: 'rgba(59, 130, 246, 0.05)' }}
                          onClick={() => toggleExpand(computer.id)}
                          className="w-full flex items-center gap-3 p-3 text-left"
                        >
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            computer.status === 'online' ? 'bg-green-500 shadow-lg shadow-green-500/50' :
                            computer.status === 'reconnecting' ? 'bg-yellow-500' : 'bg-red-500'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{computer.name}</p>
                            <p className="text-[10px] text-gray-500 font-mono">{computer.ip} • {(computer.streams || []).length} потоков</p>
                          </div>
                          <Server className="w-4 h-4 text-gray-600 shrink-0" />
                        </motion.button>

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                              className="border-t border-gray-700/30 overflow-hidden"
                            >
                              <div className="p-2 space-y-1">
                                {(computer.streams || []).length === 0 ? (
                                  <p className="text-xs text-gray-500 text-center py-2">Нет потоков</p>
                                ) : (
                                  (computer.streams || []).map(stream => (
                                    <motion.button key={stream.id}
                                      whileHover={{ scale: 1.01, x: 2 }} whileTap={{ scale: 0.99 }}
                                      onClick={() => handleStreamSelect(computer.id, stream.id)}
                                      className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-gray-700/30 transition-all text-left group"
                                    >
                                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                                        stream.status === 'online' ? 'bg-green-500' :
                                        stream.status === 'reconnecting' ? 'bg-yellow-500' : stream.status === 'idle' ? 'bg-blue-400' : 'bg-red-500'
                                      }`} />
                                      <Video className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-white group-hover:text-blue-400 transition-colors truncate">
                                          {stream.name}
                                        </p>
                                        <div className="flex items-center gap-1">
                                          <span className="text-[9px] text-purple-400 uppercase">{stream.protocol}</span>
                                          {stream.tracks.length > 0 && <span className="text-[9px] text-gray-500">{stream.tracks.join(', ')}</span>}
                                        </div>
                                      </div>
                                      {stream.status === 'online' && (
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

              {cells[showPicker]?.computerId && (
                <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    const updated = [...cells];
                    updated[showPicker] = { computerId: null, streamId: null };
                    setCells(updated);
                    setShowPicker(null);
                  }}
                  className="w-full mt-3 py-2.5 px-4 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-medium rounded-xl transition-all border border-red-700/30 shrink-0"
                >
                  Убрать поток из ячейки
                </motion.button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Single cell fullscreen */}
      <AnimatePresence>
        {fullscreenCell !== null && (() => {
          const { computer, stream } = getCellData(fullscreenCell);
          if (!computer || !stream) return null;
          return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-8"
              onClick={() => setFullscreenCell(null)}
            >
              <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }}
                className="relative w-full h-full max-w-6xl max-h-[80vh] bg-black rounded-2xl overflow-hidden border border-gray-700/50"
              >
                <VideoPlayer
                  streamId={stream.id}
                  name={stream.name}
                  disabled={!stream.isActive || !computer.isActive}
                  className="absolute inset-0"
                />
                
                {/* Информация о потоке */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 pointer-events-none">
                  <p className="text-xl text-white font-medium">{stream.name}</p>
                  <p className="text-sm text-gray-300 mt-1">{computer.name}{computer.ip ? ` • ${computer.ip}` : ''}</p>
                  <p className="text-xs text-purple-400 mt-1 uppercase">{stream.protocol}{stream.tracks.length ? ` • ${stream.tracks.join(', ')}` : ''}</p>
                </div>
                <motion.button whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                  onClick={() => setFullscreenCell(null)}
                  className="absolute top-4 right-4 p-2 bg-gray-800/80 hover:bg-gray-700 text-white rounded-xl backdrop-blur-sm"
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
