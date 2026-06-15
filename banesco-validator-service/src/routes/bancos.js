import { Router } from 'express';
import { BANKS } from '../banks.js';

const router = Router();

/** GET /api/bancos — catálogo de bancos venezolanos. */
router.get('/', (req, res) => {
  res.json({ count: BANKS.length, banks: BANKS });
});

export default router;
