import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import type { User, UserRole } from '../lib/types';
import { api, errorMessage } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { Button, Field, IconButton, Modal, PageHeader, Toggle, inputCls } from '../components/ui';

const ROLES: { id: UserRole; name: string; desc: string }[] = [
  { id: 'viewer', name: 'Наблюдатель', desc: 'смотрит видео' },
  { id: 'operator', name: 'Оператор', desc: 'смотрит видео и журнал' },
  { id: 'admin', name: 'Администратор', desc: 'полный доступ' },
];

const roleOf = (u: User): UserRole => (u.isAdmin ? 'admin' : u.role);
const emptyForm = { login: '', password: '', role: 'viewer' as UserRole, allowedCidrs: '', allowedStreamIds: [] as string[], isActive: true };

export function UsersPage() {
  const { toast } = useToast();
  const { user: me, refreshUser } = useAuth();
  const { data, reload } = usePolling(api.users);
  const users = data || [];
  const { data: streamsData } = usePolling(api.streams);
  const streams = streamsData || [];

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [pwFor, setPwFor] = useState<User | null>(null);
  const [newPw, setNewPw] = useState('');

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (u: User) => {
    setEditing(u);
    setForm({
      login: u.login, password: '', role: roleOf(u), allowedCidrs: u.allowedCidrs.join(', '),
      allowedStreamIds: u.allowedStreamIds.filter((id) => id !== '-'), isActive: u.isActive,
    });
    setOpen(true);
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      await reload();
      return true;
    } catch (err) {
      toast('error', errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const payload = {
      login: form.login.trim(),
      role: form.role,
      isAdmin: form.role === 'admin',
      allowedCidrs: form.allowedCidrs.split(',').map((s) => s.trim()).filter(Boolean),
      allowedStreamIds: form.allowedStreamIds,
      isActive: form.isActive,
    };
    if (!editing && form.password.length < 8) {
      toast('error', 'Пароль должен быть не короче 8 символов');
      return;
    }
    const ok = editing
      ? await run(() => api.updateUser(editing.id, payload), `Пользователь ${payload.login} сохранён`)
      : await run(() => api.createUser({ ...payload, password: form.password }), `Пользователь ${payload.login} добавлен`);
    if (ok) {
      if (editing?.id === me?.id) refreshUser();
      setOpen(false);
    }
  };

  const setPassword = async () => {
    if (!pwFor) return;
    if (newPw.length < 8) {
      toast('error', 'Пароль должен быть не короче 8 символов');
      return;
    }
    if (await run(() => api.setUserPassword(pwFor.id, newPw), `Пароль пользователя ${pwFor.login} изменён`)) {
      setPwFor(null);
      setNewPw('');
    }
  };

  const remove = (u: User) => {
    if (!confirm(`Удалить пользователя ${u.login}?`)) return;
    run(() => api.deleteUser(u.id), `Пользователь ${u.login} удалён`);
  };

  const accessText = (u: User) => {
    if (u.isAdmin || u.allowedStreamIds.length === 0) return 'Все камеры';
    const n = u.allowedStreamIds.filter((id) => streams.some((s) => s.id === id)).length;
    return n === 0 ? 'Нет доступа к камерам' : `Камер: ${n}`;
  };

  const toggleStream = (id: string) =>
    setForm((f) => ({
      ...f,
      allowedStreamIds: f.allowedStreamIds.includes(id) ? f.allowedStreamIds.filter((x) => x !== id) : [...f.allowedStreamIds, id],
    }));

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader title="Пользователи" sub="Кто может входить в панель и какие камеры видит">
        <Button variant="primary" icon={Plus} onClick={openNew}>Добавить пользователя</Button>
      </PageHeader>

      <div className="border border-line rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-line">
              <th className="font-normal px-4 py-2.5">Логин</th>
              <th className="font-normal px-4 py-2.5">Роль</th>
              <th className="font-normal px-4 py-2.5">Камеры</th>
              <th className="font-normal px-4 py-2.5">Последний вход</th>
              <th className="px-4 py-2.5"><span className="sr-only">Действия</span></th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {users.map((u) => (
                <motion.tr key={u.id} layout initial={{ opacity: 0 }} animate={{ opacity: u.isActive ? 1 : 0.5 }} exit={{ opacity: 0 }}
                  className="border-b border-line last:border-b-0 bg-panel hover:bg-raised/60">
                  <td className="px-4 py-3">
                    <span className="font-bold">{u.login}</span>
                    {u.id === me?.id && <span className="text-muted"> (вы)</span>}
                    {!u.isActive && <span className="text-muted">, отключён</span>}
                  </td>
                  <td className="px-4 py-3">{ROLES.find((r) => r.id === roleOf(u))?.name}</td>
                  <td className="px-4 py-3 text-muted">{accessText(u)}</td>
                  <td className="px-4 py-3 text-muted tabular">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ru-RU') : 'не входил'}</td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end">
                      <IconButton icon={KeyRound} label="Задать пароль" onClick={() => { setPwFor(u); setNewPw(''); }} />
                      <IconButton icon={Pencil} label="Изменить" onClick={() => openEdit(u)} />
                      {u.id !== me?.id && <IconButton icon={Trash2} label="Удалить" onClick={() => remove(u)} className="hover:!text-alarm" />}
                    </div>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Пользователь ${editing.login}` : 'Новый пользователь'} wide
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
          <Button variant="primary" busy={busy} onClick={save}>{editing ? 'Сохранить' : 'Добавить пользователя'}</Button>
        </>}>
        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Логин">
              <input className={inputCls} value={form.login} autoFocus onChange={(e) => setForm({ ...form, login: e.target.value })} />
            </Field>
            {!editing && (
              <Field label="Пароль" hint="Не короче 8 символов">
                <input type="password" autoComplete="new-password" className={inputCls} value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </Field>
            )}
          </div>

          <div>
            <span className="block text-[13px] text-muted mb-1.5">Роль</span>
            <div className="grid sm:grid-cols-3 gap-2">
              {ROLES.map((r) => (
                <button key={r.id} type="button" onClick={() => setForm({ ...form, role: r.id })} aria-pressed={form.role === r.id}
                  className={`text-left px-3 py-2.5 rounded-md border transition-colors ${form.role === r.id ? 'border-steel bg-steel/10' : 'border-line hover:border-line-strong'}`}>
                  <span className="block font-bold text-sm">{r.name}</span>
                  <span className="block text-[13px] text-muted">{r.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {form.role !== 'admin' && (
            <div>
              <span className="block text-[13px] text-muted mb-1.5">
                Доступные камеры{form.allowedStreamIds.length === 0 && ': не выбрано ни одной, значит доступны все'}
              </span>
              <div className="border border-line rounded-md max-h-52 overflow-y-auto divide-y divide-line">
                {streams.map((s) => (
                  <label key={s.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-raised">
                    <input type="checkbox" checked={form.allowedStreamIds.includes(s.id)} onChange={() => toggleStream(s.id)} />
                    <span className="truncate">{s.name}</span>
                    {s.description && <span className="text-[13px] text-muted truncate">{s.description}</span>}
                  </label>
                ))}
                {streams.length === 0 && <p className="px-3 py-3 text-muted text-sm">Потоков пока нет</p>}
              </div>
            </div>
          )}

          <Field label="Разрешённые адреса для входа" hint="Через запятую, например 192.168.1.0/24. Пусто — с любого адреса.">
            <input className={inputCls} value={form.allowedCidrs} placeholder="192.168.1.0/24"
              onChange={(e) => setForm({ ...form, allowedCidrs: e.target.value })} />
          </Field>

          <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Учётная запись активна" />
        </div>
      </Modal>

      <Modal open={!!pwFor} onClose={() => setPwFor(null)} title={`Новый пароль для ${pwFor?.login || ''}`}
        footer={<>
          <Button variant="ghost" onClick={() => setPwFor(null)}>Отмена</Button>
          <Button variant="primary" busy={busy} onClick={setPassword}>Задать пароль</Button>
        </>}>
        <form onSubmit={(e) => { e.preventDefault(); setPassword(); }}>
          <Field label="Пароль" hint="Не короче 8 символов. Все сеансы пользователя будут завершены.">
            <input type="password" autoComplete="new-password" className={inputCls} value={newPw} autoFocus
              onChange={(e) => setNewPw(e.target.value)} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
