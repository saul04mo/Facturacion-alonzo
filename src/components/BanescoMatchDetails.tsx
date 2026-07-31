import { useEffect, useState } from 'react';
import { getBancosCached, type BanescoTransaction } from '@/services/banescoService';

/**
 * Detalle completo de una transacción encontrada en Banesco.
 *
 * Se usa en columnas angostas (el panel de cobro del POS, el detalle de
 * factura), así que el monto va como titular y el resto en filas separadas
 * por línea. El concepto va aparte, a lo ancho: es texto libre del banco y
 * en dos columnas se corta feo.
 */

const bs = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Traduce el código del banco a "0102 — Banco de Venezuela". El catálogo se
 * pide una sola vez por sesión; mientras carga (o si falla) se muestra el
 * código solo, nunca se bloquea el resultado de la validación por esto.
 */
function useBancoLabel(code: string | undefined): string {
  const clean = (code ?? '').trim();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!clean) return;
    let alive = true;
    getBancosCached()
      .then((bancos) => {
        if (!alive) return;
        const found = bancos.find((b) => b.code?.trim() === clean);
        if (found) setName(found.name);
      })
      .catch(() => { /* sin catálogo se muestra el código */ });
    return () => { alive = false; };
  }, [clean]);

  if (!clean) return '';
  return name ? `${clean} — ${name}` : clean;
}

/** 'YYYY-MM-DD' + 'HH:MM:SS' → '31/07/2026 · 14:32'. */
function formatFecha(trnDate?: string, trnTime?: string): string {
  const d = (trnDate ?? '').trim();
  const t = (trnTime ?? '').trim().slice(0, 5);
  const parts = d.split('-');
  const fecha = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
  return [fecha, t].filter(Boolean).join(' · ');
}

export function BanescoMatchDetails({ match }: { match: BanescoTransaction }) {
  const banco = useBancoLabel(match.sourceBankId);
  const isCredit = match.trnType?.trim().toUpperCase() === 'CR';
  const concepto = match.concept?.trim();

  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: 'Referencia', value: match.referenceNumber?.trim() ?? '', mono: true },
    { label: 'Banco origen', value: banco },
    { label: 'Tipo', value: isCredit ? 'Crédito (CR)' : 'Débito (DB)' },
    { label: 'Cuenta destino', value: match.accountId?.trim() ?? '', mono: true },
    { label: 'Cédula / RIF', value: match.customerIdBen?.trim() ?? '', mono: true },
  ].filter((r) => r.value);

  return (
    <div>
      {/* Titular: lo que el cajero necesita confirmar de un vistazo. */}
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <span className="font-mono font-bold text-sm leading-none">Bs {bs.format(match.amount)}</span>
        <span className="font-mono text-[11px] text-navy-500 leading-none whitespace-nowrap">
          {formatFecha(match.trnDate, match.trnTime)}
        </span>
      </div>

      <dl className="text-[11px] leading-snug">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between items-start gap-3 py-1.5 border-t border-emerald-200">
            <dt className="text-navy-500 shrink-0">{r.label}</dt>
            <dd className={`text-right break-all min-w-0 ${r.mono ? 'font-mono' : ''}`}>{r.value}</dd>
          </div>
        ))}

        {concepto && (
          <div className="pt-1.5 border-t border-emerald-200">
            <dt className="text-navy-500 mb-0.5">Concepto</dt>
            <dd className="break-words">{concepto}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
