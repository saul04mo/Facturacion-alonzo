/**
 * Lectura de la foto de una guía, todo en el navegador (sin servidor ni IA):
 *
 *   1. Se achica la foto a ~2000px y se pasa a grises con contraste estirado.
 *      Una foto de celular de 12MP hace que Tesseract tarde medio minuto y no
 *      lee mejor.
 *   2. zxing busca QR / DataMatrix / código de barras, probando rotaciones.
 *   3. Tesseract (español) lee el texto. Las fotos llegan de lado (la de
 *      Tealca, por ejemplo), así que si la lectura derecha no encuentra la
 *      guía se prueba girada 90° y 270° y se queda con la que más campos saque.
 *
 * El worker de Tesseract se crea una vez y se reusa para toda la tanda: bajar
 * el modelo de español (~2MB) en cada foto sería lo más lento de todo.
 */
import {
  BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer,
  MultiFormatReader, RGBLuminanceSource,
} from '@zxing/library';
import { createWorker, type Worker } from 'tesseract.js';
import { parseGuide, parseMrwQr, type GuideData } from './guideParser';

/** Lado largo para el OCR. Se agranda también: WhatsApp manda 720×1280 y
 *  con letras de 15px Tesseract no lee nada. */
const OCR_SIDE = 2400;
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

/** `upscale` deja agrandar; si no, solo achica. */
function drawScaled(
  img: CanvasImageSource & { width: number; height: number },
  maxSide: number, rotation = 0, upscale = false,
) {
  const fit = maxSide / Math.max(img.width, img.height);
  const scale = upscale ? fit : Math.min(1, fit);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const swap = rotation === 90 || rotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return canvas;
}

/** Grises + estirar el contraste entre los percentiles 2 y 98. */
function toGrayscale(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = imgData.data;
  const lum = new Uint8ClampedArray(canvas.width * canvas.height);
  const hist = new Array(256).fill(0);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const y = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    lum[j] = y;
    hist[lum[j]]++;
  }
  const total = lum.length;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  for (let j = 0; j < lum.length; j++) lum[j] = ((lum[j] - lo) * 255) / range;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    px[i] = px[i + 1] = px[i + 2] = lum[j];
  }
  ctx.putImageData(imgData, 0, 0);
  return lum;
}

const codeReader = new MultiFormatReader();
codeReader.setHints(new Map<DecodeHintType, unknown>([
  [DecodeHintType.TRY_HARDER, true],
  [DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39, BarcodeFormat.PDF_417, BarcodeFormat.ITF, BarcodeFormat.EAN_13,
  ]],
]));

function decodeCode(lum: Uint8ClampedArray, w: number, h: number): string | null {
  try {
    const bmp = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, w, h)));
    return codeReader.decode(bmp).getText();
  } catch {
    return null; // NotFoundException: en esta rotación no hay código legible
  } finally {
    codeReader.reset();
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

async function toJpegBase64(img: HTMLImageElement): Promise<{ base64: string; preview: string }> {
  const canvas = drawScaled(img, MAX_SIDE_SEND);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  const thumb = drawScaled(img, 240).toDataURL('image/jpeg', 0.7);
  return { base64: dataUrl.split(',')[1], preview: thumb };
}

export async function readGuide(
  file: Blob,
  onStep?: (msg: string) => void,
): Promise<ReadResult> {
  const img = await loadImage(file);
  const { base64, preview } = await toJpegBase64(img);

  // ── Códigos ──
  // zxing encuentra el código solo a cierta escala (con la de Zoom, por
  // ejemplo, a 0.75 sí y a 1 no), así que se prueban varias.
  onStep?.('Buscando QR / código de barras…');
  const codes: string[] = [];
  const longSide = Math.max(img.width, img.height);
  outer:
  for (const rot of [0, 90]) {
    for (const f of [1, 0.75, 0.5]) {
      const c = drawScaled(img, Math.min(longSide, 1600) * f, rot);
      const code = decodeCode(toGrayscale(c), c.width, c.height);
      if (code && !codes.includes(code)) codes.push(code);
      // El QR de MRW ya trae todo: no hace falta seguir buscando.
      if (code && parseMrwQr(code)) break outer;
    }
  }

  const fromQr = codes.map(parseMrwQr).find(Boolean);
  if (fromQr) {
    return { ...parseGuide('', codes), codes, rawText: '', imageBase64: base64, previewUrl: preview };
  }

  // ── Texto ──
  onStep?.('Leyendo el texto…');
  const worker = await getWorker();
  let best: { data: GuideData; text: string } | null = null;
  for (const rot of [0, 90, 270]) {
    const c = drawScaled(img, OCR_SIDE, rot, true);
    toGrayscale(c);
    const { data } = await worker.recognize(c);
    const parsed = parseGuide(data.text, codes);
    if (!best || parsed.score > best.data.score) best = { data: parsed, text: data.text };
    // Empresa + guía + nombre ya es una buena lectura: no hace falta girar más.
    if (parsed.score >= 6) break;
  }

  return { ...best!.data, codes, rawText: best!.text, imageBase64: base64, previewUrl: preview };
}
