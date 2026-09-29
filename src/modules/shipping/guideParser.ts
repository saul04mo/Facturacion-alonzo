/**
 * Parser de guías de envío (MRW, Zoom, Tealca) a partir del texto del OCR.
 *
 * Es código puro — sin DOM ni Tesseract — para poder probarlo con el texto de
 * una guía pegado a mano. El OCR de una foto de celular trae basura: letras
 * cambiadas (0/O, 1/I, 5/S), dos puntos que se pierden, líneas partidas. Por
 * eso las regex son flojas con los separadores y estrictas con los números.
 *
 * Lo que trae cada guía (sobre las fotos reales):
 *
 *   MRW     TRACKING 013302008001092 · DEST: DEIVER AYALA V-29838797
 *           TLF:04266381912 · DESTINO: RETIRAR POR OFICINA - 2008000 BARRIO OBRERO
 *           OJO: la línea del REMITENTE trae el teléfono de la tienda.
 *   Zoom    ZOOM 1867406277 · Destinatario:SARAHY SALINAS(V-14339685)(Tel.424-9171059)
 *           Destino: (ZOOM AV RAUL LEONI) … CIUDAD:MATURIN,ESTADO:MONAGAS
 *   Tealca  GUIA: 84873145 · NOMB: RICHARD OSMEL CONTRERAS E · DEST: BARCELONA
 *           No trae ni cédula ni teléfono: el cliente se busca por nombre.
 *
 * Los códigos (QR, DataMatrix, barras) casi nunca traen el nombre: se usan
 * para corregir el número de guía, que es justo lo que el OCR lee peor.
 */

export type Carrier = 'MRW' | 'ZOOM' | 'TEALCA' | 'OTRO';

export const CARRIER_LABELS: Record<Carrier, string> = {
  MRW: 'MRW',
  ZOOM: 'Zoom',
  TEALCA: 'Tealca',
  OTRO: 'Otra',
};

export interface GuideData {
  carrier: Carrier;
  tracking: string;
  name: string;
  /** Solo dígitos, sin V-/E-. */
  cedula: string;
  /** Tal como vino en la guía; se normaliza al enviar. */
  phone: string;
  destination: string;
  /** Cuántos campos se leyeron. Sirve para elegir la mejor rotación. */
  score: number;
}

/** Arreglos típicos del OCR dentro de algo que debería ser un número. */
function digitsOnly(s: string): string {
  return s
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[S]/g, '5')
    .replace(/[B]/g, '8')
    .replace(/\D/g, '');
}

function clean(s: string | undefined): string {
  return (s || '').replace(/\s+/g, ' ').replace(/^[\s:.,;-]+|[\s:.,;-]+$/g, '').trim();
}

