# Banesco Validator Service

Microservicio Node.js + Express para validar pagos contra la API de Banesco (entorno QA).
Diseñado para desplegarse en **Google Cloud Run**.

## Endpoints

| Método | Ruta                              | Descripción                                                    |
| ------ | --------------------------------- | -------------------------------------------------------------- |
| POST   | `/api/pagos/consultar-por-fecha`  | Consulta transacciones por rango de fechas.                    |
| POST   | `/api/pagos/buscar-pago-movil`    | Busca un pago móvil por número de referencia.                  |
| GET    | `/api/bancos`                     | Catálogo de 24 bancos venezolanos.                             |
| GET    | `/health`                         | Healthcheck para Cloud Run.                                    |

### `POST /api/pagos/consultar-por-fecha`

```json
{ "startDt": "2026-06-01", "endDt": "2026-06-14", "amount": 150.00 }
```

`amount` es opcional. El `accountId` se toma de la variable de entorno `BANESCO_ACCOUNT_ID`.

### `POST /api/pagos/buscar-pago-movil`

```json
{ "referenceNumber": "012345", "phoneNum": "04141234567", "bankId": "0134", "startDt": "2026-06-14" }
```

## Variables de entorno

Ver [`.env.example`](./.env.example). Todas las credenciales se inyectan por entorno:

| Variable                | Descripción                                          |
| ----------------------- | ---------------------------------------------------- |
| `PORT`                  | Puerto de escucha (Cloud Run lo inyecta; def. 8080). |
| `BANESCO_SSO_URL`       | Endpoint del token OAuth.                            |
| `BANESCO_API_URL`       | Endpoint de consulta de transacciones.              |
| `BANESCO_CLIENT_ID`     | Client ID (Basic Auth).                             |
| `BANESCO_CLIENT_SECRET` | Client Secret (Basic Auth).                         |
| `BANESCO_USERNAME`      | Usuario (grant_type=password).                      |
| `BANESCO_PASSWORD`      | Contraseña (grant_type=password).                   |
| `BANESCO_ACCOUNT_ID`    | Cuenta para consultas por rango de fechas.          |

El token OAuth se cachea en memoria y se refresca automáticamente antes de expirar.
Ante un `401` se invalida la caché y se reintenta la petición una vez.

## Desarrollo local

```bash
cd banesco-validator-service
npm install
cp .env.example .env   # y completa los valores reales (en Windows: copy .env.example .env)
npm run dev            # arranca con --watch (recarga al guardar)
# o: npm start
```

Probar:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/bancos
curl -X POST http://localhost:8080/api/pagos/consultar-por-fecha \
  -H "Content-Type: application/json" \
  -d '{"startDt":"2026-06-01","endDt":"2026-06-14"}'
```

## Despliegue a Cloud Run

Requiere `gcloud` autenticado y un proyecto seleccionado
(`gcloud auth login`, `gcloud config set project TU_PROYECTO`).

### 1. Crear los secretos en Secret Manager

```bash
gcloud services enable secretmanager.googleapis.com run.googleapis.com cloudbuild.googleapis.com

# Crear cada secreto (ejemplo con BANESCO_CLIENT_SECRET; repetir para los demás)
printf 'tu-client-secret' | gcloud secrets create BANESCO_CLIENT_SECRET --data-file=-
printf 'tu-client-id'     | gcloud secrets create BANESCO_CLIENT_ID     --data-file=-
printf 'tu-usuario'       | gcloud secrets create BANESCO_USERNAME      --data-file=-
printf 'tu-password'      | gcloud secrets create BANESCO_PASSWORD      --data-file=-
printf 'tu-account-id'    | gcloud secrets create BANESCO_ACCOUNT_ID    --data-file=-

# Para actualizar un secreto existente (nueva versión):
# printf 'nuevo-valor' | gcloud secrets versions add BANESCO_CLIENT_SECRET --data-file=-
```

Otorga acceso a los secretos a la cuenta de servicio que usa Cloud Run
(por defecto la de Compute, `PROJECT_NUMBER-compute@developer.gserviceaccount.com`):

```bash
PROJECT_NUMBER=$(gcloud projects describe TU_PROYECTO --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for S in BANESCO_CLIENT_SECRET BANESCO_CLIENT_ID BANESCO_USERNAME BANESCO_PASSWORD BANESCO_ACCOUNT_ID; do
  gcloud secrets add-iam-policy-binding "$S" \
    --member="serviceAccount:${SA}" \
    --role="roles/secretmanager.secretAccessor"
done
```

### 2. Desplegar

Desde la carpeta `banesco-validator-service/` (Cloud Run construye la imagen con el Dockerfile):

```bash
gcloud run deploy banesco-validator-service \
  --source . \
  --region us-east1 \
  --allow-unauthenticated \
  --set-env-vars "BANESCO_SSO_URL=https://sso-sso-project.apps.desplakur3.desintra.banesco.com/auth/realms/realm-api-qa/protocol/openid-connect/token,BANESCO_API_URL=https://sid-validador-consulta-de-transacciones-api-qa-production.apps.desplakur3.desintra.banesco.com/transactions/financial-account/transactions" \
  --set-secrets "BANESCO_CLIENT_ID=BANESCO_CLIENT_ID:latest,BANESCO_CLIENT_SECRET=BANESCO_CLIENT_SECRET:latest,BANESCO_USERNAME=BANESCO_USERNAME:latest,BANESCO_PASSWORD=BANESCO_PASSWORD:latest,BANESCO_ACCOUNT_ID=BANESCO_ACCOUNT_ID:latest"
```

> No es necesario fijar `PORT`: Cloud Run lo inyecta y el servicio lo lee de `process.env.PORT`.
> Ajusta `--region` y `--allow-unauthenticated` según tus necesidades (usa
> `--no-allow-unauthenticated` si el servicio debe ser privado).

### 3. Verificar

```bash
URL=$(gcloud run services describe banesco-validator-service --region us-east1 --format='value(status.url)')
curl "$URL/health"
```

## Estructura

```
banesco-validator-service/
├── src/
│   ├── server.js          # arranque del servidor (listen + apagado limpio)
│   ├── app.js             # configuración de Express y manejo de errores
│   ├── config.js          # lectura de variables de entorno
│   ├── banescoClient.js   # token OAuth con caché + consulta de transacciones
│   ├── banks.js           # catálogo de bancos
│   └── routes/
│       ├── pagos.js       # /api/pagos/*
│       └── bancos.js      # /api/bancos
├── Dockerfile
├── .dockerignore
├── .env.example
└── README.md
```
