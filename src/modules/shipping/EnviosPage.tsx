import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload, Send, Trash2, Loader2, CheckCircle, CheckCheck, AlertTriangle, Clock,
  QrCode, ScanText, UserCheck, UserX, X as XIcon, Eye, RotateCcw, History,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useToast } from '@/components/Toast';
import { usePermissions } from '@/hooks/usePermissions';
import { toWhatsappNumber } from '@/utils/phoneUtils';
import { toDate } from '@/utils/dateUtils';
import type { Client } from '@/types';
import { CARRIER_LABELS, type Carrier } from './guideParser';
import { readGuide, releaseReader, type ReadResult } from './guideReader';
import {
  AlreadySentError, findClientByCedula, listenNotifications, matchClient, notificationKey, resolveClient,
  searchClients, sendGuide,
  type ClientMatch, type NotificationStatus, type ShipmentNotification,
} from './shippingService';

type RowState = 'queued' | 'reading' | 'ready' | 'unreadable' | 'sending' | 'sent' | 'failed';

interface Row {
  id: string;
  file: File;
  state: RowState;
  step?: string;
  error?: string;
  selected: boolean;
  read?: ReadResult;
  carrier: Carrier;
  tracking: string;
  name: string;
  cedula: string;
  phone: string;
  destination: string;
  match: ClientMatch | null;
  showRaw?: boolean;
}

const STATUS_BADGE: Record<NotificationStatus, { cls: string; label: string; icon: JSX.Element }> = {
  sent: { cls: 'badge-blue', label: 'Enviado', icon: <CheckCircle size={11} /> },
  delivered: { cls: 'badge-teal', label: 'Entregado', icon: <CheckCheck size={11} /> },
  read: { cls: 'badge-green', label: 'Leído', icon: <CheckCheck size={11} /> },
  failed: { cls: 'badge-red', label: 'Falló', icon: <AlertTriangle size={11} /> },
};

/** Teléfono con el que se manda: el registrado del cliente (es su WhatsApp)
 *  si sirve; si no, el de la guía. */
function phoneFor(row: Pick<Row, 'phone' | 'match'>): string {
  const reg = row.match?.client.phone;
  return reg && toWhatsappNumber(reg) ? reg : row.phone;
}

function isSendable(r: Row): boolean {
  return (r.state === 'ready' || r.state === 'failed' || r.state === 'unreadable')
    && !!r.tracking && !!toWhatsappNumber(phoneFor(r)) && !!r.read?.imageBase64;
}

export function EnviosPage() {
  const { can } = usePermissions();
  if (!can('canAccessEnvios')) {
    return <div className="card p-12 text-center text-sm text-navy-400">No tienes permiso para enviar comprobantes.</div>;
  }
  return <EnviosPanel />;
}

