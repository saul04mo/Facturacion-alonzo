import { useState, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { updateExchangeRate, fetchExchangeRateHistory } from '@/modules/invoices/invoiceService';
import { formatDateLong, currentTimeVE, todayVE } from '@/utils/dateUtils';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Settings, DollarSign, RefreshCw, Check, AlertTriangle,
  Database, Users, Package, FileText, TrendingUp,
  Globe, Sun, Moon, Monitor, Clock, MapPin, Zap,
} from 'lucide-react';

export function SettingsPage() {
  const { can, isAdmin } = usePermissions();
  const toast = useToast();
  const currentUser = useAppStore((s) => s.currentUser);
  const products = useAppStore((s) => s.products);
  const clients = useAppStore((s) => s.clients);
  const invoices = useAppStore((s) => s.invoices);
  const users = useAppStore((s) => s.users);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const { exchangeRate } = useCurrency();

  const [newRate, setNewRate] = useState(String(exchangeRate));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fetchingBcv, setFetchingBcv] = useState(false);
  const [rateHistory, setRateHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [veTime, setVeTime] = useState(currentTimeVE());

  useEffect(() => {
    const i = setInterval(() => setVeTime(currentTimeVE()), 30000);
    return () => clearInterval(i);
  }, []);

  async function handleUpdateRate() {
    const rate = parseFloat(newRate);
    if (isNaN(rate) || rate <= 0) return toast.warning('Tasa inválida.');
    setSaving(true); setSaved(false);
    try {
      const userName = currentUser ? `${currentUser.nombre} ${currentUser.apellido}`.trim() : 'POS';
      await updateExchangeRate(rate, userName);
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    }
    catch { toast.error('Error al actualizar tasa.'); } finally { setSaving(false); }
  }

  const rateChanged = parseFloat(newRate) !== exchangeRate;

  async function handleFetchBcv() {
    setFetchingBcv(true);
    try {
      const functions = getFunctions();
      const refreshRate = httpsCallable(functions, 'refreshBcvRate');
      const result = await refreshRate();
      const data = result.data as { rate: number; updatedAt: string };
      setNewRate(String(data.rate));
      toast.success(`Tasa BCV actualizada: Bs. ${data.rate.toFixed(2)}`);
    } catch (err: any) {
      console.error('BCV fetch error:', err);
      toast.error(err?.message || 'No se pudo obtener la tasa BCV. Intenta más tarde.');
    } finally {
      setFetchingBcv(false);
    }
  }

  async function loadHistory() {
    try {
      const data = await fetchExchangeRateHistory(30);
      setRateHistory(data);
      setShowHistory(true);
    } catch (err) {
      console.error('History error:', err);
      toast.error('Error al cargar historial.');
    }
  }

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Header */}
      <div className="card p-6">
        <div className="flex items-center gap-3">
          <div className="w-1 h-12 bg-slate-500 rounded-full" />
          <div>
            <h1 className="text-xl font-display font-bold text-navy-900 dark:text-gray-100">Configuración</h1>
            <p className="text-navy-400 dark:text-gray-500 text-sm">Ajustes del sistema y datos operativos.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT COLUMN */}
        <div className="space-y-6">

          {/* ============ THEME ============ */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 bg-surface-50 border-b border-surface-200">
              <div className="flex items-center gap-2">
                {theme === 'dark' ? <Moon size={18} className="text-blue-400" /> : <Sun size={18} className="text-amber-500" />}
                <h2 className="font-display font-bold text-navy-900 dark:text-gray-100">Apariencia</h2>
              </div>
              <p className="text-navy-400 dark:text-gray-500 text-xs mt-1">Selecciona el tema visual del sistema.</p>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: 'light' as const, label: 'Claro', icon: <Sun size={20} />, desc: 'Fondo blanco', preview: 'bg-white border-2' },
                  { id: 'dark' as const, label: 'Oscuro', icon: <Moon size={20} />, desc: 'Fondo oscuro', preview: 'bg-gray-900 border-2' },
                ].map((opt) => (
                  <button key={opt.id} onClick={() => setTheme(opt.id)}
                    className={`p-4 rounded-xl border-2 text-center hover-lift
                      ${theme === opt.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
                        : 'border-surface-200 hover:border-surface-300 dark:hover:border-dark-400 bg-surface-0'}`}>
                    <div className={`w-12 h-8 rounded-lg mx-auto mb-3 ${opt.preview} ${theme === opt.id ? 'border-blue-400' : 'border-surface-300'}`} />
                    <div className={`mx-auto mb-2 ${theme === opt.id ? 'text-blue-600 dark:text-blue-400' : 'text-navy-400 dark:text-gray-500'}`}>
                      {opt.icon}
                    </div>
                    <p className={`font-display font-semibold text-sm ${theme === opt.id ? 'text-blue-700 dark:text-blue-300' : 'text-navy-600 dark:text-gray-400'}`}>
                      {opt.label}
                    </p>
                    <p className="text-[10px] text-navy-400 dark:text-gray-600 mt-0.5">{opt.desc}</p>
                  </button>
                ))}
                <button onClick={() => {
                  const sys = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                  setTheme(sys);
                }}
                  className={`p-4 rounded-xl border-2 text-center hover-lift bg-surface-0 border-surface-200 hover:border-surface-300 dark:hover:border-dark-400`}>
                  <div className="w-12 h-8 rounded-lg mx-auto mb-3 bg-gradient-to-r from-white to-gray-900 border-2 border-surface-300" />
                  <div className="mx-auto mb-2 text-navy-400 dark:text-gray-500"><Monitor size={20} /></div>
                  <p className="font-display font-semibold text-sm text-navy-600 dark:text-gray-400">Sistema</p>
                  <p className="text-[10px] text-navy-400 dark:text-gray-600 mt-0.5">Automático</p>
                </button>
              </div>
            </div>
          </div>

          {/* ============ TIMEZONE ============ */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 bg-surface-50 border-b border-surface-200">
              <div className="flex items-center gap-2">
                <Globe size={18} className="text-blue-500" />
                <h2 className="font-display font-bold text-navy-900 dark:text-gray-100">Zona Horaria</h2>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800/40 hover-lift">
                <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                  <MapPin size={22} className="text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="font-display font-bold text-blue-900 dark:text-blue-200 text-sm">Venezuela (VET)</p>
                  <p className="text-blue-700 dark:text-blue-400 text-xs">UTC-4 · America/Caracas · Sin horario de verano</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-50 rounded-xl p-4 border border-surface-200 hover-lift">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock size={14} className="text-navy-400 dark:text-gray-500" />
                    <span className="text-[10px] font-display font-semibold text-navy-400 dark:text-gray-500 uppercase">Hora actual</span>
                  </div>
                  <p className="text-2xl font-mono font-bold text-navy-900 dark:text-gray-100">{veTime}</p>
                </div>
                <div className="bg-surface-50 rounded-xl p-4 border border-surface-200 hover-lift">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock size={14} className="text-navy-400 dark:text-gray-500" />
                    <span className="text-[10px] font-display font-semibold text-navy-400 dark:text-gray-500 uppercase">Fecha</span>
                  </div>
                  <p className="text-sm font-display font-medium text-navy-900 dark:text-gray-100 capitalize">{formatDateLong(new Date())}</p>
                </div>
              </div>

              <div className="bg-surface-50 rounded-lg border border-surface-200 p-3">
                <p className="text-[10px] text-navy-400 dark:text-gray-500 font-display">
                  Todas las fechas y horas del sistema (facturas, informes, registros) se muestran en hora de Venezuela (VET, UTC-4).
                </p>
              </div>
            </div>
          </div>

          {/* ============ EXCHANGE RATE ============ */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 bg-surface-50 border-b border-surface-200">
              <div className="flex items-center gap-2">
                <DollarSign size={18} className="text-emerald-500" />
                <h2 className="font-display font-bold text-navy-900 dark:text-gray-100">Tasa de Cambio</h2>
              </div>
              <p className="text-navy-400 dark:text-gray-500 text-xs mt-1">Tasa USD → Bolívares</p>
            </div>
            <div className="p-6 space-y-5">
              <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl p-5 text-center">
                <p className="text-[10px] font-display font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Tasa actual</p>
                <p className="text-4xl font-mono font-bold text-emerald-700 dark:text-emerald-300 mt-1">{exchangeRate.toFixed(2)}</p>
                <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">Bs. por cada 1 USD</p>
              </div>

              {/* BCV Auto-fetch button */}
              {can('canUpdateExchangeRate') && (
                <button onClick={handleFetchBcv} disabled={fetchingBcv}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl font-display font-semibold text-sm transition-colors">
                  {fetchingBcv ? (
                    <><RefreshCw size={16} className="animate-spin" /> Consultando BCV...</>
                  ) : (
                    <><Zap size={16} /> Obtener Tasa BCV Automática</>
                  )}
                </button>
              )}

              {can('canUpdateExchangeRate') ? (
                <div className="space-y-3">
                  <label className="block text-sm font-display font-medium text-navy-700 dark:text-gray-300">Nueva tasa</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <TrendingUp size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300 dark:text-gray-500" />
                      <input type="number" step="0.01" value={newRate}
                        onChange={(e) => { setNewRate(e.target.value); setSaved(false); }}
                        className="input-field pl-10 font-mono text-lg" />
                    </div>
                    <button onClick={handleUpdateRate} disabled={saving || !rateChanged}
                      className={`btn-primary px-6 ${saved ? '!bg-emerald-600' : ''}`}>
                      {saving ? <><RefreshCw size={16} className="animate-spin" /> Guardando...</> :
                        saved ? <><Check size={16} /> Guardado</> : <><RefreshCw size={16} /> Actualizar</>}
                    </button>
                  </div>
                  {rateChanged && !isNaN(parseFloat(newRate)) && parseFloat(newRate) > 0 && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-lg p-3 animate-fade-up">
                      <p className="text-xs text-blue-700 dark:text-blue-300 font-display">
                        <span className="font-semibold">Vista previa:</span>{' '}
                        $1 = Bs. {parseFloat(newRate).toFixed(2)} · $10 = Bs. {(parseFloat(newRate) * 10).toFixed(2)} · $100 = Bs. {(parseFloat(newRate) * 100).toFixed(2)}
                      </p>
                    </div>
                  )}
                  {saved && (
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-lg p-3 animate-fade-up">
                      <p className="text-xs text-emerald-700 dark:text-emerald-300 font-display flex items-center gap-2">
                        <Check size={14} /> Tasa actualizada en todo el sistema.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-lg p-4 flex items-start gap-3">
                  <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-display font-semibold text-amber-800 dark:text-amber-300">Sin permiso</p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Contacta a un administrador.</p>
                  </div>
                </div>
              )}
            </div>
            {/* Rate History */}
            <div className="px-6 py-3 border-t border-surface-200 bg-surface-50">
              <button onClick={loadHistory}
                className="text-xs text-blue-500 hover:text-blue-600 font-display font-medium flex items-center gap-1 transition-colors">
                <Clock size={12} /> {showHistory ? 'Actualizar historial' : 'Ver historial de cambios'}
              </button>
            </div>
            {showHistory && rateHistory.length > 0 && (
              <div className="px-6 pb-4 max-h-64 overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-200">
                      {['Fecha', 'Anterior', 'Nueva', 'Cambio', 'Método'].map((h) => (
                        <th key={h} className="pb-2 text-[9px] font-display font-semibold text-navy-400 uppercase tracking-wider text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100">
                    {rateHistory.map((entry: any) => {
                      const ts = entry.timestamp?.toDate ? entry.timestamp.toDate() : new Date(entry.timestamp);
                      const change = entry.change || (entry.newRate - (entry.previousRate || 0));
                      const isUp = change > 0;
                      return (
                        <tr key={entry.id} className="text-xs">
                          <td className="py-2 text-navy-600">
                            {ts.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}{' '}
                            <span className="text-navy-400">{ts.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</span>
                          </td>
                          <td className="py-2 font-mono text-navy-500">
                            {entry.previousRate ? entry.previousRate.toFixed(2) : '—'}
                          </td>
                          <td className="py-2 font-mono font-bold text-navy-900">
                            {entry.newRate?.toFixed(2)}
                          </td>
                          <td className={`py-2 font-mono font-semibold ${isUp ? 'text-red-500' : change < 0 ? 'text-emerald-600' : 'text-navy-400'}`}>
                            {change !== 0 ? `${isUp ? '+' : ''}${change.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-2">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                              entry.method === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                              entry.method === 'manual' && entry.source === 'BCV-EUR' ? 'bg-violet-100 text-violet-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {entry.method === 'scheduled' ? '⏰ Auto' :
                               entry.source === 'BCV-EUR' ? '⚡ BCV' : '✏️ Manual'}
                            </span>
                            {entry.userName && entry.method === 'manual' && entry.source !== 'BCV-EUR' && (
                              <span className="block text-[8px] text-navy-400 mt-0.5">{entry.userName}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          {/* Data stats */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 bg-surface-50 border-b border-surface-200">
              <div className="flex items-center gap-2">
                <Database size={18} className="text-blue-500" />
                <h2 className="font-display font-bold text-navy-900 dark:text-gray-100">Datos del Sistema</h2>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: <Package size={16} />, label: 'Productos', value: products.length, color: 'amber' },
                  { icon: <Users size={16} />, label: 'Clientes', value: clients.length, color: 'cyan' },
                  { icon: <FileText size={16} />, label: 'Facturas', value: invoices.length, color: 'purple' },
                  { icon: <Users size={16} />, label: 'Usuarios', value: users.length, color: 'indigo' },
                ].map((item) => (
                  <div key={item.label} className={`rounded-xl border p-4 bg-${item.color}-50/50 dark:bg-${item.color}-900/10 border-${item.color}-200 dark:border-${item.color}-800/30`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-${item.color}-500`}>{item.icon}</span>
                      <span className="text-[10px] font-display font-semibold text-navy-400 dark:text-gray-500 uppercase">{item.label}</span>
                    </div>
                    <p className="text-2xl font-mono font-bold text-navy-900 dark:text-gray-100">{item.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 bg-surface-50 rounded-lg border border-surface-200 p-3">
                <p className="text-[10px] text-navy-400 dark:text-gray-500 font-display">
                  Facturas en caché: últimas 500. Para exportar todas usa el botón Excel en Informes.
                </p>
              </div>
            </div>
          </div>

          {/* Session info */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 bg-surface-50 border-b border-surface-200">
              <div className="flex items-center gap-2">
                <Globe size={18} className="text-navy-500 dark:text-gray-400" />
                <h2 className="font-display font-bold text-navy-900 dark:text-gray-100">Sesión Actual</h2>
              </div>
            </div>
            <div className="p-6 space-y-3">
              {[
                { label: 'Usuario', value: `${currentUser?.nombre} ${currentUser?.apellido}` },
                { label: 'Correo', value: currentUser?.correo || '—' },
                { label: 'Rol', value: currentUser?.rol === 'administrador' ? 'Administrador' : 'Vendedor' },
                { label: 'Cédula', value: currentUser?.cedula || '—' },
                { label: 'Zona horaria', value: 'VET (UTC-4) Venezuela' },
                { label: 'Idioma', value: 'Español (Venezuela)' },
                { label: 'Versión', value: 'POS Alonzo v2.0' },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between py-2 border-b border-surface-100 last:border-0">
                  <span className="text-sm text-navy-500 dark:text-gray-400 font-display">{item.label}</span>
                  <span className="text-sm font-display font-semibold text-navy-900 dark:text-gray-100">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
