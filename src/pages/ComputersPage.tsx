import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Edit2, Trash2, Power, X, Check, Server, Video,
  ChevronDown, ChevronRight, Monitor, Radio, Loader2, Eye,
} from 'lucide-react';
import { Computer, Stream, StreamTransport } from '../lib/types';
import { api, errorMessage, protocolFromUrl } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useToast } from '../components/Toast';
import { AnimatedCard, StaggerContainer, StaggerItem } from '../components/AnimatedCard';

const STATUS_DOT: Record<string, string> = {
  online: 'bg-green-500 shadow-lg shadow-green-500/50',
  reconnecting: 'bg-yellow-500',
  idle: 'bg-blue-400',
  offline: 'bg-red-500',
};

const STATUS_LABEL: Record<string, string> = {
  online: 'в сети',
  reconnecting: 'нет сигнала, переподключение',
  idle: 'по запросу',
  offline: 'отключён',
};

const emptyStream = { name: '', url: '', transport: 'auto' as StreamTransport, sourceLogin: '', sourcePassword: '' };

export function ComputersPage() {
  const { toast } = useToast();
  const { data, reload, error } = usePolling(api.computers, 5000);
  const computers: Computer[] = data || [];

  const [showComputerForm, setShowComputerForm] = useState(false);
  const [editingComputer, setEditingComputer] = useState<Computer | null>(null);
  const [expandedComputers, setExpandedComputers] = useState<Set<string>>(new Set());
  const [showStreamForm, setShowStreamForm] = useState<string | null>(null);
  const [editingStream, setEditingStream] = useState<Stream | null>(null);
  const [saving, setSaving] = useState(false);

  const [computerForm, setComputerForm] = useState({ name: '', hostname: '', ip: '', description: '' });
  const [streamForm, setStreamForm] = useState(emptyStream);
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'success' | 'error' | 'warning'>('idle');
  const [checkMessage, setCheckMessage] = useState('');

  const resetComputerForm = () => {
    setComputerForm({ name: '', hostname: '', ip: '', description: '' });
    setEditingComputer(null);
    setShowComputerForm(false);
  };

  const resetStreamForm = () => {
    setStreamForm(emptyStream);
    setEditingStream(null);
    setShowStreamForm(null);
    setCheckState('idle');
    setCheckMessage('');
  };

  const run = async (fn: () => Promise<unknown>, okMsg: string, okType: 'success' | 'info' | 'warning' = 'success') => {
    setSaving(true);
    try {
      await fn();
      toast(okType, okMsg);
      await reload();
      return true;
    } catch (err) {
      toast('error', errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveComputer = async () => {
    if (!computerForm.name.trim()) {
      toast('error', 'Укажите название компьютера');
      return;
    }
    const ok = editingComputer
      ? await run(() => api.updateComputer(editingComputer.id, computerForm), `Компьютер «${computerForm.name}» обновлён`)
      : await run(async () => {
          const c = await api.createComputer(computerForm);
          setExpandedComputers((prev) => new Set(prev).add(c.id));
        }, `Компьютер «${computerForm.name}» добавлен`);
    if (ok) resetComputerForm();
  };

  const handleDeleteComputer = (computer: Computer) => {
    if (!confirm(`Удалить компьютер «${computer.name}» со всеми потоками?`)) return;
    run(() => api.deleteComputer(computer.id), `Компьютер «${computer.name}» удалён`, 'info');
  };

  const handleToggleComputer = (computer: Computer) => {
    run(
      () => api.updateComputer(computer.id, { isActive: !computer.isActive }),
      `Компьютер «${computer.name}» ${computer.isActive ? 'отключён' : 'включён'}`,
      computer.isActive ? 'warning' : 'success',
    );
  };

  const handleSaveStream = async (computerId: string) => {
    if (!streamForm.name.trim() || !streamForm.url.trim()) {
      toast('error', 'Укажите название и URL потока');
      return;
    }
    const payload = {
      name: streamForm.name,
      url: streamForm.url,
      transport: streamForm.transport,
      sourceLogin: streamForm.sourceLogin,
      sourcePassword: streamForm.sourcePassword,
    };
    const ok = editingStream
      ? await run(() => api.updateStream(editingStream.id, payload), `Поток «${streamForm.name}» обновлён`)
      : await run(() => api.createStream(computerId, payload), `Поток «${streamForm.name}» добавлен`);
    if (ok) resetStreamForm();
  };

  const checkStream = async () => {
    if (!streamForm.url.trim()) {
      setCheckState('error');
      setCheckMessage('Введите URL потока');
      return;
    }
    setCheckState('checking');
    setCheckMessage('Подключаюсь к камере (до 12 секунд)…');
    try {
      const r = await api.probeStream({
        url: streamForm.url,
        transport: streamForm.transport,
        sourceLogin: streamForm.sourceLogin,
        sourcePassword: streamForm.sourcePassword,
        streamId: editingStream?.id,
      });
      if (!r.ok) {
        setCheckState('error');
        setCheckMessage('✗ Видео не получено. Проверьте адрес, логин/пароль и доступность камеры по сети.');
      } else if (r.warning) {
        setCheckState('warning');
        setCheckMessage(`⚠ Поток получен (${r.tracks.join(', ')}). ${r.warning}`);
      } else {
        setCheckState('success');
        setCheckMessage(`✓ Поток получен: ${r.tracks.join(', ') || 'дорожки определены'}`);
      }
    } catch (err) {
      setCheckState('error');
      setCheckMessage(`✗ ${errorMessage(err)}`);
    }
  };

  const handleDeleteStream = (stream: Stream) => {
    if (!confirm(`Удалить поток «${stream.name}»?`)) return;
    run(() => api.deleteStream(stream.id), `Поток «${stream.name}» удалён`, 'info');
  };

  const handleToggleStream = (stream: Stream) => {
    run(
      () => api.updateStream(stream.id, { isActive: !stream.isActive }),
      `Поток «${stream.name}» ${stream.isActive ? 'отключён' : 'включён'}`,
      stream.isActive ? 'warning' : 'success',
    );
  };

  const toggleExpand = (computerId: string) => {
    const next = new Set(expandedComputers);
    if (next.has(computerId)) next.delete(computerId);
    else next.add(computerId);
    setExpandedComputers(next);
  };

  const startEditStream = (computerId: string, stream: Stream) => {
    setStreamForm({
      name: stream.name, url: stream.url, transport: stream.transport,
      sourceLogin: stream.sourceLogin, sourcePassword: '',
    });
    setEditingStream(stream);
    setShowStreamForm(computerId);
    setCheckState('idle');
    setCheckMessage('');
  };

  const totalStreams = computers.reduce((sum, c) => sum + c.streams.length, 0);
  const onlineStreams = computers.reduce((sum, c) => sum + c.streams.filter((s) => s.status === 'online').length, 0);
  const detected = protocolFromUrl(streamForm.url);
  const inputCls = 'w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 transition-all';

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-400" />
            Компьютеры
          </h2>
          <p className="text-sm text-gray-500">
            {computers.length} компьютеров • {onlineStreams}/{totalStreams} потоков в сети
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          onClick={() => setShowComputerForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-medium rounded-xl transition-all shadow-lg shadow-blue-500/20"
        >
          <Plus className="w-4 h-4" />
          Добавить компьютер
        </motion.button>
      </motion.div>

      {error && (
        <div className="p-3 rounded-xl bg-red-950/40 border border-red-700/40 text-red-300 text-sm">{error}</div>
      )}

      <StaggerContainer className="space-y-3">
        {computers.map((computer) => {
          const isExpanded = expandedComputers.has(computer.id);
          return (
            <StaggerItem key={computer.id}>
              <AnimatedCard className="overflow-hidden">
                <div className="p-4 flex items-center gap-3">
                  <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                    onClick={() => toggleExpand(computer.id)}
                    className="p-1 rounded-lg hover:bg-gray-800 text-gray-400"
                  >
                    {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                  </motion.button>
                  <div className={`w-3 h-3 rounded-full ${STATUS_DOT[computer.status]}`} title={STATUS_LABEL[computer.status]} />
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpand(computer.id)}>
                    <h3 className="text-sm font-medium text-white">{computer.name}</h3>
                    <p className="text-xs text-gray-500 font-mono">
                      {[computer.hostname, computer.ip].filter(Boolean).join(' • ')}
                      {(computer.hostname || computer.ip) ? ' • ' : ''}{computer.streams.length} потоков
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <motion.button whileHover={{ scale: 1.2 }} whileTap={{ scale: 0.9 }}
                      onClick={() => handleToggleComputer(computer)} disabled={saving}
                      title={computer.isActive ? 'Отключить' : 'Включить'}
                      className={`p-1.5 rounded-lg transition-all ${computer.isActive ? 'text-green-400 hover:bg-green-950/30' : 'text-gray-500 hover:bg-gray-800'}`}
                    >
                      <Power className="w-4 h-4" />
                    </motion.button>
                    <motion.button whileHover={{ scale: 1.2 }} whileTap={{ scale: 0.9 }}
                      onClick={() => {
                        setComputerForm({ name: computer.name, hostname: computer.hostname, ip: computer.ip, description: computer.description });
                        setEditingComputer(computer);
                        setShowComputerForm(true);
                      }}
                      title="Изменить"
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-800 transition-all"
                    >
                      <Edit2 className="w-4 h-4" />
                    </motion.button>
                    <motion.button whileHover={{ scale: 1.2, rotate: 10 }} whileTap={{ scale: 0.9 }}
                      onClick={() => handleDeleteComputer(computer)} disabled={saving}
                      title="Удалить"
                      className="p-1.5 rounded-lg text-red-400 hover:bg-red-950/30 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </motion.button>
                  </div>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }}
                      className="border-t border-gray-800/50 overflow-hidden"
                    >
                      <div className="p-4 space-y-2">
                        {computer.description && <p className="text-xs text-gray-500 mb-3">{computer.description}</p>}
                        {computer.streams.map((stream) => (
                          <div key={stream.id}
                            className="flex items-center gap-3 p-2.5 bg-gray-800/30 rounded-lg border border-gray-700/30 group hover:border-blue-500/30 transition-all"
                          >
                            <div className={`w-2 h-2 rounded-full ${STATUS_DOT[stream.status]}`} title={STATUS_LABEL[stream.status]} />
                            <Radio className="w-4 h-4 text-purple-400" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-xs font-medium text-white">{stream.name}</p>
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-950/50 text-purple-400 border border-purple-700/30 uppercase">
                                  {stream.protocol}{stream.protocol === 'rtsp' && stream.transport !== 'auto' ? ` / ${stream.transport}` : ''}
                                </span>
                                {stream.tracks.length > 0 && (
                                  <span className="text-[9px] text-gray-400">{stream.tracks.join(', ')}</span>
                                )}
                                {stream.viewers > 0 && (
                                  <span className="text-[9px] text-blue-300 flex items-center gap-0.5"><Eye className="w-2.5 h-2.5" />{stream.viewers}</span>
                                )}
                                <span className="text-[9px] text-gray-500">{STATUS_LABEL[stream.status]}</span>
                              </div>
                              <p className="text-[10px] text-gray-500 font-mono truncate">
                                {stream.url}{stream.sourceLogin ? ` (логин: ${stream.sourceLogin})` : ''}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleToggleStream(stream)} disabled={saving}
                                title={stream.isActive ? 'Отключить' : 'Включить'}
                                className={`p-1 rounded ${stream.isActive ? 'text-green-400' : 'text-gray-500'}`}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => startEditStream(computer.id, stream)} title="Изменить"
                                className="p-1 rounded text-gray-400 hover:bg-gray-700"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleDeleteStream(stream)} disabled={saving} title="Удалить"
                                className="p-1 rounded text-red-400 hover:bg-red-950/30"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                          onClick={() => {
                            setStreamForm(emptyStream);
                            setEditingStream(null);
                            setShowStreamForm(computer.id);
                          }}
                          className="w-full py-2 px-3 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 text-xs font-medium rounded-lg transition-all border border-blue-500/20 flex items-center justify-center gap-2"
                        >
                          <Plus className="w-3 h-3" />
                          Добавить поток
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

      {data && computers.length === 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-16 text-gray-500">
          <Server className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="text-lg">Нет настроенных компьютеров</p>
          <p className="text-sm mt-1">Добавьте компьютер, затем подключите к нему камеры</p>
        </motion.div>
      )}

      {/* Форма компьютера */}
      <AnimatePresence>
        {showComputerForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
              className="glass-strong rounded-2xl w-full max-w-md p-6 relative overflow-hidden"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Monitor className="w-5 h-5 text-blue-400" />
                  {editingComputer ? 'Редактировать компьютер' : 'Новый компьютер'}
                </h3>
                <button onClick={resetComputerForm} className="p-1.5 rounded-xl hover:bg-gray-800 text-gray-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Название</label>
                  <input type="text" value={computerForm.name} autoFocus
                    onChange={(e) => setComputerForm({ ...computerForm, name: e.target.value })}
                    className={inputCls} placeholder="КПП-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-gray-300 mb-1.5">Hostname</label>
                    <input type="text" value={computerForm.hostname}
                      onChange={(e) => setComputerForm({ ...computerForm, hostname: e.target.value })}
                      className={`${inputCls} font-mono`} placeholder="kpp1-server"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1.5">IP-адрес</label>
                    <input type="text" value={computerForm.ip}
                      onChange={(e) => setComputerForm({ ...computerForm, ip: e.target.value })}
                      className={`${inputCls} font-mono`} placeholder="192.168.1.10"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Описание</label>
                  <textarea value={computerForm.description} rows={2}
                    onChange={(e) => setComputerForm({ ...computerForm, description: e.target.value })}
                    className={`${inputCls} resize-none`} placeholder="Описание…"
                  />
                </div>
                <p className="text-[11px] text-gray-500">
                  Компьютер — это группа камер (объект, пост, участок). Камеры добавляются к нему как потоки.
                </p>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={resetComputerForm}
                  className="flex-1 py-2.5 px-4 bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 text-sm rounded-xl transition-all border border-gray-700/50"
                >
                  Отмена
                </button>
                <button onClick={handleSaveComputer} disabled={saving}
                  className="flex-1 py-2.5 px-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editingComputer ? 'Сохранить' : 'Добавить'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Форма потока */}
      <AnimatePresence>
        {showStreamForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
              className="glass-strong rounded-2xl w-full max-w-lg p-6 relative overflow-hidden max-h-[92vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Video className="w-5 h-5 text-purple-400" />
                  {editingStream ? 'Редактировать поток' : 'Новый поток'}
                </h3>
                <button onClick={resetStreamForm} className="p-1.5 rounded-xl hover:bg-gray-800 text-gray-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Название потока</label>
                  <input type="text" value={streamForm.name} autoFocus
                    onChange={(e) => setStreamForm({ ...streamForm, name: e.target.value })}
                    className={inputCls} placeholder="Камера въезда"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">
                    URL потока
                    {streamForm.url && (
                      <span className={`ml-2 text-xs ${detected ? 'text-green-400' : 'text-red-400'}`}>
                        ({detected || 'неизвестный протокол'})
                      </span>
                    )}
                  </label>
                  <input type="text" value={streamForm.url}
                    onChange={(e) => { setStreamForm({ ...streamForm, url: e.target.value }); setCheckState('idle'); setCheckMessage(''); }}
                    className={`${inputCls} font-mono`}
                    placeholder="rtsp://192.168.1.64:554/Streaming/Channels/101"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Поддерживаются rtsp://, rtsps://, rtmp://, http(s):// (HLS), srt://, udp://. Логин и пароль можно указать в URL — они будут перенесены в поля ниже.
                  </p>
                </div>
                {detected === 'RTSP' && (
                  <div>
                    <label className="block text-sm text-gray-300 mb-1.5">Транспорт RTSP</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['auto', 'tcp', 'udp'] as StreamTransport[]).map((t) => (
                        <button key={t} onClick={() => setStreamForm({ ...streamForm, transport: t })}
                          className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                            streamForm.transport === t
                              ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg'
                              : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
                          }`}
                        >
                          {t === 'auto' ? 'Авто' : t.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1">TCP надёжнее через маршрутизаторы и межсетевые экраны.</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-gray-300 mb-1.5">Логин камеры</label>
                    <input type="text" value={streamForm.sourceLogin} autoComplete="off"
                      onChange={(e) => setStreamForm({ ...streamForm, sourceLogin: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1.5">Пароль камеры</label>
                    <input type="password" value={streamForm.sourcePassword} autoComplete="new-password"
                      onChange={(e) => setStreamForm({ ...streamForm, sourcePassword: e.target.value })}
                      className={inputCls}
                      placeholder={editingStream?.hasPassword ? 'не менять' : ''}
                    />
                  </div>
                </div>
                <div>
                  <button onClick={checkStream} disabled={checkState === 'checking' || !streamForm.url}
                    className="text-xs px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg transition-all disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {checkState === 'checking' && <Loader2 className="w-3 h-3 animate-spin" />}
                    {checkState === 'checking' ? 'Проверка…' : 'Проверить подключение к камере'}
                  </button>
                  {checkMessage && (
                    <div className={`mt-2 p-2 rounded-lg text-xs ${
                      checkState === 'success' ? 'bg-green-950/30 text-green-400 border border-green-700/30' :
                      checkState === 'error' ? 'bg-red-950/30 text-red-400 border border-red-700/30' :
                      checkState === 'warning' ? 'bg-yellow-950/30 text-yellow-400 border border-yellow-700/30' :
                      'bg-blue-950/30 text-blue-400 border border-blue-700/30'
                    }`}>
                      {checkMessage}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={resetStreamForm}
                  className="flex-1 py-2.5 px-4 bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 text-sm rounded-xl transition-all border border-gray-700/50"
                >
                  Отмена
                </button>
                <button onClick={() => handleSaveStream(showStreamForm)} disabled={saving}
                  className="flex-1 py-2.5 px-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editingStream ? 'Сохранить' : 'Добавить'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