function EnviosPanel() {
  const clients = useAppStore((s) => s.clients);
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [history, setHistory] = useState<ShipmentNotification[]>([]);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const processing = useRef(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const clientsRef = useRef(clients);
  clientsRef.current = clients;

  useEffect(() => listenNotifications(setHistory), []);
  useEffect(() => () => { void releaseReader(); }, []);

  const sentKeys = useMemo(
    () => new Map(history.filter((h) => h.status !== 'failed').map((h) => [h.id, h])),
    [history],
  );
  const sentKeysRef = useRef(sentKeys);
  sentKeysRef.current = sentKeys;

  function patch(id: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  /** Cambia un campo y re-cruza con clientes si tocó algo que sirve para eso. */
  function edit(id: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, ...p };
      // Un cliente elegido a mano no se pisa por corregir una letra del nombre.
      const touchesMatch = 'cedula' in p || 'name' in p || 'phone' in p;
      if (touchesMatch && r.match?.by !== 'manual') next.match = matchClient(next, clientsRef.current);
      return next;
    }));
    // Cédula escrita a mano que no está en memoria: se busca en Firestore.
    const ced = p.cedula;
    if (ced && ced.length >= 7) {
      void findClientByCedula(ced).then((m) => {
        if (!m) return;
        setRows((rs) => rs.map((r) => (
          r.id === id && r.cedula === ced && r.match?.by !== 'manual' && !r.match ? { ...r, match: m } : r
        )));
      });
    }
  }

  function addFiles(files: FileList | File[]) {
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    setRows((rs) => [...rs, ...imgs.map((file): Row => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file, state: 'queued', selected: true,
      carrier: 'OTRO', tracking: '', name: '', cedula: '', phone: '', destination: '', match: null,
    }))]);
    // Se procesa en el próximo tick, cuando las filas ya están en el estado.
    setTimeout(processQueue, 0);
  }

  /** Una foto a la vez: Tesseract en paralelo solo compite por el mismo CPU. */
  async function processQueue() {
    if (processing.current) return;
    processing.current = true;
    try {
      for (;;) {
        const next = rowsRef.current.find((r) => r.state === 'queued');
        if (!next) break;
        patch(next.id, { state: 'reading', step: 'Abriendo foto…' });
        try {
          const read = await readGuide(next.file, (step) => patch(next.id, { step }));
          patch(next.id, { step: 'Buscando al cliente…' });
          const match = await resolveClient(read, clientsRef.current);
          const dup = read.tracking && sentKeysRef.current.has(notificationKey(read.carrier, read.tracking));
          const ok = read.tracking && (read.name || match);
          patch(next.id, {
            state: ok ? 'ready' : 'unreadable',
            step: undefined,
            read,
            carrier: read.carrier, tracking: read.tracking, name: read.name,
            cedula: read.cedula, phone: read.phone, destination: read.destination,
            match,
            selected: !dup,
          });
        } catch (e) {
          patch(next.id, { state: 'unreadable', step: undefined, error: (e as Error).message });
        }
      }
    } finally {
      processing.current = false;
    }
  }

  async function sendSelected() {
    const batch = rowsRef.current.filter((r) => r.selected && isSendable(r));
    if (!batch.length) return;
    if (!confirm(`¿Enviar ${batch.length} comprobante${batch.length === 1 ? '' : 's'} por WhatsApp?`)) return;
    setSending(true);
    let ok = 0, fail = 0;
    for (const r of batch) {
      patch(r.id, { state: 'sending', error: undefined });
      try {
        const force = sentKeysRef.current.has(notificationKey(r.carrier, r.tracking));
        await sendGuide({
          carrier: r.carrier, tracking: r.tracking, name: r.match?.client.name || r.name,
          cedula: r.cedula, phone: phoneFor(r), destination: r.destination,
          clientId: r.match?.client.id ?? null, imageBase64: r.read!.imageBase64, force,
        });
        patch(r.id, { state: 'sent', selected: false });
        ok++;
      } catch (e) {
        const msg = e instanceof AlreadySentError ? 'Ya se había enviado.' : (e as Error).message;
        patch(r.id, { state: 'failed', error: msg });
        fail++;
      }
    }
    setSending(false);
    if (ok) toast.success(`${ok} comprobante${ok === 1 ? '' : 's'} enviado${ok === 1 ? '' : 's'}.`);
    if (fail) toast.error(`${fail} no se pudieron enviar. Revisa el detalle en la tabla.`);
  }

  function clearSent() {
    setRows((rs) => rs.filter((r) => r.state !== 'sent'));
  }

  const selectedCount = rows.filter((r) => r.selected && isSendable(r)).length;
  const reading = rows.some((r) => r.state === 'queued' || r.state === 'reading');

  return (
    <div className="space-y-6 animate-fade-up">
      {/* ── Encabezado ── */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-12 bg-emerald-500 rounded-full" />
            <div>
              <h1 className="text-xl font-display font-bold text-navy-900">Envíos por WhatsApp</h1>
              <p className="text-navy-400 text-sm">Sube las fotos de las guías (MRW, Zoom, Tealca) y manda el comprobante a cada cliente</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {rows.some((r) => r.state === 'sent') && (
              <button onClick={clearSent} className="btn-ghost text-sm"><Trash2 size={14} /> Quitar enviados</button>
            )}
            <button onClick={sendSelected} disabled={!selectedCount || sending || reading} className="btn-primary text-sm">
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Enviar {selectedCount ? `(${selectedCount})` : ''}
            </button>
          </div>
        </div>
      </div>

      {/* ── Carga ── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`card p-8 border-2 border-dashed cursor-pointer text-center transition-colors ${dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-surface-200 hover:border-emerald-300'}`}
      >
        <Upload size={32} className="mx-auto text-navy-300 mb-2" />
        <p className="text-sm font-semibold text-navy-700">Arrastra aquí las fotos de las guías o toca para elegirlas</p>
        <p className="text-xs text-navy-400 mt-1">
          Se leen en este equipo: el QR de MRW trae todos los datos; en Zoom y Tealca se lee el texto.
          Foto derecha, de cerca y sin brillo = mejor lectura.
        </p>
        <input ref={inputRef} type="file" accept="image/*" multiple hidden
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {/* ── Cola ── */}
      {rows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-surface-200 bg-surface-50">
                <th className="px-3 py-3 w-8">
                  <input type="checkbox"
                    checked={rows.filter(isSendable).every((r) => r.selected) && rows.some(isSendable)}
                    onChange={(e) => setRows((rs) => rs.map((r) => (isSendable(r) ? { ...r, selected: e.target.checked } : r)))} />
                </th>
                {['Guía', 'Empresa / N°', 'Destinatario', 'Cliente', 'WhatsApp', 'Estado', ''].map((h) => (
                  <th key={h} className="text-left text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider px-3 py-3">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-surface-100">
                {rows.map((r) => (
                  <QueueRow key={r.id} row={r} clients={clients}
                    alreadySent={!!r.tracking && sentKeys.get(notificationKey(r.carrier, r.tracking))}
                    disabled={sending}
                    onEdit={(p) => edit(r.id, p)}
                    onPatch={(p) => patch(r.id, p)}
                    onRemove={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                    onPreview={() => r.read && setPreview(`data:image/jpeg;base64,${r.read.imageBase64}`)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Historial ── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-200 flex items-center gap-2">
          <History size={16} className="text-navy-400" />
          <h2 className="font-display font-semibold text-navy-900 text-sm">Historial de envíos</h2>
          <span className="text-xs text-navy-400">({history.length})</span>
        </div>
        {history.length === 0 ? (
          <p className="p-8 text-center text-sm text-navy-400">Todavía no se ha enviado ningún comprobante.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-surface-200 bg-surface-50">
                {['Fecha', 'Empresa', 'Guía', 'Cliente', 'WhatsApp', 'Estado', 'Envió'].map((h) => (
                  <th key={h} className="text-left text-[10px] font-display font-semibold text-navy-400 uppercase tracking-wider px-4 py-3">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-surface-100">
                {history.map((h) => {
                  const b = STATUS_BADGE[h.status] || STATUS_BADGE.sent;
                  return (
                    <tr key={h.id} className="hover:bg-surface-50">
                      <td className="px-4 py-2.5 text-xs text-navy-500 whitespace-nowrap">{toDate(h.createdAt)?.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td className="px-4 py-2.5 text-sm text-navy-700">{h.carrierLabel}</td>
                      <td className="px-4 py-2.5 font-mono text-sm text-navy-900">{h.tracking}</td>
                      <td className="px-4 py-2.5 text-sm text-navy-700">{h.clientName}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-navy-500">+{h.phone}</td>
                      <td className="px-4 py-2.5">
                        <span className={`badge ${b.cls}`} title={h.error || undefined}>{b.icon} {b.label}</span>
                        {h.status === 'failed' && h.error && <p className="text-[10px] text-accent-red mt-1 max-w-[260px]">{h.error}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-navy-400">{h.sentByName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <img src={preview} alt="Guía" className="max-h-[90vh] max-w-full rounded-lg shadow-2xl" />
          <button className="absolute top-4 right-4 text-white"><XIcon size={28} /></button>
        </div>
      )}
    </div>
  );
}

function QueueRow({ row: r, clients, alreadySent, disabled, onEdit, onPatch, onRemove, onPreview }: {
  row: Row;
  clients: Client[];
  alreadySent: ShipmentNotification | false | undefined;
  disabled: boolean;
  onEdit: (p: Partial<Row>) => void;
  onPatch: (p: Partial<Row>) => void;
  onRemove: () => void;
  onPreview: () => void;
}) {
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const results = useMemo(() => searchClients(q, clients), [q, clients]);
  const busy = r.state === 'queued' || r.state === 'reading' || r.state === 'sending';
  const locked = busy || r.state === 'sent' || disabled;
  const phone = phoneFor(r);
  const phoneOk = !!toWhatsappNumber(phone);
  const fromQr = r.read?.codes.length && !r.read.rawText;
  const input = 'input-field text-xs py-1 px-2';

  return (
    <>
      <tr className={`align-top ${r.state === 'sent' ? 'opacity-60' : ''}`}>
        <td className="px-3 py-3">
          <input type="checkbox" checked={r.selected} disabled={locked || !isSendable(r)}
            onChange={(e) => onPatch({ selected: e.target.checked })} />
        </td>
        <td className="px-3 py-3">
          {r.read ? (
            <button onClick={onPreview} className="block relative group">
              <img src={r.read.previewUrl} alt="" className="w-14 h-20 object-cover rounded border border-surface-200" />
              <Eye size={14} className="absolute inset-0 m-auto text-white opacity-0 group-hover:opacity-100 drop-shadow" />
            </button>
          ) : (
            <div className="w-14 h-20 rounded bg-surface-100 flex items-center justify-center">
              <Loader2 size={16} className="animate-spin text-navy-300" />
            </div>
          )}
        </td>
        <td className="px-3 py-3 space-y-1 min-w-[150px]">
          <select value={r.carrier} disabled={locked} className={input}
            onChange={(e) => onEdit({ carrier: e.target.value as Carrier })}>
            {(Object.keys(CARRIER_LABELS) as Carrier[]).map((c) => <option key={c} value={c}>{CARRIER_LABELS[c]}</option>)}
          </select>
          <input value={r.tracking} disabled={locked} placeholder="N° de guía" className={`${input} font-mono ${!r.tracking && r.read ? 'border-accent-red' : ''}`}
            onChange={(e) => onEdit({ tracking: e.target.value.replace(/\s/g, '') })} />
          {r.read && (
            <p className="text-[10px] text-navy-400 flex items-center gap-1">
              {fromQr ? <><QrCode size={10} /> leído del QR</> : <><ScanText size={10} /> leído por OCR — revisa</>}
            </p>
          )}
        </td>
        <td className="px-3 py-3 space-y-1 min-w-[180px]">
          <input value={r.name} disabled={locked} placeholder="Nombre" className={input}
            onChange={(e) => onEdit({ name: e.target.value.toUpperCase() })} />
          <input value={r.cedula} disabled={locked} placeholder="Cédula" className={`${input} font-mono`}
            onChange={(e) => onEdit({ cedula: e.target.value.replace(/\D/g, '') })} />
          {r.destination && <p className="text-[10px] text-navy-400 truncate max-w-[200px]" title={r.destination}>{r.destination}</p>}
        </td>
        <td className="px-3 py-3 min-w-[190px]">
          {r.match && !searching ? (
            <div className="text-xs">
              <p className="font-semibold text-emerald-700 flex items-center gap-1"><UserCheck size={12} /> {r.match.client.name}</p>
              <p className="text-[10px] text-navy-400">{r.match.by === 'manual' ? 'elegido a mano' : `por ${r.match.by}`} · {r.match.client.rif_ci}</p>
              {!locked && (
                <button className="text-[10px] text-navy-500 underline mt-0.5" onClick={() => setSearching(true)}>cambiar</button>
              )}
            </div>
          ) : searching || !locked ? (
            <div className="relative">
              {!r.match && !searching && r.read && (
                <p className="text-[10px] text-amber-600 flex items-center gap-1 mb-1"><UserX size={11} /> no está registrado</p>
              )}
              <input value={q} autoFocus={searching} disabled={locked} placeholder="Buscar cliente…" className={input}
                onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setSearching(false), 150)} />
              {results.length > 0 && (
                <div className="absolute z-20 mt-1 w-64 bg-white dark:bg-navy-800 border border-surface-200 rounded-lg shadow-lg max-h-56 overflow-auto">
                  {results.map((c) => (
                    <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-surface-50 text-xs"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { onPatch({ match: { client: c, by: 'manual' } }); setQ(''); setSearching(false); }}>
                      <p className="font-semibold text-navy-800">{c.name}</p>
                      <p className="text-[10px] text-navy-400">{c.rif_ci} · {c.phone}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </td>
        <td className="px-3 py-3 min-w-[140px]">
          {r.match && toWhatsappNumber(r.match.client.phone) ? (
            <div className="text-xs">
              <p className="font-mono text-navy-800">{r.match.client.phone}</p>
              {r.phone && toWhatsappNumber(r.phone) !== toWhatsappNumber(r.match.client.phone) && (
                <button disabled={locked} className="text-[10px] text-navy-400 underline"
                  title="Usar el teléfono de la guía en vez del registrado"
                  onClick={() => onPatch({ match: null })}>guía: {r.phone}</button>
              )}
            </div>
          ) : (
            <input value={r.phone} disabled={locked} placeholder="0414…" className={`${input} font-mono ${r.read && !phoneOk ? 'border-accent-red' : ''}`}
              onChange={(e) => onEdit({ phone: e.target.value })} />
          )}
        </td>
        <td className="px-3 py-3 min-w-[130px]">
          <RowStatus row={r} alreadySent={alreadySent} />
        </td>
        <td className="px-3 py-3">
          <div className="flex flex-col gap-1">
            {r.read?.rawText && (
              <button title="Ver texto leído" className="btn-ghost p-1.5 text-navy-400" onClick={() => onPatch({ showRaw: !r.showRaw })}>
                <ScanText size={14} />
              </button>
            )}
            {!busy && (
              <button title="Quitar" className="btn-ghost p-1.5 text-navy-400 hover:text-accent-red" onClick={onRemove}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </td>
      </tr>
      {r.showRaw && r.read && (
        <tr><td colSpan={8} className="px-6 pb-4">
          <pre className="text-[10px] bg-surface-50 rounded p-3 max-h-48 overflow-auto whitespace-pre-wrap text-navy-600">{r.read.rawText}</pre>
          {r.read.codes.length > 0 && <p className="text-[10px] text-navy-400 mt-1 font-mono break-all">Código: {r.read.codes.join(' | ')}</p>}
        </td></tr>
      )}
    </>
  );
}

function RowStatus({ row: r, alreadySent }: { row: Row; alreadySent: ShipmentNotification | false | undefined }) {
  switch (r.state) {
    case 'queued':
      return <span className="badge badge-gray"><Clock size={11} /> En cola</span>;
    case 'reading':
      return <span className="badge badge-blue"><Loader2 size={11} className="animate-spin" /> {r.step || 'Leyendo…'}</span>;
    case 'sending':
      return <span className="badge badge-blue"><Loader2 size={11} className="animate-spin" /> Enviando…</span>;
    case 'sent':
      return <span className="badge badge-green"><CheckCircle size={11} /> Enviado</span>;
    case 'failed':
      return (
        <div>
          <span className="badge badge-red"><AlertTriangle size={11} /> Falló</span>
          <p className="text-[10px] text-accent-red mt-1 max-w-[180px]">{r.error}</p>
          <p className="text-[10px] text-navy-400 flex items-center gap-1 mt-0.5"><RotateCcw size={9} /> se puede reintentar</p>
        </div>
      );
    default: {
      const warn = r.state === 'unreadable'
        ? (r.error || 'No se leyó bien: completa los datos a mano.')
        : null;
      return (
        <div className="space-y-1">
          {alreadySent
            ? <span className="badge badge-amber" title="Si lo marcas, se envía de nuevo"><CheckCheck size={11} /> Ya enviado</span>
            : isSendable(r)
              ? <span className="badge badge-green"><CheckCircle size={11} /> Listo</span>
              : <span className="badge badge-amber"><AlertTriangle size={11} /> Revisar</span>}
          {warn && <p className="text-[10px] text-amber-600 max-w-[180px]">{warn}</p>}
        </div>
      );
    }
  }
}
