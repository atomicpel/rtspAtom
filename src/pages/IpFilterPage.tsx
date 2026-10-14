import React, { useState } from 'react';
import { Plus, Trash2, X, Check, Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { IpRule } from '../lib/types';
import { getIpRules, saveIpRules, generateId } from '../lib/storage';
import { validateCidr } from '../lib/ip-check';
import { logger } from '../lib/logger';

export function IpFilterPage() {
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
  };

  const handleDelete = (rule: IpRule) => {
    if (!confirm(`Удалить правило ${rule.cidr}?`)) return;
    const updated = rules.filter(r => r.id !== rule.id);
    saveIpRules(updated);
    setRules(updated);
    logger.admin(`IP-правило удалено: ${rule.cidr}`);
  };

  const whiteRules = rules.filter(r => r.type === 'white');
  const blackRules = rules.filter(r => r.type === 'black');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">IP-фильтр</h2>
          <p className="text-sm text-gray-500">Белый и чёрный списки IP/CIDR</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Добавить правило
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-green-950/50 text-green-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm text-gray-400">Белый список</p>
            <p className="text-xl font-bold text-white">{whiteRules.length} правил</p>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-red-950/50 text-red-400">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm text-gray-400">Чёрный список</p>
            <p className="text-xl font-bold text-white">{blackRules.length} правил</p>
          </div>
        </div>
      </div>

      {/* Rules List */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-800">
          <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Все правила (по приоритету)
          </h3>
        </div>
        {rules.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Shield className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>Нет правил. По умолчанию все IP разрешены.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {rules.map(rule => (
              <div key={rule.id} className="flex items-center gap-4 p-4 hover:bg-gray-800/30">
                <div className={`px-2 py-0.5 rounded text-xs font-medium ${
                  rule.type === 'white' ? 'bg-green-950/50 text-green-400' : 'bg-red-950/50 text-red-400'
                }`}>
                  {rule.type === 'white' ? 'БЕЛЫЙ' : 'ЧЁРНЫЙ'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-white">{rule.cidr}</p>
                  <p className="text-xs text-gray-500">{rule.comment}</p>
                </div>
                <div className="text-xs text-gray-500">
                  Приоритет: {rule.priority}
                </div>
                <button
                  onClick={() => handleDelete(rule)}
                  className="p-1.5 rounded-lg text-red-400 hover:bg-red-950/30 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Новое IP-правило</h3>
              <button onClick={() => { setShowForm(false); setError(''); }} className="p-1 rounded hover:bg-gray-800 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="p-3 mb-4 rounded-lg bg-red-950/50 border border-red-900/50 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Тип</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setForm({...form, type: 'white'})}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                      form.type === 'white' ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    Белый список
                  </button>
                  <button
                    onClick={() => setForm({...form, type: 'black'})}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                      form.type === 'black' ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    Чёрный список
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">CIDR</label>
                <input
                  type="text"
                  value={form.cidr}
                  onChange={e => setForm({...form, cidr: e.target.value})}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                  placeholder="192.168.1.0/24"
                />
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
              <div>
                <label className="block text-sm text-gray-300 mb-1">Комментарий</label>
                <input
                  type="text"
                  value={form.comment}
                  onChange={e => setForm({...form, comment: e.target.value})}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Описание правила"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowForm(false); setError(''); }} className="flex-1 py-2 px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors">
                Отмена
              </button>
              <button onClick={handleSave} className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2">
                <Check className="w-4 h-4" />
                Добавить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
