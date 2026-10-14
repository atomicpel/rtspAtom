import React, { useState } from 'react';
import { 
  Plus, Edit2, Trash2, UserCheck, UserX, Key, X, Check, Users as UsersIcon
} from 'lucide-react';
import { User, UserRole } from '../lib/types';
import { getUsers, saveUsers, generateId, hashPassword } from '../lib/storage';
import { logger } from '../lib/logger';

export function UsersPage() {
  const [users, setUsers] = useState<User[]>(getUsers());
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showPasswordChange, setShowPasswordChange] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [form, setForm] = useState({
    login: '', role: 'viewer' as UserRole, allowedCidrs: '', isActive: true
  });

  const resetForm = () => {
    setForm({ login: '', role: 'viewer', allowedCidrs: '', isActive: true });
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
        role: form.role,
        allowedCidrs: form.allowedCidrs.split(',').map(s => s.trim()).filter(Boolean),
        isActive: form.isActive,
      } : u);
      logger.admin(`Пользователь обновлён: ${form.login}`, form.login);
    } else {
      const newUser: User = {
        id: generateId(),
        login: form.login,
        passwordHash: hashPassword('password'), // Default password
        role: form.role,
        allowedCidrs: form.allowedCidrs.split(',').map(s => s.trim()).filter(Boolean),
        allowedStreams: [],
        isActive: form.isActive,
        createdAt: new Date().toISOString(),
      };
      updated = [...users, newUser];
      logger.admin(`Пользователь создан: ${form.login}`, form.login);
    }

    saveUsers(updated);
    setUsers(updated);
    resetForm();
  };

  const handleDelete = (user: User) => {
    if (user.login === 'admin') {
      alert('Нельзя удалить основного администратора');
      return;
    }
    if (!confirm(`Удалить пользователя "${user.login}"?`)) return;
    const updated = users.filter(u => u.id !== user.id);
    saveUsers(updated);
    setUsers(updated);
    logger.admin(`Пользователь удалён: ${user.login}`);
  };

  const handleToggleActive = (user: User) => {
    const updated = users.map(u => u.id === user.id ? { ...u, isActive: !u.isActive } : u);
    saveUsers(updated);
    setUsers(updated);
    logger.admin(`Пользователь ${user.isActive ? 'деактивирован' : 'активирован'}: ${user.login}`, user.login);
  };

  const handleChangePassword = (userId: string) => {
    if (!newPassword || newPassword.length < 4) {
      alert('Пароль должен быть не менее 4 символов');
      return;
    }
    const updated = users.map(u => u.id === userId ? { ...u, passwordHash: hashPassword(newPassword) } : u);
    saveUsers(updated);
    setUsers(updated);
    setShowPasswordChange(null);
    setNewPassword('');
    logger.admin(`Пароль изменён для: ${users.find(u => u.id === userId)?.login}`);
  };

  const startEdit = (user: User) => {
    setForm({
      login: user.login,
      role: user.role,
      allowedCidrs: user.allowedCidrs.join(', '),
      isActive: user.isActive,
    });
    setEditingUser(user);
    setShowForm(true);
  };

  const getRoleLabel = (role: UserRole) => {
    switch (role) {
      case 'admin': return 'Администратор';
      case 'operator': return 'Оператор';
      case 'viewer': return 'Наблюдатель';
    }
  };

  const getRoleColor = (role: UserRole) => {
    switch (role) {
      case 'admin': return 'bg-red-950/50 text-red-400 border-red-900/50';
      case 'operator': return 'bg-blue-950/50 text-blue-400 border-blue-900/50';
      case 'viewer': return 'bg-gray-800 text-gray-400 border-gray-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Пользователи</h2>
          <p className="text-sm text-gray-500">Управление учётными записями и доступом</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Добавить
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left p-3 text-gray-400 font-medium">Логин</th>
                <th className="text-left p-3 text-gray-400 font-medium">Роль</th>
                <th className="text-left p-3 text-gray-400 font-medium">CIDR</th>
                <th className="text-left p-3 text-gray-400 font-medium">Статус</th>
                <th className="text-left p-3 text-gray-400 font-medium">Создан</th>
                <th className="text-right p-3 text-gray-400 font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-blue-600/30 flex items-center justify-center text-xs font-bold text-blue-400">
                        {user.login.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-white font-medium">{user.login}</span>
                    </div>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs border ${getRoleColor(user.role)}`}>
                      {getRoleLabel(user.role)}
                    </span>
                  </td>
                  <td className="p-3 text-gray-400 font-mono text-xs">
                    {user.allowedCidrs.join(', ') || '—'}
                  </td>
                  <td className="p-3">
                    <span className={`flex items-center gap-1.5 text-xs ${user.isActive ? 'text-green-400' : 'text-red-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${user.isActive ? 'bg-green-500' : 'bg-red-500'}`} />
                      {user.isActive ? 'Активен' : 'Отключён'}
                    </span>
                  </td>
                  <td className="p-3 text-gray-500 text-xs">
                    {new Date(user.createdAt).toLocaleDateString('ru-RU')}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleToggleActive(user)}
                        className={`p-1.5 rounded-lg transition-colors ${
                          user.isActive ? 'text-yellow-400 hover:bg-yellow-950/30' : 'text-green-400 hover:bg-green-950/30'
                        }`}
                        title={user.isActive ? 'Деактивировать' : 'Активировать'}
                      >
                        {user.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => { setShowPasswordChange(user.id); setNewPassword(''); }}
                        className="p-1.5 rounded-lg text-purple-400 hover:bg-purple-950/30 transition-colors"
                        title="Сменить пароль"
                      >
                        <Key className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => startEdit(user)}
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-800 transition-colors"
                        title="Редактировать"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {user.login !== 'admin' && (
                        <button
                          onClick={() => handleDelete(user)}
                          className="p-1.5 rounded-lg text-red-400 hover:bg-red-950/30 transition-colors"
                          title="Удалить"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">
                {editingUser ? 'Редактировать пользователя' : 'Новый пользователь'}
              </h3>
              <button onClick={resetForm} className="p-1 rounded hover:bg-gray-800 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Логин</label>
                <input
                  type="text"
                  value={form.login}
                  onChange={e => setForm({...form, login: e.target.value})}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  disabled={!!editingUser}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Роль</label>
                <select
                  value={form.role}
                  onChange={e => setForm({...form, role: e.target.value as UserRole})}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="admin">Администратор</option>
                  <option value="operator">Оператор</option>
                  <option value="viewer">Наблюдатель</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Разрешённые CIDR (через запятую)</label>
                <input
                  type="text"
                  value={form.allowedCidrs}
                  onChange={e => setForm({...form, allowedCidrs: e.target.value})}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                  placeholder="192.168.1.0/24, 10.0.0.0/8"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={form.isActive}
                  onChange={e => setForm({...form, isActive: e.target.checked})}
                  className="rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="isActive" className="text-sm text-gray-300">Активен</label>
              </div>
            </div>

            {!editingUser && (
              <p className="text-xs text-yellow-500 mt-3">
                Пароль по умолчанию: «password». Смените после создания.
              </p>
            )}

            <div className="flex gap-3 mt-6">
              <button onClick={resetForm} className="flex-1 py-2 px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors">
                Отмена
              </button>
              <button onClick={handleSave} className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2">
                <Check className="w-4 h-4" />
                {editingUser ? 'Сохранить' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password Change Modal */}
      {showPasswordChange && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Смена пароля</h3>
              <button onClick={() => setShowPasswordChange(null)} className="p-1 rounded hover:bg-gray-800 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 mb-4"
              placeholder="Новый пароль (мин. 4 символа)"
              autoFocus
            />
            <button
              onClick={() => handleChangePassword(showPasswordChange)}
              className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Сменить пароль
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
