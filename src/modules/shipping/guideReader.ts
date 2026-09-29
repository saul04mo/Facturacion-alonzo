/**
 * Lectura de la foto de una guía, todo en el navegador (sin servidor ni IA):
 *
 *   1. Códigos con zxing-wasm (zxing-cpp compilado). La versión JS de zxing
 *      no lee el DataMatrix de Zoom ni las barras de Tealca en fotos de
 *      celular; esta sí. Se prueba la foto entera y agrandada.
 *        MRW     QR con todo: guía, destinatario, teléfono y cédula.
 *        Zoom    DataMatrix y barras con la guía (sin nombre ni teléfono).
 *        Tealca  barras con la guía.
 *   2. Si el código no trae al destinatario, OCR con Tesseract (español).
 *      Antes se RECORTA la etiqueta (el blanco sobre el paquete oscuro) y se
 *      agranda ~3.5×: WhatsApp manda 720×1280 y con letras de 12px Tesseract
 *      no lee nada; recortada y agrandada, lee nombre y cédula.
 *      Las fotos llegan de lado (Tealca), así que se prueba girada 90° y 270°
 *      y se queda con la lectura que más campos saque.
 *
 * El worker de Tesseract se crea una vez y se reusa para toda la tanda: bajar
 * el modelo de español (~2MB) en cada foto sería lo más lento de todo.
 */
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { createWorker, type Worker } from 'tesseract.js';
import { parseGuide, parseMrwQr, type GuideData } from './guideParser';

// El .wasm se sirve desde el propio sitio, no desde el CDN por defecto.
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path),
  },
});

/** Lado largo del recorte de la etiqueta que se le pasa a Tesseract. */
const OCR_SIDE = 2600;
/** Tope del agrandado: más allá, Tesseract tarda y no lee mejor. */
const OCR_MAX_SCALE = 4;
const MAX_SIDE_SEND = 1600;

let workerPromise: Promise<Worker> | null = null;
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('spa').catch((e) => {
      workerPromise = null; // que el próximo intento vuelva a probar
      throw e;
    });
  }
  return workerPromise;
}

/** Libera el worker (≈100MB de memoria) cuando se termina la tanda. */
export async function releaseReader(): Promise<void> {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  await w?.terminate();
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo abrir la imagen.')); };
    img.src = url;
  });
}

type Drawable = CanvasImageSource & { width: number; height: number };

function ctx2d(c: HTMLCanvasElement) {
  return c.getContext('2d', { willReadFrequently: true })!;
}

/** Dibuja la imagen escalada (`scale`) y girada (0/90/180/270). */
function draw(img: Drawable, scale: number, rotation = 0): HTMLCanvasElement {
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const swap = rotation === 90 || rotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = ctx2d(canvas);
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return canvas;
}

function fit(img: Drawable, maxSide: number): number {
  return Math.min(1, maxSide / Math.max(img.width, img.height));
}

interface Box { x0: number; y0: number; x1: number; y1: number }

/**
 * Caja de la etiqueta: la banda más larga de filas con >35% de píxeles claros
 * y, dentro de ella, la de columnas. Funciona porque las etiquetas son
 * blancas y casi siempre están sobre un paquete oscuro o con estampado.
 * Si no encuentra algo razonable, devuelve la imagen entera.
 */
function labelBox(c: HTMLCanvasElement): Box {
  const full: Box = { x0: 0, y0: 0, x1: c.width - 1, y1: c.height - 1 };
  // Se analiza una copia chica: sobra para ubicar un rectángulo.
  const k = Math.min(1, 400 / Math.max(c.width, c.height));
  const small = draw(c, k);
  const { width: w, height: h } = small;
  const px = ctx2d(small).getImageData(0, 0, w, h).data;
  const bright = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    bright[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 > 165 ? 1 : 0;
  }
  const band = (frac: (i: number) => number, n: number): [number, number] => {
    let best: [number, number] = [0, n - 1], bestLen = 0, start = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && frac(i) > 0.35;
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        if (i - start > bestLen) { bestLen = i - start; best = [start, i - 1]; }
        start = -1;
      }
    }
    return best;
  };
  const [y0, y1] = band((y) => {
    let s = 0; for (let x = 0; x < w; x++) s += bright[y * w + x]; return s / w;
  }, h);
  const [x0, x1] = band((x) => {
    let s = 0; for (let y = y0; y <= y1; y++) s += bright[y * w + x]; return s / (y1 - y0 + 1);
  }, w);
  // Una "etiqueta" de menos de un cuarto de la foto es ruido (un reflejo).
  if ((x1 - x0) * (y1 - y0) < w * h * 0.25) return full;
  const pad = 4;
  return {
    x0: Math.max(0, x0 / k - pad), y0: Math.max(0, y0 / k - pad),
    x1: Math.min(c.width - 1, x1 / k + pad), y1: Math.min(c.height - 1, y1 / k + pad),
  };
}

