import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, Edit2, Trash2, UserCheck, UserX, Key, X, Check, Users as UsersIcon, Shield, ShieldCheck
} from 'lucide-react';
import { User, UserRole } from '../lib/types';
import { getUsers, saveUsers, generateId, hashPassword, getComputers } from '../lib/storage';
import { logger } from '../lib/logger';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { AnimatedCard, StaggerContainer, StaggerItem } from '../components/AnimatedCard';

export function UsersPage() {
  const { toast } = useToast();
  const { refreshUser, user: currentUser } = useAuth();
  
  const [users, setUsers] = useState<User[]>(() => {
    const rawUsers = getUsers();
    return rawUsers.map(u => ({
      ...u,
      isAdmin: u.isAdmin ?? false,
      allowedComputerIds: u.allowedComputerIds ?? [],
      allowedCidrs: u.allowedCidrs ?? [],
    }));
  });
  
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showPasswordChange, setShowPasswordChange] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [form, setForm] = useState({
    login: '', 
    role: 'viewer' as UserRole, 
    isAdmin: false,
    allowedCidrs: '', 
    allowedComputerIds: [] as string[],
    isActive: true 
  });

  const allComputers = getComputers();

  const resetForm = () => {
    setForm({ login: '', role: 'viewer', isAdmin: false, allowedCidrs: '', allowedComputerIds: [], isActive: true });
    setEditingUser(null);
    setShowForm(false);
  };

  const handleSave = () => {
    if (!form.login) return;

    let updated: User[];
    if (editingUser) {
      updated = users.map(u => u.id === editingUser.id ? {
        ...u,
        login: form.login,
        role: form.isAdmin ? 'admin' : form.role,
        isAdmin: form.isAdmin,
        allowedCidrs: form.allowedCidrs.split(',').map(s => s.trim()).filter(Boolean),
        allowedComputerIds: form.allowedComputerIds,
        isActive: form.isActive,
      } : u);
      logger.admin(`Пользователь обновлён: ${form.login}`, form.login);
      toast('success', `Пользователь "${form.login}" обновлён`);
    } else {
      const newUser: User = {
        id: generateId(),
        login: form.login,
        passwordHash: hashPassword('password'),
        role: form.isAdmin ? 'admin' : form.role,
        isAdmin: form.isAdmin,
        allowedCidrs: form.allowedCidrs.split(',').map(s => s.trim()).filter(Boolean),
        allowedComputerIds: form.allowedComputerIds,
        isActive: form.isActive,
        createdAt: new Date().toISOString(),
      };
      updated = [...users, newUser];
      logger.admin(`Пользователь создан: ${form.login}`, form.login);
      toast('success', `Пользователь "${form.login}" создан`);
    }

    saveUsers(updated);
    setUsers(updated);
    if (editingUser?.id === currentUser?.id || (!editingUser && form.login === currentUser?.login)) {
      refreshUser();
    }
    resetForm();
  };

  const handleDelete = (user: User) => {
    if (user.login === 'admin') {
      toast('error', 'Нельзя удалить основного администратора');
      return;
    }
    if (!confirm(`Удалить пользователя "${user.login}"?`)) return;
    const updated = users.filter(u => u.id !== user.id);
    saveUsers(updated);
    setUsers(updated);
    logger.admin(`Пользователь удалён: ${user.login}`);
    toast('info', `Пользователь "${user.login}" удалён`);
  };

  const handleToggleActive = (user: User) => {
    const updated = users.map(u => u.id === user.id ? { ...u, isActive: !u.isActive } : u);
    saveUsers(updated);
    setUsers(updated);
    if (user.id === currentUser?.id) refreshUser();
    logger.admin(`Пользователь ${user.isActive ? 'деактивирован' : 'активирован'}: ${user.login}`, user.login);
    toast(user.isActive ? 'warning' : 'success', `Пользователь "${user.login}" ${user.isActive ? 'деактивирован' : 'активирован'}`);
  };

  const handleChangePassword = (userId: string) => {
    if (!newPassword || newPassword.length < 4) {
      toast('error', 'Пароль должен быть не менее 4 символов');
      return;
    }
    const updated = users.map(u => u.id === userId ? { ...u, passwordHash: hashPassword(newPassword) } : u);
    saveUsers(updated);
    setUsers(updated);
    setShowPasswordChange(null);
    setNewPassword('');
    logger.admin(`Пароль изменён для: ${users.find(u => u.id === userId)?.login}`);
    toast('success', 'Пароль успешно изменён');
  };

  const startEdit = (user: User) => {
    setForm({
      login: user.login,
      role: user.role,
      isAdmin: user.isAdmin ?? false,
      allowedCidrs: (user.allowedCidrs ?? []).join(', '),
      allowedComputerIds: user.allowedComputerIds ?? [],
      isActive: user.isActive,
    });
    setEditingUser(user);
    setShowForm(true);
  };

  const getRoleLabel = (user: User) => {
    if (user.isAdmin ?? false) return 'Администратор';
    switch (user.role) {
      case 'admin': return 'Администратор';
      case 'operator': return 'Оператор';
      case 'viewer': return 'Наблюдатель';
      default: return 'Наблюдатель';
    }
  };

  const getRoleColor = (user: User) => {
    if (user.isAdmin ?? false) return 'bg-gradient-to-r from-red-950/50 to-pink-950/50 text-red-400 border-red-700/50';
    switch (user.role) {
      case 'admin': return 'bg-gradient-to-r from-red-950/50 to-pink-950/50 text-red-400 border-red-700/50';
      case 'operator': return 'bg-gradient-to-r from-blue-950/50 to-cyan-950/50 text-blue-400 border-blue-700/50';
      case 'viewer': return 'bg-gray-800/50 text-gray-400 border-gray-700/50';
      default: return 'bg-gray-800/50 text-gray-400 border-gray-700/50';
    }
  };

  const toggleComputerAccess = (computerId: string) => {
    if (form.allowedComputerIds.includes(computerId)) {
      setForm({...form, allowedComputerIds: form.allowedComputerIds.filter(id => id !== computerId)});
    } else {
      setForm({...form, allowedComputerIds: [...form.allowedComputerIds, computerId]});
    }
  };

  return (
    <div className="space-y-6">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <UsersIcon className="w-5 h-5 text-blue-400" />
            Пользователи
          </h2>
          <p className="text-sm text-gray-500">Управление учётными записями, ролями и доступом к компьютерам</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-medium rounded-xl transition-all shadow-lg shadow-blue-500/20"
        >
          <Plus className="w-4 h-4" />
          Добавить
        </motion.button>
      </motion.div>

      <AnimatedCard className="overflow-hidden" delay={0.1}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800/50 bg-gray-800/20">
                <th className="text-left p-3 text-gray-400 font-medium">Логин</th>
                <th className="text-left p-3 text-gray-400 font-medium">Роль</th>
                <th className="text-left p-3 text-gray-400 font-medium">Доступ к компьютерам</th>
                <th className="text-left p-3 text-gray-400 font-medium">Статус</th>
                <th className="text-right p-3 text-gray-400 font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user, index) => (
                <motion.tr 
                  key={user.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="border-b border-gray-800/30 hover:bg-gray-800/20 transition-colors group"
                >
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <motion.div 
                        whileHover={{ scale: 1.1, rotate: 5 }}
                        className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-xs font-bold shadow-lg shadow-blue-500/20"
                      >
                        {user.login.charAt(0).toUpperCase()}
                      </motion.div>
                      <div>
                        <span className="text-white font-medium group-hover:text-blue-400 transition-colors">{user.login}</span>
                        {(user.isAdmin ?? false) && (
                          <span className="ml-2 text-[10px] bg-red-950/50 text-red-400 px-1.5 py-0.5 rounded border border-red-700/30">
                            ADMIN
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    <span className={`px-2.5 py-1 rounded-lg text-xs border ${getRoleColor(user)}`}>
                      {getRoleLabel(user)}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="text-xs text-gray-400">
                      {(user.isAdmin ?? false) || (user.allowedComputerIds?.length ?? 0) === 0 
                        ? 'Все компьютеры' 
                        : `${user.allowedComputerIds?.length ?? 0} компьютеров`}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className={`flex items-center gap-1.5 text-xs ${user.isActive ? 'text-green-400' : 'text-red-400'}`}>
                      <motion.span 
                        animate={{ scale: user.isActive ? [1, 1.3, 1] : 1 }}
                        transition={{ duration: 2, repeat: user.isActive ? Infinity : 0 }}
                        className={`w-2 h-2 rounded-full ${user.isActive ? 'bg-green-500 shadow-lg shadow-green-500/50' : 'bg-red-500'}`} 
                      />
                      {user.isActive ? 'Активен' : 'Отключён'}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <motion.button
                        whileHover={{ scale: 1.2 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleToggleActive(user)}
                        className={`p-1.5 rounded-lg transition-all ${
                          user.isActive ? 'text-yellow-400 hover:bg-yellow-950/30' : 'text-green-400 hover:bg-green-950/30'
                        }`}
                      >
                        {user.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.2 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => { setShowPasswordChange(user.id); setNewPassword(''); }}
                        className="p-1.5 rounded-lg text-purple-400 hover:bg-purple-950/30 transition-all"
                      >
                        <Key className="w-4 h-4" />
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.2 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => startEdit(user)}
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-800 transition-all"
                      >
                        <Edit2 className="w-4 h-4" />
                      </motion.button>
                      {user.login !== 'admin' && (
                        <motion.button
                          whileHover={{ scale: 1.2, rotate: 10 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => handleDelete(user)}
                          className="p-1.5 rounded-lg text-red-400 hover:bg-red-950/30 transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </motion.button>
                      )}
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </AnimatedCard>

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
              className="glass-strong rounded-2xl w-full max-w-lg p-6 relative overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 pointer-events-none" />
              <div className="flex items-center justify-between mb-5 relative">
                <h3 className="text-lg font-semibold text-white">
                  {editingUser ? 'Редактировать пользователя' : 'Новый пользователь'}
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
                  <label className="block text-sm text-gray-300 mb-1.5">Логин</label>
                  <input
                    type="text"
                    value={form.login}
                    onChange={e => setForm({...form, login: e.target.value})}
                    className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    disabled={!!editingUser}
                  />
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <label className="block text-sm text-gray-300 mb-1.5">Роль</label>
                    <select
                      value={form.role}
                      onChange={e => setForm({...form, role: e.target.value as UserRole})}
                      disabled={form.isAdmin}
                      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
                    >
                      <option value="admin">Администратор</option>
                      <option value="operator">Оператор</option>
                      <option value="viewer">Наблюдатель</option>
                    </select>
                  </div>
                  <div className="pt-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.isAdmin}
                        onChange={e => setForm({...form, isAdmin: e.target.checked})}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-300 flex items-center gap-1">
                        <ShieldCheck className="w-4 h-4 text-red-400" />
                        Права админа
                      </span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-300 mb-1.5">Разрешённые CIDR (через запятую)</label>
                  <input
                    type="text"
                    value={form.allowedCidrs}
                    onChange={e => setForm({...form, allowedCidrs: e.target.value})}
                    className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="192.168.1.0/24, 10.0.0.0/8"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-300 mb-1.5 flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Доступ к компьютерам
                    {!form.isAdmin && form.allowedComputerIds.length === 0 && (
                      <span className="text-xs text-green-400">(все компьютеры)</span>
                    )}
                  </label>
                  {form.isAdmin ? (
                    <p className="text-xs text-gray-500 bg-gray-800/30 p-3 rounded-xl border border-gray-700/30">
                      Администратор имеет доступ ко всем компьютерам
                    </p>
                  ) : (
                    <div className="bg-gray-800/30 border border-gray-700/30 rounded-xl p-3 space-y-2 max-h-48 overflow-y-auto">
                      {allComputers.length === 0 ? (
                        <p className="text-xs text-gray-500 text-center py-2">Нет компьютеров. Добавьте их на странице «Компьютеры»</p>
                      ) : (
                        allComputers.map(computer => (
                          <label key={computer.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-700/30 p-1.5 rounded-lg transition-colors">
                            <input
                              type="checkbox"
                              checked={form.allowedComputerIds.includes(computer.id)}
                              onChange={() => toggleComputerAccess(computer.id)}
                              className="rounded"
                            />
                            <span className="text-xs text-white">{computer.name}</span>
                            <span className="text-[10px] text-gray-500 ml-auto">{(computer.streams || []).length} потоков</span>
                          </label>
                        ))
                      )}
                      <p className="text-[10px] text-gray-500 pt-1 border-t border-gray-700/30">
                        Если ничего не выбрано — доступ ко всем компьютерам
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={form.isActive}
                    onChange={e => setForm({...form, isActive: e.target.checked})}
                    className="rounded"
                  />
                  <label htmlFor="isActive" className="text-sm text-gray-300">Активен</label>
                </div>
              </div>

              {!editingUser && (
                <p className="text-xs text-yellow-500 mt-3 bg-yellow-950/20 p-2 rounded-lg border border-yellow-700/30">
                  Пароль по умолчанию: «password». Смените после создания.
                </p>
              )}

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
                  {editingUser ? 'Сохранить' : 'Создать'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPasswordChange && (
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
              className="glass-strong rounded-2xl w-full max-w-sm p-6 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 pointer-events-none" />
              <div className="flex items-center justify-between mb-5 relative">
                <h3 className="text-lg font-semibold text-white">Смена пароля</h3>
                <motion.button 
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowPasswordChange(null)} 
                  className="p-1.5 rounded-xl hover:bg-gray-800 text-gray-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all mb-4"
                placeholder="Новый пароль (мин. 4 символа)"
                autoFocus
              />
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleChangePassword(showPasswordChange)}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-medium rounded-xl transition-all shadow-lg shadow-blue-500/20"
              >
                Сменить пароль
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
