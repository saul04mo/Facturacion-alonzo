import { useState, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useCurrency } from '@/hooks/useCurrency';
import { useToast } from '@/components/Toast';
import { updateExchangeRate, fetchExchangeRateHistory } from '@/modules/invoices/invoiceService';
import { formatDateLong, currentTimeVE } from '@/utils/dateUtils';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  DollarSign, RefreshCw, Check, AlertTriangle,
  Database, Users, Package, FileText, TrendingUp,
  Globe, Sun, Moon, Monitor, Clock, MapPin, Zap, Megaphone,
  Plus, Trash2, Save, ToggleLeft, ToggleRight, Download, Upload, Type,
} from 'lucide-react';

export function SettingsPage() {
  const { can } = usePermissions();
  const toast = useToast();
  const currentUser = useAppStore((s) => s.currentUser);
  const products = useAppStore((s) => s.products);
  const clients = useAppStore((s) => s.clients);
  const invoices = useAppStore((s) => s.invoices);
  const users = useAppStore((s) => s.users);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const allowNegativeStock = useAppStore((s) => s.allowNegativeStock);
  const { exchangeRate } = useCurrency();

  const [newRate, setNewRate] = useState(String(exchangeRate));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fetchingBcv, setFetchingBcv] = useState(false);
  const [rateHistory, setRateHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [veTime, setVeTime] = useState(currentTimeVE());

  // Announcements
  interface AnnouncementDoc { id: string; text: string; link: string; active: boolean; order: number; }
  const [announcements, setAnnouncements] = useState<AnnouncementDoc[]>([]);
  const [annLoading, setAnnLoading] = useState(true);
  const [annSaving, setAnnSaving] = useState(false);

  // PWA Install Prompt toggle
  const [installPromptEnabled, setInstallPromptEnabled] = useState(true);

  // Cache TTL (seconds)
  const [cacheTTL, setCacheTTL] = useState(30);
  const [cacheSaving, setCacheSaving] = useState(false);

  // Editable web settings
  const [whatsappNumber, setWhatsappNumber] = useState('584123380976');
  const [currencySymbol, setCurrencySymbol] = useState('€');
  const [heroSubtitle, setHeroSubtitle] = useState('Newest Collection');
  const [heroImage, setHeroImage] = useState('/images/hero-banner.jpg');
  const [webSettingsSaving, setWebSettingsSaving] = useState(false);

  type SettingsTab = 'general' | 'rate' | 'pos' | 'web' | 'system';
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  useEffect(() => {
    const i = setInterval(() => setVeTime(currentTimeVE()), 30000);
    return () => clearInterval(i);
  }, []);

  // Load announcements + web settings
  useEffect(() => {
    (async () => {
      try {
        const { collection: col, getDocs, doc: docRef, getDoc } = await import('firebase/firestore');
        const { db } = await import('@/config/firebase');
        // Announcements
        try {
          const snap = await getDocs(col(db, 'announcements'));
          const items: AnnouncementDoc[] = [];
          snap.forEach((d) => {
            const data = d.data();
            items.push({ id: d.id, text: data.text || '', link: data.link || '', active: data.active !== false, order: data.order || 0 });
          });
          items.sort((a, b) => a.order - b.order);
          setAnnouncements(items);
        } catch (e) { console.error('Error loading announcements:', e); }
        // Web settings
        try {
          const webSnap = await getDoc(docRef(db, 'config', 'webSettings'));
          if (webSnap.exists()) {
            const data = webSnap.data();
            setInstallPromptEnabled(data.installPromptEnabled !== false);
            if (typeof data.cacheTTL === 'number') setCacheTTL(data.cacheTTL);
            if (data.whatsappNumber) setWhatsappNumber(data.whatsappNumber);
            if (data.currencySymbol) setCurrencySymbol(data.currencySymbol);
            if (data.heroSubtitle) setHeroSubtitle(data.heroSubtitle);
            if (data.heroImage) setHeroImage(data.heroImage);
          }
        } catch (e) { console.error('Error loading web settings:', e); }
      } catch (e) { console.error('Error initializing settings:', e); }
      setAnnLoading(false);
    })();
  }, []);

  async function handleToggleInstallPrompt() {
    const newVal = !installPromptEnabled;
    setInstallPromptEnabled(newVal);
    try {
      const { doc: docRef, setDoc } = await import('firebase/firestore');
      const { db } = await import('@/config/firebase');
      await setDoc(docRef(db, 'config', 'webSettings'), { installPromptEnabled: newVal }, { merge: true });
      toast.success(`Prompt de instalación: ${newVal ? 'Activado' : 'Desactivado'}`);
    } catch {
      toast.error('Error al guardar');
      setInstallPromptEnabled(!newVal);
    }
  }

  async function handleSaveCacheTTL() {
    setCacheSaving(true);
    try {
      const { doc: docRef, setDoc } = await import('firebase/firestore');
      const { db } = await import('@/config/firebase');
      await setDoc(docRef(db, 'config', 'webSettings'), { cacheTTL }, { merge: true });
      toast.success(`Cache actualizado: ${cacheTTL} segundos`);
    } catch {
      toast.error('Error al guardar');
    }
    setCacheSaving(false);
  }

  async function handleSaveWebSettings() {
    setWebSettingsSaving(true);
    try {
      const { doc: docRef, setDoc } = await import('firebase/firestore');
      const { db } = await import('@/config/firebase');
      await setDoc(docRef(db, 'config', 'webSettings'), {
        whatsappNumber,
        currencySymbol,
        heroSubtitle,
        heroImage,
      }, { merge: true });
      toast.success('Configuración web guardada');
    } catch {
      toast.error('Error al guardar');
    }
    setWebSettingsSaving(false);
  }

  async function handleHeroImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const { storage } = await import('@/config/firebase');
      const { compressImage } = await import('@/utils/imageUtils');
      toast.info('Subiendo imagen...');
      const compressed = await compressImage(file, 1920, 0.85);
      const imgRef = ref(storage, `hero/hero-banner-${Date.now()}.${compressed.name.split('.').pop()}`);
      const snap = await uploadBytes(imgRef, compressed);
      const url = await getDownloadURL(snap.ref);
      setHeroImage(url);
      toast.success('Imagen subida. Recuerda guardar.');
    } catch {
      toast.error('Error al subir imagen');
    }
  }

  async function handleSaveAnnouncement(ann: AnnouncementDoc) {
    setAnnSaving(true);
    try {
      const { doc: docRef, setDoc } = await import('firebase/firestore');
      const { db } = await import('@/config/firebase');
      await setDoc(docRef(db, 'announcements', ann.id), {
        text: ann.text, link: ann.link, active: ann.active, order: ann.order,
      });
      toast.success('Anuncio guardado');
    } catch { toast.error('Error al guardar'); }
    setAnnSaving(false);
  }

  async function handleAddAnnouncement() {
    setAnnSaving(true);
    try {
      const { collection: col, addDoc } = await import('firebase/firestore');
      const { db } = await import('@/config/firebase');
      const newOrder = announcements.length > 0 ? Math.max(...announcements.map((a) => a.order)) + 1 : 1;
      const ref = await addDoc(col(db, 'announcements'), {
        text: 'Nuevo anuncio', link: '', active: true, order: newOrder,
      });
      setAnnouncements([...announcements, { id: ref.id, text: 'Nuevo anuncio', link: '', active: true, order: newOrder }]);
      toast.success('Anuncio creado');
    } catch { toast.error('Error al crear'); }
    setAnnSaving(false);
  }

  async function handleDeleteAnnouncement(id: string) {
    if (!confirm('¿Eliminar este anuncio?')) return;
    try {
      const { doc: docRef, deleteDoc } = await import('firebase/firestore');
      const { db } = await import('@/config/firebase');
      await deleteDoc(docRef(db, 'announcements', id));
      setAnnouncements(announcements.filter((a) => a.id !== id));
      toast.success('Anuncio eliminado');
    } catch { toast.error('Error al eliminar'); }
  }

  async function handleToggleNegativeStock() {
    try {
      const { setDoc, doc: docRef } = await import('firebase/firestore');
      const { db } = await import('@/config/firebase');
      await setDoc(docRef(db, 'config', 'posSettings'), { allowNegativeStock: !allowNegativeStock }, { merge: true });
      toast.success(`Stock negativo: ${!allowNegativeStock ? 'Activado' : 'Desactivado'}`);
    } catch {
      toast.error('Error al guardar configuración.');
    }
  }

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

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: 'General', icon: <Sun size={16} /> },
    { id: 'rate', label: 'Tasa de Cambio', icon: <DollarSign size={16} /> },
    { id: 'pos', label: 'POS', icon: <Package size={16} /> },
    { id: 'web', label: 'Tienda Web', icon: <Megaphone size={16} /> },
    { id: 'system', label: 'Sistema', icon: <Database size={16} /> },
  ];

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

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mb-2 scrollbar-hide">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-display font-semibold whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-navy-900 dark:bg-gray-100 text-white dark:text-gray-900 shadow-md'
                : 'bg-surface-0 border border-surface-200 text-navy-500 dark:text-gray-400 hover:border-navy-300 hover:text-navy-700 dark:hover:text-gray-200'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="space-y-6 max-w-3xl">

        {/* ═══════ GENERAL ═══════ */}
        {activeTab === 'general' && (
          <>
            {/* Apariencia */}
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
                    className="p-4 rounded-xl border-2 text-center hover-lift bg-surface-0 border-surface-200 hover:border-surface-300 dark:hover:border-dark-400">
                    <div className="w-12 h-8 rounded-lg mx-auto mb-3 bg-gradient-to-r from-white to-gray-900 border-2 border-surface-300" />
                    <div className="mx-auto mb-2 text-navy-400 dark:text-gray-500"><Monitor size={20} /></div>
                    <p className="font-display font-semibold text-sm text-navy-600 dark:text-gray-400">Sistema</p>
                    <p className="text-[10px] text-navy-400 dark:text-gray-600 mt-0.5">Automático</p>
                  </button>
                </div>
              </div>
            </div>

            {/* Zona Horaria */}
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

            {/* Sesión Actual */}
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
          </>
        )}

        {/* ═══════ TASA DE CAMBIO ═══════ */}
        {activeTab === 'rate' && (
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
        )}

        {/* ═══════ POS ═══════ */}
        {activeTab === 'pos' && (
          <div className="card overflow-hidden">
            <div className="px-6 py-4 bg-surface-50 border-b border-surface-200">
              <div className="flex items-center gap-2">
                <Package size={18} className="text-purple-500" />
                <h2 className="font-display font-bold text-navy-900 dark:text-gray-100">Configuración del POS</h2>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <ToggleSetting
                label="Permitir stock negativo"
                description="Permite agregar productos al carrito aunque tengan stock en 0. El stock se descuenta y queda en negativo."
                enabled={allowNegativeStock}
                onToggle={handleToggleNegativeStock}
              />
            </div>
          </div>
        )}

        {/* ═══════ TIENDA WEB ═══════ */}
        {activeTab === 'web' && (
          <>
          {/* PWA Install Prompt */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 bg-surface-50 border-b border-surface-200">
              <div className="flex items-center gap-2">
                <Download size={18} className="text-blue-500" />
                <h2 className="font-display font-bold text-navy-900 dark:text-gray-100">Configuración Web</h2>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <ToggleSetting
                label="Prompt de instalación PWA"
                description="Muestra un banner invitando al cliente a instalar ALONZO como app en su teléfono."
                enabled={installPromptEnabled}
                onToggle={handleToggleInstallPrompt}
              />

              {/* Cache TTL */}
              <div className="p-4 rounded-xl border border-surface-200">
                <p className="font-display font-semibold text-sm text-navy-900 dark:text-gray-100 mb-1">
                  Cache de productos
                </p>
                <p className="text-[11px] text-navy-400 dark:text-gray-500 mb-3">
                  Tiempo que la web guarda los productos en memoria antes de consultar Firestore otra vez.
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 flex-1">
                    {[
                      { label: '10s', value: 10 },
                      { label: '30s', value: 30 },
                      { label: '1m', value: 60 },
                      { label: '5m', value: 300 },
                      { label: '15m', value: 900 },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setCacheTTL(opt.value)}
                        className={`flex-1 py-2 text-xs font-display font-semibold rounded-lg transition-colors ${
                          cacheTTL === opt.value
                            ? 'bg-navy-900 dark:bg-gray-100 text-white dark:text-gray-900'
                            : 'bg-surface-50 text-navy-500 dark:text-gray-400 border border-surface-200 hover:border-navy-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={handleSaveCacheTTL}
                    disabled={cacheSaving}
                    className="px-4 py-2 bg-emerald-600 text-white text-xs font-display font-semibold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                  >
                    {cacheSaving ? '...' : 'Guardar'}
                  </button>
                </div>
                <p className="text-[10px] text-navy-400 dark:text-gray-500 mt-2">
                  Más tiempo = menos consultas a Firestore (más rápido). Menos tiempo = cambios se reflejan más rápido.
                </p>
              </div>
            </div>
          </div>

          {/* WhatsApp, Moneda, Hero Banner */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 bg-surface-50 border-b border-surface-200">
              <div className="flex items-center gap-2">
                <Globe size={18} className="text-emerald-500" />
                <h2 className="font-display font-bold text-navy-900 dark:text-gray-100">Contenido de la Tienda</h2>
              </div>
            </div>
            <div className="p-6 space-y-5">
              {/* WhatsApp */}
              <div>
                <label className="block text-xs font-display font-semibold text-navy-900 dark:text-gray-100 mb-1">Número de WhatsApp</label>
                <p className="text-[10px] text-navy-400 dark:text-gray-500 mb-2">Sin espacios ni guiones. Ej: 584123380976</p>
                <input
                  type="text"
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-2.5 border border-surface-200 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-navy-500 outline-none"
                  placeholder="584123380976"
                />
              </div>

              {/* Currency */}
              <div>
                <label className="block text-xs font-display font-semibold text-navy-900 dark:text-gray-100 mb-1">Símbolo de moneda</label>
                <div className="flex gap-2">
                  {['€', '$', 'Bs'].map((sym) => (
                    <button
                      key={sym}
                      onClick={() => setCurrencySymbol(sym)}
                      className={`px-5 py-2 text-sm font-display font-bold rounded-lg transition-colors ${
                        currencySymbol === sym
                          ? 'bg-navy-900 dark:bg-gray-100 text-white dark:text-gray-900'
                          : 'bg-surface-50 text-navy-500 dark:text-gray-400 border border-surface-200 hover:border-navy-300'
                      }`}
                    >
                      {sym}
                    </button>
                  ))}
                  <input
                    type="text"
                    value={currencySymbol}
                    onChange={(e) => setCurrencySymbol(e.target.value)}
                    className="w-20 px-3 py-2 border border-surface-200 rounded-lg text-sm text-center bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-navy-500 outline-none"
                    placeholder="€"
                    maxLength={5}
                  />
                </div>
              </div>

              {/* Hero subtitle */}
              <div>
                <label className="block text-xs font-display font-semibold text-navy-900 dark:text-gray-100 mb-1">Subtítulo del Banner</label>
                <p className="text-[10px] text-navy-400 dark:text-gray-500 mb-2">Texto que aparece debajo del logo en la portada.</p>
                <input
                  type="text"
                  value={heroSubtitle}
                  onChange={(e) => setHeroSubtitle(e.target.value)}
                  className="w-full px-4 py-2.5 border border-surface-200 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-navy-500 outline-none"
                  placeholder="Newest Collection"
                />
              </div>

              {/* Hero image */}
              <div>
                <label className="block text-xs font-display font-semibold text-navy-900 dark:text-gray-100 mb-1">Imagen del Banner</label>
                <p className="text-[10px] text-navy-400 dark:text-gray-500 mb-2">Foto de portada de la tienda. Se recomienda 1920×1080 o superior.</p>
                <div className="flex items-center gap-3">
                  {heroImage && (
                    <div className="w-24 h-14 rounded-lg overflow-hidden border border-surface-200 flex-shrink-0">
                      <img src={heroImage} alt="Banner" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <label className="flex items-center gap-1.5 px-4 py-2 bg-surface-50 border border-surface-200 text-navy-600 dark:text-gray-300 text-xs font-display font-semibold rounded-lg hover:border-navy-300 transition-colors cursor-pointer">
                    <Upload size={14} />
                    Cambiar imagen
                    <input type="file" accept="image/*" onChange={handleHeroImageUpload} className="hidden" />
                  </label>
                </div>
              </div>

              {/* Save button */}
              <button
                onClick={handleSaveWebSettings}
                disabled={webSettingsSaving}
                className="w-full py-3 bg-emerald-600 text-white text-xs font-display font-bold tracking-wider rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {webSettingsSaving ? 'Guardando...' : 'GUARDAR CAMBIOS'}
              </button>
            </div>
          </div>

          {/* Announcements */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 bg-surface-50 border-b border-surface-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Megaphone size={18} className="text-navy-500 dark:text-gray-400" />
                  <h2 className="font-display font-bold text-navy-900 dark:text-gray-100">Anuncios Web</h2>
                </div>
                <button
                  onClick={handleAddAnnouncement}
                  disabled={annSaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-navy-900 dark:bg-gray-700 text-white text-xs font-display font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Plus size={14} />
                  Agregar
                </button>
              </div>
              <p className="text-[11px] text-navy-400 dark:text-gray-500 mt-1">
                Franja superior de la tienda web. Los mensajes se alternan automáticamente.
              </p>
            </div>
            <div className="p-6 space-y-4">
              {annLoading ? (
                <p className="text-sm text-navy-400 dark:text-gray-500 text-center py-4">Cargando...</p>
              ) : announcements.length === 0 ? (
                <p className="text-sm text-navy-400 dark:text-gray-500 text-center py-4">No hay anuncios. Agrega uno.</p>
              ) : (
                announcements.map((ann, idx) => (
                  <div key={ann.id} className="border border-surface-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] tracking-widest uppercase text-navy-400 dark:text-gray-500 font-display font-semibold">
                        Anuncio {idx + 1}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const updated = announcements.map((a) => a.id === ann.id ? { ...a, active: !a.active } : a);
                            setAnnouncements(updated);
                            handleSaveAnnouncement({ ...ann, active: !ann.active });
                          }}
                          title={ann.active ? 'Desactivar' : 'Activar'}
                        >
                          {ann.active ? (
                            <ToggleRight size={22} className="text-emerald-500" />
                          ) : (
                            <ToggleLeft size={22} className="text-navy-300 dark:text-gray-600" />
                          )}
                        </button>
                        <button
                          onClick={() => handleDeleteAnnouncement(ann.id)}
                          className="text-red-400 hover:text-red-600 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-navy-500 dark:text-gray-400 font-display font-semibold mb-1 block">Texto</label>
                      <input
                        type="text"
                        value={ann.text}
                        onChange={(e) => setAnnouncements(announcements.map((a) => a.id === ann.id ? { ...a, text: e.target.value } : a))}
                        className="w-full px-3 py-2.5 text-sm border border-surface-200 rounded-lg bg-white dark:bg-gray-800 text-navy-900 dark:text-gray-100 focus:ring-2 focus:ring-navy-300 focus:border-navy-400 outline-none"
                        placeholder="Texto del anuncio..."
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-navy-500 dark:text-gray-400 font-display font-semibold mb-1 block">Link (opcional)</label>
                      <input
                        type="text"
                        value={ann.link}
                        onChange={(e) => setAnnouncements(announcements.map((a) => a.id === ann.id ? { ...a, link: e.target.value } : a))}
                        className="w-full px-3 py-2.5 text-sm border border-surface-200 rounded-lg bg-white dark:bg-gray-800 text-navy-900 dark:text-gray-100 focus:ring-2 focus:ring-navy-300 focus:border-navy-400 outline-none"
                        placeholder="https://..."
                      />
                    </div>
                    <button
                      onClick={() => handleSaveAnnouncement(ann)}
                      disabled={annSaving}
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-xs font-display font-semibold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                    >
                      <Save size={13} />
                      Guardar
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          </>
        )}

        {/* ═══════ SISTEMA ═══════ */}
        {activeTab === 'system' && (
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

              {/* Selector de tipografía global */}
              <FontPresetCard />

              {/* Migración a inventario dual (Tienda + Almacén) */}
              <DualBranchMigrationCard />

              {/* Mover todo el stock inicial al almacén */}
              <StockToWarehouseMigrationCard />
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function ToggleSetting({ label, description, enabled, onToggle }: {
  label: string; description: string; enabled: boolean; onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-surface-200 hover:bg-surface-50 transition-colors">
      <div className="flex-1">
        <p className="font-display font-semibold text-sm text-navy-900 dark:text-gray-100">{label}</p>
        <p className="text-[11px] text-navy-400 dark:text-gray-500 mt-0.5">{description}</p>
      </div>
      <button onClick={onToggle}
        className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-emerald-500' : 'bg-navy-200 dark:bg-gray-600'}`}>
        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

/**
 * Tarjeta para correr la migración a inventario dual (Tienda + Almacén).
 * Solo visible para admin. Idempotente — se puede correr varias veces.
 */
function DualBranchMigrationCard() {
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);

  async function handleRun() {
    setRunning(true);
    setLogs([]);
    try {
      const { migrateToDualBranch } = await import('@/utils/migrations/migrateToDualBranch');
      const result = await migrateToDualBranch((msg) => {
        setLogs((prev) => [...prev, msg]);
      });
      if (result.errors.length === 0) {
        toast.success(`Migración OK — ${result.productsMigrated} productos, ${result.invoicesMigrated} facturas migradas.`);
      } else {
        toast.warning(`Migración con ${result.errors.length} errores. Revisa el log.`);
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Error en la migración.');
    } finally {
      setRunning(false);
      setConfirm(false);
    }
  }

  return (
    <div className="mt-6 bg-amber-50/40 dark:bg-amber-900/10 rounded-lg border border-amber-200 dark:border-amber-800/30 p-4">
      <div className="flex items-start gap-3 mb-3">
        <Database size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-display font-semibold text-sm text-navy-900 dark:text-gray-100">
            Migración a Inventario Dual (Tienda + Almacén)
          </p>
          <p className="text-[11px] text-navy-500 dark:text-gray-400 mt-1 leading-relaxed">
            Mueve el stock actual de cada producto al campo <code>stockStore</code>.
            El <code>stockWarehouse</code> arranca en 0 — vas a tener que generar
            transferencias para mover mercancía al almacén. Las facturas viejas se
            asumen como ventas de la tienda. <b>Es idempotente</b>, podés correrla
            varias veces sin problema.
          </p>
        </div>
      </div>

      {!confirm && !running && (
        <button
          onClick={() => setConfirm(true)}
          className="btn-secondary text-xs"
        >
          Iniciar migración…
        </button>
      )}

      {confirm && !running && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] text-amber-700 dark:text-amber-300 font-display font-semibold">
            ¿Confirmás? Esto modifica TODOS los productos y facturas:
          </span>
          <button onClick={handleRun} className="btn-primary text-xs">Sí, ejecutar</button>
          <button onClick={() => setConfirm(false)} className="btn-ghost text-xs">Cancelar</button>
        </div>
      )}

      {running && (
        <div className="text-[11px] text-navy-600 dark:text-gray-400 font-mono">
          Ejecutando migración… no cierres la pestaña.
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-3 max-h-40 overflow-y-auto bg-navy-900/5 dark:bg-black/30 rounded p-2 text-[10px] font-mono text-navy-700 dark:text-gray-300 space-y-0.5">
          {logs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Tarjeta para correr la migración inversa: mover todo el stock
 * inicial al almacén (la primera migración asumió tienda por defecto,
 * pero en realidad todo está en el almacén).
 */
function StockToWarehouseMigrationCard() {
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);

  async function handleRun() {
    setRunning(true);
    setLogs([]);
    try {
      const { migrateStockToWarehouse } = await import('@/utils/migrations/migrateStockToWarehouse');
      const result = await migrateStockToWarehouse((msg) => {
        setLogs((prev) => [...prev, msg]);
      });
      if (result.errors.length === 0) {
        toast.success(`Stock movido: ${result.unitsMoved} unidades en ${result.productsMigrated} productos.`);
      } else {
        toast.warning(`Migración con ${result.errors.length} errores. Revisa el log.`);
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Error en la migración.');
    } finally {
      setRunning(false);
      setConfirm(false);
    }
  }

  return (
    <div className="mt-4 bg-blue-50/40 dark:bg-blue-900/10 rounded-lg border border-blue-200 dark:border-blue-800/30 p-4">
      <div className="flex items-start gap-3 mb-3">
        <Database size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-display font-semibold text-sm text-navy-900 dark:text-gray-100">
            Mover stock inicial al Almacén
          </p>
          <p className="text-[11px] text-navy-500 dark:text-gray-400 mt-1 leading-relaxed">
            Mueve TODO lo que esté en <code>stockStore</code> al <code>stockWarehouse</code>.
            La tienda quedará en cero hasta que generes transferencias desde el
            almacén. Usá esto si la primera migración te dejó el stock en tienda
            pero en realidad todo está en el almacén central. <b>Es idempotente</b>:
            si ya lo corriste, los productos con stockStore=0 se saltean.
          </p>
        </div>
      </div>

      {!confirm && !running && (
        <button onClick={() => setConfirm(true)} className="btn-secondary text-xs">
          Mover stock al almacén…
        </button>
      )}

      {confirm && !running && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] text-blue-700 dark:text-blue-300 font-display font-semibold">
            ¿Confirmás? Esto mueve TODO el stock de tienda → almacén:
          </span>
          <button onClick={handleRun} className="btn-primary text-xs">Sí, ejecutar</button>
          <button onClick={() => setConfirm(false)} className="btn-ghost text-xs">Cancelar</button>
        </div>
      )}

      {running && (
        <div className="text-[11px] text-navy-600 dark:text-gray-400 font-mono">
          Ejecutando migración… no cierres la pestaña.
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-3 max-h-40 overflow-y-auto bg-navy-900/5 dark:bg-black/30 rounded p-2 text-[10px] font-mono text-navy-700 dark:text-gray-300 space-y-0.5">
          {logs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Selector de tipografía global del sistema. El cambio se aplica al instante
 * y persiste en localStorage. Carga las fuentes de Google Fonts on-demand.
 */
function FontPresetCard() {
  const [currentId, setCurrentId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'default';
    return localStorage.getItem('pos-alonzo-font-preset') || 'default';
  });
  const [previewFamily, setPreviewFamily] = useState<string>(''); // family aplicada para el preview live

  async function handleSelect(presetId: string) {
    const { setFontPreset, FONT_PRESETS } = await import('@/utils/fontUtils');
    setCurrentId(presetId);
    setFontPreset(presetId);
    const preset = FONT_PRESETS.find((p) => p.id === presetId);
    setPreviewFamily(preset?.family || '');
  }

  return (
    <div className="mt-6 bg-purple-50/40 dark:bg-purple-900/10 rounded-lg border border-purple-200 dark:border-purple-800/30 p-4">
      <div className="flex items-start gap-3 mb-3">
        <Type size={18} className="text-purple-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-display font-semibold text-sm text-navy-900 dark:text-gray-100">
            Tipografía del sistema
          </p>
          <p className="text-[11px] text-navy-500 dark:text-gray-400 mt-1 leading-relaxed">
            Cambia la fuente de todo el sistema (textos, números, headers, tablas, todo).
            Las fuentes se cargan al elegirlas y se aplican al instante. Tu selección se guarda
            en este navegador — si entrás desde otra computadora vas a tener que elegir de nuevo.
          </p>
        </div>
      </div>

      <FontPresetSelector currentId={currentId} onSelect={handleSelect} />

      {/* Preview de muestra */}
      <div className="mt-3 p-3 rounded-lg bg-white dark:bg-dark-200/40 border border-surface-200 dark:border-dark-300" style={previewFamily ? { fontFamily: previewFamily } : undefined}>
        <p className="text-[9px] uppercase tracking-wider text-navy-400 dark:text-gray-500 font-semibold mb-1">Preview</p>
        <p className="text-lg font-bold text-navy-900 dark:text-gray-100">FACT-4110</p>
        <p className="text-sm text-navy-600 dark:text-gray-400">Total: $ 22,771.80 — Bs. 1,234,567.89</p>
        <p className="text-xs text-navy-500 dark:text-gray-500 mt-1">The quick brown fox jumps over the lazy dog · 0123456789</p>
      </div>
    </div>
  );
}

/**
 * Componente interno que renderiza la lista de FontPresets como botones.
 * Importa dinámicamente el catálogo para no engordar el bundle inicial.
 */
function FontPresetSelector({ currentId, onSelect }: { currentId: string; onSelect: (id: string) => void }) {
  const [presets, setPresets] = useState<any[]>([]);
  useEffect(() => {
    import('@/utils/fontUtils').then((mod) => setPresets(mod.FONT_PRESETS));
  }, []);

  if (presets.length === 0) {
    return <p className="text-[11px] text-navy-400">Cargando opciones…</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {presets.map((preset) => {
        const isActive = preset.id === currentId;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSelect(preset.id)}
            className={`text-left p-3 rounded-lg border-2 transition-all ${
              isActive
                ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                : 'border-surface-200 dark:border-dark-300 hover:border-purple-300 hover:bg-surface-50 dark:hover:bg-dark-200'
            }`}
          >
            <p className="font-display font-semibold text-xs text-navy-900 dark:text-gray-100" style={preset.family ? { fontFamily: preset.family } : undefined}>
              {preset.label} {isActive && <Check size={12} className="inline text-purple-600 ml-1" />}
            </p>
            <p className="text-[10px] text-navy-400 dark:text-gray-500 mt-0.5">
              {preset.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
