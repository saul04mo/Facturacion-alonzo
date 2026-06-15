import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`banesco-validator-service escuchando en el puerto ${config.port}`);
});

// Apagado limpio para Cloud Run (SIGTERM al escalar a cero / redeploy).
function shutdown(signal) {
  console.log(`Recibida señal ${signal}, cerrando servidor...`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