/** Nombre en mayúsculas sin símbolos colgando; el OCR suele pegar un "." o "|". */
function cleanName(s: string | undefined): string {
  return clean((s || '').replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ .'-]/g, ' ')).toUpperCase();
}

export function detectCarrier(text: string): Carrier {
  const t = text.toUpperCase();
  if (/TEALCA|NOMB\s*[:.]|ALIADA|PREGU[I1]A/.test(t)) return 'TEALCA';
  if (/Z[O0]{2}M/.test(t) || /DESTINATARI[O0]/.test(t)) return 'ZOOM';
  if (/MRW|ENSACAD[O0]|TRACK[I1]NG|CUP[O0]NES/.test(t)) return 'MRW';
  return 'OTRO';
}

/** Cédula venezolana: V-12345678 / E 1234567 / V12.345.678 */
const CEDULA_RE = /\b([VEJ])\s*[-–—.]?\s*(\d{1,2}[.,]?\d{3}[.,]?\d{3})\b/i;

/** Teléfono venezolano con o sin 0, con o sin 58, con guiones. */
const PHONE_RE = /(?:\+?58[\s-]?)?0?(4(?:12|14|16|24|26|22)|2\d{2})[\s.-]?(\d{3})[\s.-]?(\d{4})/;

function findPhone(text: string): string {
  const m = text.match(PHONE_RE);
  if (m) return `0${m[1]}${m[2]}${m[3]}`;
  // El OCR suele cambiar un dígito del prefijo (04266… → 04200…). Si hay 11
  // dígitos con forma de celular se devuelven igual: se revisa en la tabla, y
  // el teléfono registrado del cliente tiene prioridad al enviar.
  const loose = text.replace(/\D/g, '').match(/0?4\d{9}/);
  return loose ? (loose[0].length === 10 ? `0${loose[0]}` : loose[0]) : '';
}

function parseMRW(text: string): Partial<GuideData> {
  const out: Partial<GuideData> = {};
  const trk = text.match(/TRACK[I1]NG\s*[:#]?\s*([0-9OoIl ]{10,24})/i);
  if (trk) out.tracking = digitsOnly(trk[1]);

  // "DEST: DEIVER AYALA V-29838797" — ojo con "DESTINO:", que es otra cosa.
  const dest = text.match(/DEST(?!INO)\s*[:.]?\s*([^\n]+)/i);
  if (dest) {
    const line = dest[1];
    const ced = line.match(CEDULA_RE);
    out.name = cleanName(ced ? line.slice(0, ced.index) : line);
    if (ced) out.cedula = digitsOnly(ced[2]);
  }

  // El teléfono del cliente viene DESPUÉS del DEST; el de antes es la tienda.
  const afterDest = dest ? text.slice((dest.index || 0)) : text;
  const tlfs = [...afterDest.matchAll(/T[LI1]F\s*[:.]?\s*([0-9OoIl .—–-]{10,16})/gi)];
  out.phone = tlfs.length ? findPhone(digitsOnly(tlfs[0][1])) : findPhone(afterDest);

  const destino = text.match(/DESTINO\s*[:.]?\s*([^\n]+(?:\n[^\n:]{3,40}\n)?)/i);
  if (destino) out.destination = clean(destino[1].replace(/\n/g, ' ').replace(/T[LI1]F.*$/i, ''));
  if (!out.destination) {
    const ens = text.match(/ENSACAD[O0]\s+PARA\s*\(?([^)\n]+)/i);
    if (ens) out.destination = clean(ens[1]);
  }
  return out;
}

function parseZoom(text: string): Partial<GuideData> {
  const out: Partial<GuideData> = {};
  const trk = text.match(/Z[O0]{2}M[\s—–:-]+([0-9OoIl ]{8,14})/i);
  if (trk) out.tracking = digitsOnly(trk[1]);

  // Destinatario:SARAHY SALINAS(V-14339685)(Tel.424-9171059)
  const dest = text.match(/DESTINATARI[O0]\s*[:.]?\s*([^\n]+(?:\n[^\n]+)?)/i);
  if (dest) {
    const line = dest[1];
    const cut = line.search(/[(]|\b[VE]\s*[-–]\s*\d/i);
    out.name = cleanName(cut > 0 ? line.slice(0, cut) : line);
    const ced = line.match(CEDULA_RE);
    // El OCR a veces cambia la V por Y o \/ o pierde el guion: "(Y~14339685)".
    // Entre paréntesis y con 7-8 dígitos no hay otra cosa que pueda ser.
    const loose = line.match(/\(\D{0,3}(\d{7,8})\D?\)/);
    if (ced) out.cedula = digitsOnly(ced[2]);
    else if (loose) out.cedula = loose[1];
    const tel = line.match(/Te[l1I]\s*[.:]?\s*([0-9OoIl .—–-]{9,16})/i);
    out.phone = findPhone(tel ? digitsOnly(tel[1]) : line);
  }

  // A veces el OCR pierde el ")": se corta en la primera coma o fin de línea.
  const agencia = text.match(/Destin[o0]\s*[:.]?\s*\(([^),\n]+)/i);
  const ciudad = text.match(/CIUDAD\s*[:.]?\s*([A-ZÁÉÍÓÚÑ \n]+?)\s*,?\s*ESTAD[O0]/i);
  const parts = [agencia?.[1], ciudad?.[1]?.replace(/\n/g, '')].map(clean).filter(Boolean);
  if (parts.length) out.destination = parts.join(' — ');
  return out;
}

function parseTealca(text: string): Partial<GuideData> {
  const out: Partial<GuideData> = {};
  const trk = text.match(/GU[I1]A\s*[:.]?\s*([0-9OoIl ]{6,14})/i);
  if (trk) out.tracking = digitsOnly(trk[1]);
  const nomb = text.match(/N[O0]MB\s*[:.]?\s*([^\n]+)/i);
  if (nomb) out.name = cleanName(nomb[1]);
  const dest = text.match(/DEST\s*[:.]?\s*([^\n]+)/i);
  if (dest) out.destination = clean(dest[1]);
  const serv = text.match(/SERV\s*[:.]?\s*([^\n]+)/i);
  if (serv && /OFICINA/i.test(serv[1]) && out.destination) out.destination += ' (retira en oficina)';
  return out;
}

/** Último recurso: la primera cédula y el primer teléfono que aparezcan. */
function parseGeneric(text: string): Partial<GuideData> {
  const ced = text.match(CEDULA_RE);
  return {
    cedula: ced ? digitsOnly(ced[2]) : '',
    phone: findPhone(text),
  };
}

/**
 * Si algún código trae una tira de dígitos casi igual a la guía leída (hasta 2
 * dígitos distintos), manda el código: el OCR se equivoca, el código no.
 * Si el OCR no leyó guía, se usa el código solo cuando es puramente numérico
 * y tiene un largo razonable.
 */
export function reconcileTracking(ocrTracking: string, codes: string[]): string {
  const runs = codes.flatMap((c) => c.match(/\d{6,}/g) || []);
  if (ocrTracking) {
    for (const run of runs) {
      for (let i = 0; i + ocrTracking.length <= run.length; i++) {
        const cand = run.slice(i, i + ocrTracking.length);
        let diff = 0;
        for (let j = 0; j < cand.length && diff <= 2; j++) if (cand[j] !== ocrTracking[j]) diff++;
        if (diff <= 2) return cand;
      }
    }
    return ocrTracking;
  }
  const pure = codes.map((c) => c.trim()).find((c) => /^\d{8,20}$/.test(c));
  return pure || '';
}

/**
 * El QR de MRW trae la guía completa separada por ";" — mejor que cualquier
 * OCR. Sobre una guía real:
 *   0 guía · 2 fecha · 3 remitente · 4 tlf remitente · 6-7 RIF remitente
 *   8 destinatario · 9 tlf destinatario · 11 V/E · 12 cédula
 */
export function parseMrwQr(code: string): Partial<GuideData> | null {
  const f = code.split(';');
  if (f.length < 13 || !/^\d{10,20}$/.test(f[0]) || !/^[VEJP]$/i.test(f[11] || '')) return null;
  return {
    carrier: 'MRW',
    tracking: f[0],
    name: cleanName(f[8]),
    phone: findPhone(f[9] || ''),
    cedula: (f[12] || '').replace(/\D/g, ''),
  };
}

/**
 * Código de barras de Tealca: 6001102 84873145 001 BCL 001 000850
 *   prefijo(7) · guía(8) · pieza(3) · destino(3) · total piezas(3) · peso en gramos(6)
 */
export function parseTealcaCode(code: string): Partial<GuideData> | null {
  const m = code.trim().match(/^\d{7}(\d{8})\d{3}([A-Z]{3})\d{9}$/);
  return m ? { carrier: 'TEALCA', tracking: m[1] } : null;
}

export function parseGuide(text: string, codes: string[] = []): GuideData {
  let fromCode: Partial<GuideData> = {};
  for (const c of codes) {
    const hit = parseMrwQr(c) || parseTealcaCode(c);
    if (hit) { fromCode = hit; break; }
  }
  const carrier = fromCode.carrier || detectCarrier(text);
  const parsed =
    carrier === 'MRW' ? parseMRW(text)
    : carrier === 'ZOOM' ? parseZoom(text)
    : carrier === 'TEALCA' ? parseTealca(text)
    : {};
  const generic = parseGeneric(text);

  // Lo que vino del código manda; el OCR rellena lo que el código no trae.
  const data: GuideData = {
    carrier,
    tracking: fromCode.tracking || reconcileTracking(parsed.tracking || '', codes),
    name: fromCode.name || parsed.name || '',
    cedula: fromCode.cedula || parsed.cedula || (carrier === 'TEALCA' ? '' : generic.cedula || ''),
    phone: fromCode.phone || parsed.phone || '',
    destination: parsed.destination || '',
    score: 0,
  };
  // Un nombre de una sola letra o puro ruido no cuenta.
  if (data.name.replace(/[^A-Z]/g, '').length < 4) data.name = '';
  data.score =
    (carrier !== 'OTRO' ? 2 : 0) +
    (data.tracking ? 2 : 0) +
    (data.name ? 2 : 0) +
    (data.cedula ? 1 : 0) +
    (data.phone ? 1 : 0) +
    (data.destination ? 1 : 0);
  return data;
}