/** Recorta la caja, la agranda y la pasa a grises con contraste estirado. */
function cropForOcr(src: HTMLCanvasElement, b: Box): HTMLCanvasElement {
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  const scale = Math.min(OCR_MAX_SCALE, OCR_SIDE / Math.max(bw, bh));
  const out = document.createElement('canvas');
  out.width = Math.round(bw * scale);
  out.height = Math.round(bh * scale);
  const ctx = ctx2d(out);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, b.x0, b.y0, bw, bh, 0, 0, out.width, out.height);
  stretchGray(out);
  return out;
}

/** Grises + estirar el contraste entre los percentiles 2 y 98. */
function stretchGray(canvas: HTMLCanvasElement) {
  const ctx = ctx2d(canvas);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = imgData.data;
  const lum = new Uint8ClampedArray(canvas.width * canvas.height);
  const hist = new Array(256).fill(0);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    lum[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    hist[lum[j]]++;
  }
  const total = lum.length;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    px[i] = px[i + 1] = px[i + 2] = ((lum[j] - lo) * 255) / range;
  }
  ctx.putImageData(imgData, 0, 0);
}

async function decodeCodes(c: HTMLCanvasElement): Promise<string[]> {
  try {
    const res = await readBarcodes(ctx2d(c).getImageData(0, 0, c.width, c.height), {
      tryHarder: true, tryRotate: true, tryInvert: false, tryDownscale: true, maxNumberOfSymbols: 4,
    });
    return res.filter((r) => r.isValid && r.text).map((r) => r.text);
  } catch {
    return []; // wasm que no cargó: se sigue con el OCR
  }
}

export interface ReadResult extends GuideData {
  codes: string[];
  rawText: string;
  /** JPEG listo para mandar por WhatsApp (base64 sin el prefijo data:). */
  imageBase64: string;
  /** Miniatura para la tabla. */
  previewUrl: string;
}

export async function readGuide(
  file: Blob,
  onStep?: (msg: string) => void,
): Promise<ReadResult> {
  const img = await loadImage(file);
  const imageBase64 = draw(img, fit(img, MAX_SIDE_SEND)).toDataURL('image/jpeg', 0.82).split(',')[1];
  const previewUrl = draw(img, fit(img, 240)).toDataURL('image/jpeg', 0.7);

  // ── Códigos ──
  // Cada código aparece a cierta escala y no a otra (el DataMatrix de una
  // guía de Zoom salió a 1.5× y no a 1× ni a 2×), así que se prueban varias.
  onStep?.('Buscando QR / código de barras…');
  const codes: string[] = [];
  const base = fit(img, 1600);
  for (const s of [1, 1.5, 2]) {
    for (const code of await decodeCodes(draw(img, base * s))) {
      if (!codes.includes(code)) codes.push(code);
    }
    // El QR de MRW ya trae todo; con la guía de Zoom/Tealca también alcanza.
    if (codes.some((c) => parseMrwQr(c)) || parseGuide('', codes).tracking) break;
  }

  if (codes.some((c) => parseMrwQr(c))) {
    return { ...parseGuide('', codes), codes, rawText: '', imageBase64, previewUrl };
  }

  // ── Texto ──
  onStep?.('Leyendo el texto…');
  const worker = await getWorker();
  let best: { data: GuideData; text: string } | null = null;
  for (const rot of [0, 90, 270]) {
    const rotated = draw(img, 1, rot);
    const { data } = await worker.recognize(cropForOcr(rotated, labelBox(rotated)));
    const parsed = parseGuide(data.text, codes);
    if (!best || parsed.score > best.data.score) best = { data: parsed, text: data.text };
    // Empresa + guía + nombre ya es una buena lectura: no hace falta girar más.
    if (parsed.score >= 6) break;
  }

  return { ...best!.data, codes, rawText: best!.text, imageBase64, previewUrl };
}
