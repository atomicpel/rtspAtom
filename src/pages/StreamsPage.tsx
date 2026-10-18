import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, GripVertical, Pencil, Plus, Trash2, Video } from 'lucide-react';
import type { Stream, StreamTransport } from '../lib/types';
import { api, errorMessage, protocolFromUrl } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useToast } from '../components/Toast';
import { VideoPlayer } from '../components/VideoPlayer';
import {
  Button, Empty, Field, IconButton, Modal, Notice, PageHeader, STATUS_TEXT, StatusDot, Toggle, inputCls,
} from '../components/ui';

const emptyForm = { name: '', description: '', url: '', transport: 'auto' as StreamTransport, sourceLogin: '', sourcePassword: '' };
type Check = { state: 'idle' | 'checking' | 'ok' | 'warn' | 'error'; text: string };

export function StreamsPage() {
  const { toast } = useToast();
  const { data, setData, reload, error } = usePolling(api.streams, 5000);
  const streams = data || [];

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Stream | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<Check>({ state: 'idle', text: '' });
  const [dragId, setDragId] = useState<string | null>(null);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setCheck({ state: 'idle', text: '' });
    setOpen(true);
  };

  const openEdit = (s: Stream) => {
    setEditing(s);
    setForm({ name: s.name, description: s.description, url: s.url, transport: s.transport, sourceLogin: s.sourceLogin, sourcePassword: '' });
    setCheck({ state: 'idle', text: '' });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      toast('error', 'Укажите название и адрес потока');
      return;
    }
    setBusy(true);
    try {
      if (editing) await api.updateStream(editing.id, form);
      else await api.createStream(form);
      toast('success', editing ? `Поток «${form.name}» сохранён` : `Поток «${form.name}» добавлен`);
      setOpen(false);
      reload();
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const probe = async () => {
    setCheck({ state: 'checking', text: 'Подключаюсь к камере, это займёт до 12 секунд' });
    try {
      const r = await api.probeStream({ ...form, streamId: editing?.id });
      if (!r.ok) setCheck({ state: 'error', text: 'Видео не получено. Проверьте адрес, логин и пароль, доступность камеры по сети.' });
      else if (r.warning) setCheck({ state: 'warn', text: `Видео получено (${r.tracks.join(', ')}). ${r.warning}` });
      else setCheck({ state: 'ok', text: `Видео получено: ${r.tracks.join(', ')}` });
    } catch (err) {
      setCheck({ state: 'error', text: errorMessage(err) });
    }
  };

  const toggle = async (s: Stream) => {
    setData((prev) => prev?.map((x) => (x.id === s.id ? { ...x, isActive: !s.isActive } : x)) || prev);
    try {
      await api.updateStream(s.id, { isActive: !s.isActive });
      reload();
    } catch (err) {
      toast('error', errorMessage(err));
      reload();
    }
  };

  const remove = async (s: Stream) => {
    if (!confirm(`Удалить поток «${s.name}»?`)) return;
    try {
      await api.deleteStream(s.id);
      toast('info', `Поток «${s.name}» удалён`);
      reload();
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  // Перетаскивание строк меняет порядок камер (он же — порядок автозаполнения стены)
  const onDropRow = async (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = streams.map((s) => s.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setData(ids.map((id) => streams.find((s) => s.id === id)!));
    setDragId(null);
    try {
      await api.reorderStreams(ids);
    } catch (err) {
      toast('error', errorMessage(err));
      reload();
    }
  };

  const detected = protocolFromUrl(form.url);
  const online = streams.filter((s) => s.status === 'online').length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader title="Потоки" sub={data ? `${streams.length} всего, в сети ${online}` : 'Загрузка'}>
        <Button variant="primary" icon={Plus} onClick={openNew}>Добавить поток</Button>
      </PageHeader>

      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}

      {data && streams.length === 0 ? (
        <Empty icon={Video} title="Потоков пока нет">
          Добавьте камеру по её RTSP-адресу — она сразу появится на видеостене.
        </Empty>
      ) : (
        <div className="border border-line rounded-lg overflow-hidden">
          <AnimatePresence initial={false}>
            {streams.map((s) => (
              <motion.div
                key={s.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: s.isActive ? 1 : 0.55 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                draggable
                onDragStart={() => setDragId(s.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDropRow(s.id)}
                className={`group flex items-center gap-3 px-3 py-3 border-b border-line last:border-b-0 bg-panel hover:bg-raised/60 transition-colors ${dragId === s.id ? 'opacity-40' : ''}`}
              >
                <GripVertical className="w-4 h-4 text-line-strong cursor-grab shrink-0" aria-hidden />
                <StatusDot status={s.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="font-bold truncate">{s.name}</span>
                    {s.description && <span className="text-[13px] text-muted truncate">{s.description}</span>}
                  </div>
                  <div className="text-[13px] text-muted truncate">
                    {STATUS_TEXT[s.status]}
                    {s.tracks.length > 0 && `, ${s.tracks.join(', ')}`}
                    {', '}{s.url}
                  </div>
                </div>
                {s.viewers > 0 && (
                  <span className="hidden sm:flex items-center gap-1 text-[13px] text-muted tabular" title="Смотрят сейчас">
                    <Eye className="w-3.5 h-3.5" /> {s.viewers}
                  </span>
                )}
                <Toggle checked={s.isActive} onChange={() => toggle(s)} />
                <IconButton icon={Pencil} label="Изменить" onClick={() => openEdit(s)} />
                <IconButton icon={Trash2} label="Удалить" onClick={() => remove(s)} className="hover:!text-alarm" />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
      {streams.length > 1 && <p className="text-[13px] text-muted mt-3">Порядок меняется перетаскиванием строк. В этом порядке камеры расставляются на видеостене.</p>}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Изменить поток' : 'Новый поток'} wide
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
          <Button variant="primary" busy={busy} onClick={save}>{editing ? 'Сохранить' : 'Добавить поток'}</Button>
        </>}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
          {editing?.isActive && (
            <div className="aspect-video bg-black rounded-md overflow-hidden">
              <VideoPlayer streamId={editing.id} name={editing.name} className="w-full h-full" />
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Название">
              <input className={inputCls} value={form.name} autoFocus placeholder="Въезд, ворота 1"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Примечание">
              <input className={inputCls} value={form.description} placeholder="Необязательно: место, объект"
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
          <Field label={detected ? `Адрес потока (${detected})` : 'Адрес потока'}
            hint="rtsp://, rtsps://, rtmp://, http(s):// (HLS), srt://, udp://. Логин и пароль из адреса перенесутся в поля ниже.">
            <input className={inputCls} value={form.url} placeholder="rtsp://192.168.1.64:554/Streaming/Channels/101"
              onChange={(e) => { setForm({ ...form, url: e.target.value }); setCheck({ state: 'idle', text: '' }); }} />
          </Field>
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Логин камеры">
              <input className={inputCls} value={form.sourceLogin} autoComplete="off"
                onChange={(e) => setForm({ ...form, sourceLogin: e.target.value })} />
            </Field>
            <Field label="Пароль камеры">
              <input type="password" className={inputCls} value={form.sourcePassword} autoComplete="new-password"
                placeholder={editing?.hasPassword ? 'без изменений' : ''}
                onChange={(e) => setForm({ ...form, sourcePassword: e.target.value })} />
            </Field>
            <Field label="Транспорт RTSP" hint="TCP надёжнее через маршрутизаторы">
              <select className={inputCls} value={form.transport} disabled={detected !== null && detected !== 'RTSP'}
                onChange={(e) => setForm({ ...form, transport: e.target.value as StreamTransport })}>
                <option value="auto">Автоматически</option>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
            </Field>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button type="button" busy={check.state === 'checking'} disabled={!form.url} onClick={probe}>Проверить подключение</Button>
            <AnimatePresence mode="wait">
              {check.text && (
                <motion.p key={check.state + check.text} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                  className={`text-[13px] flex-1 min-w-[200px] ${check.state === 'ok' ? 'text-ok' : check.state === 'warn' ? 'text-warn' : check.state === 'error' ? 'text-alarm' : 'text-muted'}`}>
                  {check.text}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Modal>
    </div>
  );
}
