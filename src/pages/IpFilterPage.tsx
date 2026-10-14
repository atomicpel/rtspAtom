import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, X, Check, Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { IpRule } from '../lib/types';
import { getIpRules, saveIpRules, generateId } from '../lib/storage';
import { validateCidr } from '../lib/ip-check';
import { logger } from '../lib/logger';
import { useToast } from '../components/Toast';
import { AnimatedCard, StaggerContainer, StaggerItem } from '../components/AnimatedCard';

export function IpFilterPage() {
  const { toast } = useToast();
  const [rules, setRules] = useState<IpRule[]>(getIpRules());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ cidr: '', type: 'white' as 'white' | 'black', priority: 1, comment: '' });
  const [error, setError] = useState('');

  const handleSave = () => {
    setError('');
    if (!form.cidr) { setError('Укажите CIDR'); return; }
    if (!validateCidr(form.cidr)) { setError('Неверный формат CIDR (пример: 192.168.1.0/24)'); return; }
    if (!form.comment) { setError('Добавьте комментарий'); return; }

    const newRule: IpRule = {
      id: generateId(),
      ...form,
      createdAt: new Date().toISOString(),
    };

    const updated = [...rules, newRule].sort((a, b) => a.priority - b.priority);
    saveIpRules(updated);
    setRules(updated);
    setForm({ cidr: '', type: 'white', priority: 1, comment: '' });
    setShowForm(false);
    logger.admin(`IP-правило добавлено: ${form.type} ${form.cidr}`);
    toast('success', `Правило ${form.cidr} добавлено`);
  };

  const handleDelete = (rule: IpRule) => {
    if (!confirm(`Удалить правило ${rule.cidr}?`)) return;
    const updated = rules.filter(r => r.id !== rule.id);
    saveIpRules(updated);
    setRules(updated);
    logger.admin(`IP-правило удалено: ${rule.cidr}`);
    toast('info', `Правило ${rule.cidr} удалено`);
  };

  const whiteRules = rules.filter(r => r.type === 'white');
  const blackRules = rules.filter(r => r.type === 'black');

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
            <Shield className="w-5 h-5 text-blue-400" />
            IP-фильтр
          </h2>
          <p className="text-sm text-gray-500">Белый и чёрный списки IP/CIDR</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-medium rounded-xl transition-all shadow-lg shadow-blue-500/20"
        >
          <motion.div whileHover={{ rotate: 90 }} transition={{ duration: 0.3 }}>
            <Plus className="w-4 h-4" />
          </motion.div>
          Добавить правило
        </motion.button>
      </motion.div>

      {/* Stats */}
      <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StaggerItem>
          <AnimatedCard className="p-4 flex items-center gap-3">
            <motion.div 
              whileHover={{ scale: 1.2, rotate: 10 }}
              className="p-2.5 rounded-xl bg-green-950/50 text-green-400"
            >
              <ShieldCheck className="w-5 h-5" />
            </motion.div>
            <div>
              <p className="text-sm text-gray-400">Белый список</p>
              <motion.p 
                key={whiteRules.length}
                initial={{ scale: 1.2 }}
                animate={{ scale: 1 }}
                className="text-xl font-bold text-white"
              >
                {whiteRules.length} правил
              </motion.p>
            </div>
          </AnimatedCard>
        </StaggerItem>
        <StaggerItem>
          <AnimatedCard className="p-4 flex items-center gap-3">
            <motion.div 
              whileHover={{ scale: 1.2, rotate: 10 }}
              className="p-2.5 rounded-xl bg-red-950/50 text-red-400"
            >
              <ShieldAlert className="w-5 h-5" />
            </motion.div>
            <div>
              <p className="text-sm text-gray-400">Чёрный список</p>
              <motion.p 
                key={blackRules.length}
                initial={{ scale: 1.2 }}
                animate={{ scale: 1 }}
                className="text-xl font-bold text-white"
              >
                {blackRules.length} правил
              </motion.p>
            </div>
          </AnimatedCard>
        </StaggerItem>
      </StaggerContainer>

      {/* Rules List */}
      <AnimatedCard className="overflow-hidden" delay={0.2}>
        <div className="p-4 border-b border-gray-800/50 bg-gray-800/20">
          <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Все правила (по приоритету)
          </h3>
        </div>
        {rules.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-8 text-center text-gray-500"
          >
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
            </motion.div>
            <p>Нет правил. По умолчанию все IP разрешены.</p>
          </motion.div>
        ) : (
          <StaggerContainer className="divide-y divide-gray-800/30">
            {rules.map((rule, index) => (
              <StaggerItem key={rule.id}>
                <motion.div 
                  whileHover={{ x: 4 }}
                  className="flex items-center gap-4 p-4 hover:bg-gray-800/20 transition-all group"
                >
                  <motion.div
                    whileHover={{ scale: 1.1 }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                      rule.type === 'white' ? 'bg-gradient-to-r from-green-950/50 to-emerald-950/50 text-green-400 border border-green-700/30' : 'bg-gradient-to-r from-red-950/50 to-pink-950/50 text-red-400 border border-red-700/30'
                    }`}
                  >
                    {rule.type === 'white' ? 'БЕЛЫЙ' : 'ЧЁРНЫЙ'}
                  </motion.div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono text-white group-hover:text-blue-400 transition-colors">{rule.cidr}</p>
                    <p className="text-xs text-gray-500">{rule.comment}</p>
                  </div>
                  <div className="text-xs text-gray-500 bg-gray-800/50 px-2 py-1 rounded-lg">
                    Приоритет: {rule.priority}
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.2, rotate: 10 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => handleDelete(rule)}
                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-950/30 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </motion.button>
                </motion.div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        )}
      </AnimatedCard>

      {/* Add Form Modal */}
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
                <h3 className="text-lg font-semibold text-white">Новое IP-правило</h3>
                <motion.button 
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => { setShowForm(false); setError(''); }} 
                  className="p-1.5 rounded-xl hover:bg-gray-800 text-gray-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              {error && (
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="p-3 mb-4 rounded-xl bg-red-950/50 border border-red-700/50 text-red-400 text-sm"
                >
                  {error}
                </motion.div>
              )}

              <div className="space-y-4 relative">
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Тип</label>
                  <div className="flex gap-3">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setForm({...form, type: 'white'})}
                      className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all ${
                        form.type === 'white' ? 'bg-gradient-to-r from-green-600 to-emerald-600 text-white shadow-lg shadow-green-500/20' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
                      }`}
                    >
                      Белый список
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setForm({...form, type: 'black'})}
                      className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all ${
                        form.type === 'black' ? 'bg-gradient-to-r from-red-600 to-pink-600 text-white shadow-lg shadow-red-500/20' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
                      }`}
                    >
                      Чёрный список
                    </motion.button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">CIDR</label>
                  <input
                    type="text"
                    value={form.cidr}
                    onChange={e => setForm({...form, cidr: e.target.value})}
                    className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="192.168.1.0/24"
                  />
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
                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Комментарий</label>
                  <input
                    type="text"
                    value={form.comment}
                    onChange={e => setForm({...form, comment: e.target.value})}
                    className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="Описание правила"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6 relative">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { setShowForm(false); setError(''); }}
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
                  Добавить
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
