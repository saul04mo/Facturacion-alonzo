# Envíos por WhatsApp — configuración

Página del POS: **Envíos WhatsApp** (`/envios`, permiso `canAccessEnvios`).
Funciones: `whatsapp-send.cjs` (manda la plantilla) y `whatsapp-webhook.cjs` (estados).
Historial: colección `shipmentNotifications/{EMPRESA}_{guía}` (solo la escriben las funciones).

## ⚠️ Desde el 2026-09-29 se manda por Dismoncatech, NO directo a Meta

`whatsapp-send` ya no habla con Meta: le pasa la guía a **Dismoncatech** (la plataforma
que atiende el WhatsApp de Alonzo), que la manda por el mismo número. Así la guía queda en
el hilo del cliente en el inbox, el bot sabe que se la mandaron si el cliente pregunta, y
los estados (entregado, leído) llegan solos.

**NO configures `whatsapp-webhook` en Meta.** Meta acepta UN solo webhook por app: si se
apunta al POS, Dismoncatech deja de recibir los mensajes de los clientes y el bot de Alonzo
se queda mudo. `whatsapp-webhook.cjs` queda sin usar.

## 1. Plantilla

`pedido_en_camino_guia` (Utilidad, español), **aprobada**: encabezado con imagen (la foto
de la guía) y el cuerpo con `{{1}}` nombre · `{{2}}` empresa · `{{3}}` número de guía.
Las plantillas nuevas se crean en el WhatsApp de Alonzo; si cambia el nombre, ajusta
`WHATSAPP_TEMPLATE_NAME`.

## 2. Variables de entorno en Netlify

| Variable                  | Valor |
|---------------------------|-------|
| `DISMONCATECH_API_KEY`    | la llave de API del bot de Alonzo en Dismoncatech (`dmt_…`), **ya cargada** |
| `DISMONCATECH_API_URL`    | opcional, por defecto la de producción |
| `WHATSAPP_TEMPLATE_NAME`  | opcional, por defecto `pedido_en_camino_guia` |
| `WHATSAPP_TEMPLATE_LANG`  | opcional, por defecto `es` |

`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` y
`WHATSAPP_APP_SECRET` **ya no hacen falta**.

## 3. Estados

El historial del POS (`shipmentNotifications`) queda en "enviado" con el id del mensaje en
Dismoncatech (`dismoncatechId`). Entregado, leído o fallido se ven en el inbox de
Dismoncatech, o consultando `GET …/enviar-plantilla?referencia=<EMPRESA>_<guía>` con la
llave.

## 4. Deploy

Recordatorio: `git push` no deploya. Hay que correr `netlify deploy --prod`, y las
reglas de Firestore van aparte: `firebase deploy --only firestore:rules`.

## Cómo lee las guías

1. **Códigos** (zxing-wasm, en el navegador, gratis):
   - **MRW**: el QR trae guía, destinatario, teléfono y cédula → listo, no se usa IA.
   - **Zoom**: DataMatrix/barras traen solo la guía (exacta).
   - **Tealca**: barras traen la guía (`6001102·84873145·001·BCL·001·000850`).
2. **IA** (función `guide-read`): ChatGPT (OpenAI) o Claude, lee nombre, cédula, teléfono y
   destino de la foto. ~1 centavo de dólar por foto. La guía de los códigos manda sobre la de la IA.
   **La API key se carga en el POS**: Envíos → "Lectura con IA" (solo administradores). Se guarda
   en `secrets/aiConfig`, que el navegador no puede leer (lo escribe la función `ai-settings`).
3. **OCR** (Tesseract, en el navegador) solo si la IA no está configurada o falla.

Después se cruza con Clientes (se cargan todos) por cédula → teléfono → nombre; una cédula
con un dígito distinto vale si coincide el nombre. Se envía al teléfono **registrado** del
cliente si lo tiene; si no, al de la guía.
