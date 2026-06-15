import 'dotenv/config';

/**
 * Lee una variable de entorno y advierte si falta (no lanza para permitir
 * que /health responda aunque la configuración esté incompleta).
 */
function readEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.warn(`[config] Falta la variable de entorno ${name}`);
  }
  return value;
}

export const config = {
  // Cloud Run inyecta PORT; por defecto 8080.
  port: parseInt(process.env.PORT || '8080', 10),
  banesco: {
    ssoUrl: readEnv('BANESCO_SSO_URL'),
    apiUrl: readEnv('BANESCO_API_URL'),
    clientId: readEnv('BANESCO_CLIENT_ID'),
    clientSecret: readEnv('BANESCO_CLIENT_SECRET'),
    username: readEnv('BANESCO_USERNAME'),
    password: readEnv('BANESCO_PASSWORD'),
    accountId: readEnv('BANESCO_ACCOUNT_ID'),
  },
};
