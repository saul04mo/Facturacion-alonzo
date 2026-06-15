import express from 'express';
import cors from 'cors';
import pagosRouter from './routes/pagos.js';
import bancosRouter from './routes/bancos.js';
import { BanescoError } from './banescoClient.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Healthcheck para Cloud Run (no depende de Banesco).
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'banesco-validator-service' });
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
      console.error('[banesco]', err.message, err.details ?? '');
      return res.status(502).json({
        error: 'Error comunicándose con Banesco',
        detail: err.message,
        upstreamStatus: err.status ?? null,
      });
    }
    console.error('[error]', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}
