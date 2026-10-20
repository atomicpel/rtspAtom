import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, HardDrive, Loader2, RotateCw } from 'lucide-react';
import type { ArchiveDirCheck, ArchiveDisk, ArchiveInfo, ArchiveRecordsMode } from '../lib/types';
import { ApiError, api, errorMessage } from '../lib/api';
import { fmtBytes } from '../lib/archiveTime';
import type { Platform } from '../lib/platform';
import { Button, Modal, Notice, inputCls } from './ui';

const GB = 1024 ** 3;

/** Папка, которую предложить на выбранном диске. */
function suggestFor(d: ArchiveDisk, platform: Platform) {
  if (platform === 'windows') return `${d.mount.replace(/[\\/]+$/, '')}\\RTSPAtom-archive`;
  return d.system ? '/srv/rtspatom-archive' : `${d.mount.replace(/\/+$/, '')}/rtspatom-archive`;
}

function FixCommands({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // по http (не localhost) буфер обмена недоступен — копируем через выделение
      ref.current?.select();
      try { document.execCommand('copy'); } catch { return; }
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <div className="relative mt-2">
      <textarea ref={ref} readOnly value={text} rows={text.split('\n').length} aria-label="Команды для сервера"
        onFocus={(e) => e.target.select()}
        className="w-full resize-none rounded-md bg-ink border border-line px-3 py-2 pr-11 font-mono text-[12.5px] text-fg leading-relaxed" />
      <button type="button" onClick={copy} title="Скопировать" aria-label="Скопировать команды"
        className="absolute top-1.5 right-1.5 w-8 h-8 inline-flex items-center justify-center rounded-md text-muted hover:text-fg hover:bg-raised">
        {done ? <Check className="w-4 h-4 text-ok" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}

export function ArchiveDirDialog({ open, onClose, arch, minFreeGb, platform, onChanged }: {
  open: boolean;
  onClose: () => void;
  arch: ArchiveInfo;
  minFreeGb: number;
  platform: Platform;
  onChanged: (dir: string) => void;
}) {
  const [input, setInput] = useState('');
  const [disks, setDisks] = useState<ArchiveDisk[] | null>(null);
  const [check, setCheck] = useState<(ArchiveDirCheck & { input: string }) | null>(null);
  const [checking, setChecking] = useState(false);
  const [records, setRecords] = useState<ArchiveRecordsMode>('move');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fix?: string } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!open) return;
    setInput('');
    setCheck(null);
    setError(null);
    setRecords('move');
    api.archiveDisks().then(setDisks).catch(() => setDisks([]));
  }, [open]);

  // проверка при вводе (с паузой), сервер при этом ничего не создаёт
  useEffect(() => {
    if (!open) return;
    const value = input.trim();
    if (!value) { setCheck(null); return; }
    setChecking(true);
    let alive = true;
    const t = setTimeout(() => {
      api.checkArchiveDir(value)
        .then((c) => { if (alive) setCheck({ ...c, input: value }); })
        .catch((err) => { if (alive) setCheck({ ok: false, problem: errorMessage(err), input: value }); })
        .finally(() => { if (alive) setChecking(false); });
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [input, open, nonce]);

  const total = arch.totalBytes;
  const fresh = check && check.input === input.trim() && !checking;
  const otherDisk = check?.sameFs === false;
  const moveTooBig = !!(otherDisk && check?.free != null && total > check.free - minFreeGb * GB);
  useEffect(() => { if (moveTooBig && records === 'move') setRecords('keep'); }, [moveTooBig]); // eslint-disable-line react-hooks/exhaustive-deps
  const canApply = !!(fresh && check?.ok && !check.current && !busy && !(records === 'move' && moveTooBig));
  const looksLikeMount = platform !== 'windows' && check?.ok && check.systemDisk && /^\/(mnt|media|data|srv)\//.test(check.path || '');

  const apply = async () => {
    if (!check?.path) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.setArchiveDir(check.path, total > 0 ? records : 'keep');
      onChanged(r.dir);
      onClose();
    } catch (err) {
      setError({ message: errorMessage(err), fix: err instanceof ApiError ? err.data?.fix : undefined });
    } finally {
      setBusy(false);
    }
  };

  const option = (v: ArchiveRecordsMode, title: string, desc: React.ReactNode, disabled = false) => (
    <label className={`flex gap-3 p-3 rounded-md border cursor-pointer transition-colors ${records === v ? 'border-steel bg-raised/60' : 'border-line hover:bg-raised/40'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <input type="radio" name="records" value={v} checked={records === v} disabled={disabled}
        onChange={() => setRecords(v)} className="mt-1 accent-[var(--color-steel)]" />
      <span className="min-w-0">
        <span className="block text-sm text-fg">{title}</span>
        <span className="block text-[12.5px] text-muted mt-0.5">{desc}</span>
      </span>
    </label>
  );

  return (
    <Modal open={open} onClose={onClose} title="Папка архива" wide
      footer={<>
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button variant="primary" busy={busy} disabled={!canApply} onClick={apply}>Сменить папку</Button>
      </>}>
      <div className="space-y-5">
        <div className="text-[13px] text-muted">
          Сейчас: <span className="font-mono text-fg break-all">{arch.dir}</span>
        </div>

        <div>
          <label className="block text-[13px] text-muted mb-1.5" htmlFor="archive-dir-input">Новая папка на сервере</label>
          <input id="archive-dir-input" autoFocus className={`${inputCls} font-mono text-[13px]`} value={input}
            spellCheck={false} autoComplete="off"
            placeholder={platform === 'windows' ? 'D:\\RTSPAtom-archive' : '/srv/archive'}
            onChange={(e) => setInput(e.target.value)} />
        </div>

        {disks && disks.length > 0 && (
          <div>
            <div className="text-[13px] text-muted mb-1.5">Диски сервера — щёлкните, чтобы подставить папку</div>
            <div className="border border-line rounded-md divide-y divide-line overflow-hidden">
              {disks.map((d) => (
                <button key={d.mount} type="button" onClick={() => setInput(suggestFor(d, platform))}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-raised/60 transition-colors">
                  <HardDrive className="w-4 h-4 text-muted shrink-0" />
                  <span className="font-mono text-[13px] text-fg truncate">{d.mount}</span>
                  {d.device && <span className="text-xs text-muted truncate hidden sm:inline">{d.device}</span>}
                  {d.system && <span className="text-[11px] px-1.5 py-0.5 rounded bg-raised text-muted shrink-0">системный</span>}
                  <span className="ml-auto text-xs text-muted tabular shrink-0">свободно {fmtBytes(d.free)} из {fmtBytes(d.size)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {input.trim() && (
          <div aria-live="polite" className="min-h-[1.5rem]">
            {checking || !fresh ? (
              <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Проверяю папку…</p>
            ) : check?.ok ? (
              <div className="space-y-1.5 text-[13px]">
                {check.current ? (
                  <p className="text-muted">Это и есть текущая папка архива.</p>
                ) : (
                  <p className="flex items-center gap-2 text-ok"><Check className="w-4 h-4" /> Папка подходит{check.exists ? '' : ' — её создаст панель'}</p>
                )}
                <p className="text-muted">
                  Диск: {check.device ? <>{check.device} </> : null}{check.mount && <span className="font-mono">({check.mount})</span>}
                  {check.systemDisk && ' — системный'}
                  {check.free != null && check.size != null && <>, свободно {fmtBytes(check.free)} из {fmtBytes(check.size)}</>}
                </p>
                {looksLikeMount && (
                  <Notice tone="warn">Папка сейчас на системном диске. Если здесь должен быть отдельный диск — он не подключён: проверьте <span className="font-mono">lsblk</span> и строку в <span className="font-mono">/etc/fstab</span>.</Notice>
                )}
                {!!check.streamDirs && <p className="text-muted">В папке уже есть записи камер ({check.streamDirs}) — записи камер этой панели появятся в архиве.</p>}
                {!!check.entries && <p className="text-muted">В папке есть другие файлы ({check.entries}) — панель их не трогает.</p>}
              </div>
            ) : check ? (
              <div>
                <Notice tone="error">{check.problem}</Notice>
                {check.fix && (
                  <div className="mt-2 text-[13px] text-muted">
                    Выполните на сервере{platform === 'windows' ? ' (командная строка от имени администратора)' : ''} и проверьте ещё раз:
                    <FixCommands text={check.fix} />
                    <Button className="mt-2" icon={RotateCw} onClick={() => setNonce((n) => n + 1)}>Проверить ещё раз</Button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {total > 0 && fresh && check?.ok && !check.current && (
          <div>
            <div className="text-[13px] text-muted mb-1.5">Что сделать с уже записанным ({fmtBytes(total)})</div>
            <div className="space-y-2">
              {option('move', 'Перенести в новую папку',
                moveTooBig
                  ? `Не хватит места: свободно ${fmtBytes(check.free || 0)}, а ${minFreeGb} ГБ должно оставаться свободным.`
                  : otherDisk
                    ? 'Другой диск: записи копируются в фоне, это может занять время. Новые записи сразу идут в новую папку, ход переноса виден в настройках.'
                    : 'Тот же диск — перенос почти мгновенный.',
                moveTooBig)}
              {option('delete', 'Удалить старые записи', 'Архив начнётся заново в новой папке.')}
              {option('keep', 'Оставить в прежней папке', 'Их не будет видно на странице «Архив», и автоматически они удаляться не будут — удалите вручную, когда станут не нужны.')}
            </div>
          </div>
        )}

        {fresh && check?.ok && !check.current && (
          <Notice>Камеры переподключатся на несколько секунд; запись продолжится уже в новой папке. Будущие обновления выбранную папку сохранят.</Notice>
        )}

        {error && (
          <div>
            <Notice tone="error">{error.message}</Notice>
            {error.fix && <FixCommands text={error.fix} />}
          </div>
        )}
      </div>
    </Modal>
  );
}
