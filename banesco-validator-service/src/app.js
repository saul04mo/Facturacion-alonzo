import express from 'express';
import cors from 'cors';
import pagosRouter from './routes/pagos.js';
import bancosRouter from './routes/bancos.js';
import { BanescoError, BanescoErrorCode, pingBanesco } from './banescoClient.js';

/**
 * HTTP con el que sale cada categoría de falla del banco.
 *
 * El 503 queda deliberadamente libre: Cloud Run devuelve 503 (con HTML, no
 * JSON) cuando el contenedor no está arriba. Si el validador también usara
 * 503 para "el banco está caído", el front no podría distinguir "mi servicio
 * se cayó" de "Banesco se cayó". Por eso todo lo que es culpa del banco sale
 * como 502/504 y la categoría exacta viaja en el campo `code`.
 */
const STATUS_BY_CODE = {
  [BanescoErrorCode.NOT_CONFIGURED]: 500,
  [BanescoErrorCode.BANK_TIMEOUT]: 504,
  [BanescoErrorCode.BANK_UNREACHABLE]: 502,
  [BanescoErrorCode.BANK_UNAVAILABLE]: 502,
  [BanescoErrorCode.BANK_AUTH]: 502,
  [BanescoErrorCode.BANK_REJECTED]: 502,
  [BanescoErrorCode.BANK_ERROR]: 502,
};

/** Fallas transitorias: al cajero se le puede ofrecer reintentar. */
const RETRYABLE_CODES = new Set([
  BanescoErrorCode.BANK_TIMEOUT,
  BanescoErrorCode.BANK_UNREACHABLE,
  BanescoErrorCode.BANK_UNAVAILABLE,
  BanescoErrorCode.BANK_ERROR,
]);

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Healthcheck para Cloud Run (no depende de Banesco).
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'banesco-validator-service' });
  });

  // Healthcheck profundo: ¿responde Banesco? Sirve para saber si una falla es
  // del validador o del banco sin tener que disparar una consulta real.
  // Siempre responde 200: el resultado va en el cuerpo.
  app.get('/health/banesco', async (req, res) => {
    try {
      await pingBanesco();
      res.json({ status: 'ok', bank: 'up' });
    } catch (err) {
      const code = err instanceof BanescoError ? err.code : 'UNKNOWN';
      res.json({
        status: 'degraded',
        bank: 'down',
        code,
        detail: err.message,
        upstreamStatus: err instanceof BanescoError ? err.status ?? null : null,
      });
    }
  });

  app.use('/api/pagos', pagosRouter);
  app.use('/api/bancos', bancosRouter);

  // 404
  app.use((req, res) => {
    res.status(404).json({ error: 'Recurso no encontrado' });
  });

  // Manejador de errores centralizado.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof BanescoError) {
      const status = STATUS_BY_CODE[err.code] ?? 502;
      const retryable = RETRYABLE_CODES.has(err.code);
      console.error(`[banesco] ${err.code} (${err.stage ?? '-'})`, err.message, err.details ?? '');
      if (retryable) res.set('Retry-After', '30');
      return res.status(status).json({
        error: 'Error comunicándose con Banesco',
        code: err.code,
        detail: err.message,
        upstreamStatus: err.status ?? null,
        stage: err.stage ?? null,
        retryable,
      });
    }
    console.error('[error]', err);
    res.status(500).json({ error: 'Error interno del servidor', code: 'INTERNAL' });
  });

  return app;
}
