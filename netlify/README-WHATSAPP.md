# Envíos por WhatsApp — configuración

Página del POS: **Envíos WhatsApp** (`/envios`, permiso `canAccessEnvios`).
Funciones: `whatsapp-send.cjs` (manda la plantilla) y `whatsapp-webhook.cjs` (estados).
Historial: colección `shipmentNotifications/{EMPRESA}_{guía}` (solo la escriben las funciones).

## 1. Plantilla en Meta

WhatsApp Manager → Plantillas de mensajes → Crear

| Campo       | Valor |
|-------------|-------|
| Categoría   | **Utilidad** (Utility) |
| Nombre      | `comprobante_envio` |
| Idioma      | Español (`es`) |
| Encabezado  | **Multimedia → Imagen** (muestra: cualquier foto de una guía) |
| Pie         | `Tienda Alonzo` |

Cuerpo (las variables van en este orden, el código las manda así):

```
Hola {{1}}, tu pedido ya va en camino 📦

Empresa de envío: {{2}}
Número de guía: {{3}}

Te adjuntamos la foto de tu guía para que puedas hacerle seguimiento y retirar tu paquete.

Cualquier duda, comunícate al +58 412-3380976. ¡Gracias por tu compra!
```

Ejemplos para la revisión: `{{1}}` = `María` · `{{2}}` = `MRW` · `{{3}}` = `013302008001092`

> Si cambias el nombre o el idioma, ajusta `WHATSAPP_TEMPLATE_NAME` / `WHATSAPP_TEMPLATE_LANG`.
> Si agregas o quitas variables, hay que tocar el bloque `body` en `whatsapp-send.cjs`.

## 2. Variables de entorno en Netlify

Site configuration → Environment variables:

| Variable                   | De dónde sale |
|----------------------------|---------------|
| `WHATSAPP_TOKEN`           | Business Settings → Usuarios del sistema → generar token **permanente** con `whatsapp_business_messaging` y `whatsapp_business_management` |
| `WHATSAPP_PHONE_NUMBER_ID` | App de Meta → WhatsApp → API Setup → *Phone number ID* (no es el número) |
| `WHATSAPP_TEMPLATE_NAME`   | opcional, default `comprobante_envio` |
| `WHATSAPP_TEMPLATE_LANG`   | opcional, default `es` |
| `WHATSAPP_VERIFY_TOKEN`    | un texto cualquiera que inventes (para el webhook) |
| `WHATSAPP_APP_SECRET`      | App de Meta → Configuración → Básica → *Clave secreta* (valida la firma del webhook) |

| `ANTHROPIC_API_KEY`        | console.anthropic.com → API Keys. La usa `guide-read` para leer las fotos con IA |

`FIREBASE_SERVICE_ACCOUNT` ya existe (la usan las otras funciones).

## 3. Webhook (entregado / leído / falló)

App de Meta → WhatsApp → Configuration → Webhook:

- Callback URL: `https://<tu-sitio>.netlify.app/.netlify/functions/whatsapp-webhook`
- Verify token: el mismo `WHATSAPP_VERIFY_TOKEN`
- Suscribirse al campo **messages**

## 4. Deploy

Recordatorio: `git push` no deploya. Hay que correr `netlify deploy --prod`, y las
reglas de Firestore van aparte: `firebase deploy --only firestore:rules`.

## Cómo lee las guías

1. **Códigos** (zxing-wasm, en el navegador, gratis):
   - **MRW**: el QR trae guía, destinatario, teléfono y cédula → listo, no se usa IA.
   - **Zoom**: DataMatrix/barras traen solo la guía (exacta).
   - **Tealca**: barras traen la guía (`6001102·84873145·001·BCL·001·000850`).
2. **IA** (función `guide-read`, Claude Opus 5.5): lee nombre, cédula, teléfono y destino
   de la foto. ~1–2 centavos de dólar por foto. La guía de los códigos manda sobre la de la IA.
3. **OCR** (Tesseract, en el navegador) solo si la IA no está configurada o falla.

Después se cruza con Clientes (se cargan todos) por cédula → teléfono → nombre; una cédula
con un dígito distinto vale si coincide el nombre. Se envía al teléfono **registrado** del
cliente si lo tiene; si no, al de la guía.
