import { Router } from 'express';
import { consultarPorFecha, buscarPagoMovil } from '../banescoClient.js';

const router = Router();

/**
 * POST /api/pagos/consultar-por-fecha
 * Body: { startDt, endDt, amount? }
 */
router.post('/consultar-por-fecha', async (req, res, next) => {
  try {
    const { startDt, endDt, amount } = req.body ?? {};

    const missing = [];
    if (!startDt) missing.push('startDt');
    if (!endDt) missing.push('endDt');
    if (missing.length) {
      return res.status(400).json({ error: `Campos requeridos faltantes: ${missing.join(', ')}` });
    }

    const data = await consultarPorFecha({ startDt, endDt, amount });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/pagos/buscar-pago-movil
 * Body: { referenceNumber, phoneNum, bankId, startDt }
 */
router.post('/buscar-pago-movil', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const { referenceNumber, phoneNum, bankId, startDt } = body;

    const missing = ['referenceNumber', 'phoneNum', 'bankId', 'startDt'].filter((k) => !body[k]);
    if (missing.length) {
      return res.status(400).json({ error: `Campos requeridos faltantes: ${missing.join(', ')}` });
    }

    const data = await buscarPagoMovil({ referenceNumber, phoneNum, bankId, startDt });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
