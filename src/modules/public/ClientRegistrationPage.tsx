import { useState, useEffect, type FormEvent } from 'react';
import { submitPublicClient } from './publicClientService';
import { User, CreditCard, MessageCircle, MapPin, Building2, Home, Send, CheckCircle2, BadgeCheck } from 'lucide-react';

interface FormState {
  name: string;
  rif_ci: string;
  phone: string;
  city: string;
  agency: string;
  addressLine: string;
}

const EMPTY: FormState = { name: '', rif_ci: '', phone: '', city: '', agency: '', addressLine: '' };

// Agencias de envío más usadas en Venezuela. "Otra" permite escribir una libre.
const AGENCIES = [
  'MRW',
  'Zoom',
  'Tealca',
  'Domesa',
  'Liberty Express',
  'Mensajeros Radio Worldwide',
  'Tipsa',
  'Aeroexpresos',
] as const;

export function ClientRegistrationPage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [existed, setExisted] = useState(false);
  const [registeredName, setRegisteredName] = useState('');
  const [customAgency, setCustomAgency] = useState(false);

  // Esta página vive fuera del Layout: forzamos modo claro.
  useEffect(() => { document.documentElement.classList.remove('dark'); }, []);

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    if (error) setError(null);
  }

  function validate(): string | null {
    if (!form.name.trim() || form.name.trim().length < 3) return 'Escribe tu nombre y apellido.';
    if (!form.rif_ci.trim()) return 'Escribe tu cédula.';
    if (!/^\d{5,}$/.test(form.rif_ci.replace(/\D/g, ''))) return 'La cédula debe tener solo números (mínimo 5 dígitos).';
    if (!form.phone.trim()) return 'Escribe tu número de WhatsApp.';
    if (form.phone.replace(/\D/g, '').length < 10) return 'El número de WhatsApp no parece válido.';
    if (!form.city.trim()) return 'Escribe tu ciudad.';
    if (!form.agency.trim()) return 'Escribe la agencia de envío.';
    if (!form.addressLine.trim()) return 'Escribe la dirección.';
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const v = validate();
    if (v) { setError(v); return; }
    setLoading(true);
    setError(null);
    try {
      const result = await submitPublicClient(form);
      setExisted(result.existed);
      setRegisteredName(result.name || form.name.trim());
      setDone(true);
    } catch (err: any) {
      console.error('Error enviando datos de cliente:', err);
      setError(err?.message || 'No pudimos enviar tus datos. Verifica tu conexión e intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
      {/* Patrón de fondo sutil */}
      <div className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, #102a43 1px, transparent 0)`,
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative w-full max-w-lg animate-fade-up">
        {/* Logo + título */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-navy-900 mx-auto mb-4 flex items-center justify-center shadow-card overflow-hidden">
            <img
              src="/images/logoAlonzo.png"
              alt="Alonzo"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                (e.target as HTMLImageElement).parentElement!.innerHTML =
                  '<span class="text-white font-display font-bold text-2xl">A</span>';
              }}
            />
          </div>
          <h1 className="text-2xl font-display font-bold text-navy-900">Datos para tu envío</h1>
          <p className="text-navy-400 text-sm mt-1 font-body">
            Completa tus datos y te enviaremos la guía de envío por WhatsApp.
          </p>
        </div>

        <div className="card p-6 sm:p-8">
          {done ? (
            <div className="text-center py-6 animate-fade-up">
              <div className={`w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center ${existed ? 'bg-blue-50' : 'bg-emerald-50'}`}>
                {existed
                  ? <BadgeCheck size={36} className="text-blue-500" />
                  : <CheckCircle2 size={36} className="text-emerald-500" />}
              </div>
              <h2 className="text-lg font-display font-bold text-navy-900">
                {existed ? '¡Ya estabas registrado!' : '¡Datos enviados!'}
              </h2>
              <p className="text-navy-400 text-sm mt-1.5 max-w-xs mx-auto">
                {existed
                  ? <>Hola {registeredName.split(' ')[0]}, ya te teníamos registrado y <strong>actualizamos tus datos de envío</strong>. Te escribiremos por WhatsApp con la guía. 🚚</>
                  : 'Recibimos tu información. Pronto te escribiremos por WhatsApp con la guía de envío. 🚚'}
              </p>
              <button
                onClick={() => { setForm(EMPTY); setDone(false); setExisted(false); setCustomAgency(false); }}
                className="btn-secondary mt-6 text-sm"
              >
                Enviar otro registro
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field
                icon={<User size={16} />}
                label="Nombre y Apellido"
                value={form.name}
                onChange={(v) => update('name', v)}
                placeholder="Ej. María Pérez"
                autoComplete="name"
              />
              <Field
                icon={<CreditCard size={16} />}
                label="Cédula"
                value={form.rif_ci}
                onChange={(v) => update('rif_ci', v)}
                placeholder="Ej. 12345678"
                inputMode="numeric"
              />
              <Field
                icon={<MessageCircle size={16} />}
                label="Número de WhatsApp"
                hint="Donde enviaremos la guía de envío"
                value={form.phone}
                onChange={(v) => update('phone', v)}
                placeholder="Ej. 0412 1234567"
                inputMode="tel"
                autoComplete="tel"
              />
              <Field
                icon={<MapPin size={16} />}
                label="Ciudad"
                value={form.city}
                onChange={(v) => update('city', v)}
                placeholder="Ej. Maracaibo"
              />
              <div>
                <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">
                  Agencia de envío
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300 pointer-events-none">
                    <Building2 size={16} />
                  </span>
                  <select
                    value={customAgency ? 'Otra' : form.agency}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === 'Otra') { setCustomAgency(true); update('agency', ''); }
                      else { setCustomAgency(false); update('agency', v); }
                    }}
                    className="input-field pl-10 appearance-none"
                    required
                  >
                    <option value="" disabled>Selecciona una agencia...</option>
                    {AGENCIES.map((a) => <option key={a} value={a}>{a}</option>)}
                    <option value="Otra">Otra (especificar)</option>
                  </select>
                </div>
                {customAgency && (
                  <input
                    type="text"
                    value={form.agency}
                    onChange={(e) => update('agency', e.target.value)}
                    className="input-field mt-2"
                    placeholder="Escribe el nombre de la agencia"
                    required
                  />
                )}
              </div>
              <Field
                icon={<Home size={16} />}
                label="Dirección"
                value={form.addressLine}
                onChange={(v) => update('addressLine', v)}
                placeholder="Dirección de la agencia o casa"
              />

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  <p className="text-accent-red text-sm font-display">{error}</p>
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full py-3">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Enviando...
                  </span>
                ) : (
                  <>
                    <Send size={16} />
                    Enviar mis datos
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-navy-300 text-[11px] mt-4">
          Tus datos se usan únicamente para coordinar tu envío.
        </p>
      </div>
    </div>
  );
}

// ── Campo reutilizable ──
function Field({
  icon, label, hint, value, onChange, placeholder, inputMode, autoComplete,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'numeric' | 'tel';
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-display font-medium text-navy-700 mb-1.5">
        {label}
        {hint && <span className="text-navy-400 font-normal text-xs ml-1">· {hint}</span>}
      </label>
      <div className="relative">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-300">{icon}</span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-field pl-10"
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete={autoComplete}
          required
        />
      </div>
    </div>
  );
}
