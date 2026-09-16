# APIs del sistema — catálogo y disponibilidad

Dos endpoints para que un bot (WhatsApp, agente IA, n8n) pueda responder
"¿qué tienen?", "¿en qué talla?", "¿cuánto cuesta?" y "¿hay disponible?".

| API | Para qué | Devuelve |
|---|---|---|
| `/.netlify/functions/products` | Qué se vende | producto, **URL**, **tallas**, **precios** |
| `/.netlify/functions/availability` | Si hay y a cuánto en Bs. | **tasa BCV**, stock en **tienda**, **almacén** y **total** |
| `/.netlify/functions/create-order` | Finalizar la orden | crea la **factura**, descuenta stock, registra el cliente |

Están separadas a propósito: el catálogo cambia poco y se cachea 60 s; el
stock cambia con cada venta y se cachea 15 s.

---

## Autenticación

Las dos exigen una llave en la cabecera:

```
x-api-key: <CATALOG_API_KEY>
```

También se acepta `Authorization: Bearer <llave>`. **No** se acepta por query
string: las URLs quedan escritas en los logs de Netlify y en los referrers.

Configurar en **Netlify → Site settings → Environment variables**:

| Variable | Para qué |
|---|---|
| `CATALOG_API_KEY` | La llave. Generar con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `STORE_BASE_URL` | Dominio de la tienda (por defecto `https://alonzocollection.com`) |
| `FIREBASE_SERVICE_ACCOUNT` | Ya existe — la usan las otras funciones |

Si falta `CATALOG_API_KEY`, la API responde **500 y no deja pasar a nadie**.
Un despliegue al que se le olvidó la variable no queda abierto.

Respuestas de error: `401` llave mala o ausente · `400` faltan parámetros ·
`404` no existe · `300` la búsqueda es ambigua · `500` error del servidor.

---

## API 1 — `GET /.netlify/functions/products`

### Parámetros (todos opcionales; acepta alias en español)

| Parámetro | Alias | Ejemplo |
|---|---|---|
| `q` | `buscar` | `?q=blazer beige` — búsqueda libre por nombre, categoría, color |
| `id` | | `?id=dB8KawjmJ15k444vMY77` |
| `barcode` | `codigo` | `?codigo=7501234567890` |
| `category` | `categoria` | `?categoria=CAMISAS` |
| `gender` | `genero` | `?genero=Mujer` |
| `size` | `talla` | `?talla=M` — solo productos que tengan esa talla |
| `limit` | `limite` | `?limit=5` (por defecto 10, máximo 50) |
| `includeHidden` | `incluirOcultos` | `?includeHidden=1` — incluye los ocultos en la web |

Sin parámetros lista el catálogo completo en orden alfabético.

### Ejemplo

```bash
curl -H "x-api-key: $CATALOG_API_KEY" \
  "https://<sitio>.netlify.app/.netlify/functions/products?q=blazer%20beige&limit=1"
```

```json
{
  "count": 1,
  "totalMatches": 2,
  "products": [{
    "id": "dB8KawjmJ15k444vMY77",
    "name": "BLAZER BEIGE",
    "category": "BLAZER",
    "gender": "Mujer",
    "url": "https://alonzocollection.com/product/blazer-blazer-beige-dB8KawjmJ15k444vMY77",
    "image": "https://firebasestorage.googleapis.com/...",
    "images": ["..."],
    "sizes": ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "S/T"],
    "colors": ["BEIGE"],
    "priceFrom": 40,
    "priceTo": 40,
    "offer": null,
    "variants": [
      { "size": "S", "color": "BEIGE", "price": 40, "finalPrice": 40, "onSale": false, "barcode": null }
    ]
  }],
  "text": "BLAZER BEIGE — $40. Tallas: S, M, L... https://alonzocollection.com/product/..."
}
```

- `finalPrice` es lo que paga el cliente (con la oferta ya aplicada);
  `price` es el precio de lista. `onSale` dice si difieren.
- `priceFrom` / `priceTo` son el rango del producto; si todas las variantes
  valen igual, los dos son el mismo número.
- `S/T` = "sin talla" (accesorios, prenda única).
- `totalMatches` es cuántos había antes de cortar por `limit`.

---

## API 2 — `GET /.netlify/functions/availability`

Hay que identificar el producto: **`id`** (recomendado), `barcode` o `q`.

| Parámetro | Alias | Ejemplo |
|---|---|---|
| `id` | | `?id=dB8KawjmJ15k444vMY77` |
| `barcode` | `codigo` | `?codigo=7501234567890` |
| `q` | `buscar` | `?q=blazer beige` |
| `size` | `talla` | `?talla=M` — limita la respuesta a esa talla |
| `rate` | `tasa` | `?tasa=bcv` — fuerza la tasa del BCV |

### Ejemplo

```bash
curl -H "x-api-key: $CATALOG_API_KEY" \
  "https://<sitio>.netlify.app/.netlify/functions/availability?id=dB8KawjmJ15k444vMY77&talla=M"
```

```json
{
  "rates": {
    "bcv": 832.49, "eur": 968.07, "bcvDate": "2026-09-11",
    "pos": 832.48, "fetchedAt": "2026-09-11T20:02:15.285Z", "errors": []
  },
  "rateUsed": { "source": "pos", "value": 832.48 },
  "product": { "id": "...", "name": "BLAZER BEIGE", "url": "https://..." },
  "variants": [{
    "size": "M", "color": "BEIGE",
    "price": 40, "finalPrice": 40, "onSale": false,
    "priceBs": 33299.20,
    "stock": { "store": 4, "warehouse": 4, "inTransit": 0, "available": 8, "total": 8 }
  }],
  "totals": { "store": 4, "warehouse": 4, "inTransit": 0, "available": 8, "total": 8 },
  "inStock": true,
  "text": "BLAZER BEIGE (BLAZER)\n• Talla M BEIGE — $40 (Bs. 33.299,20) — 4 en tienda y 4 en almacén (total 8)..."
}
```

### Los números de stock

| Campo | Qué es |
|---|---|
| `store` | Unidades en la **tienda física** |
| `warehouse` | Unidades en el **almacén** |
| `inTransit` | Salieron del almacén, la tienda todavía no las recibió |
| `available` | **`store + warehouse`** — lo que se puede vender HOY |
| `total` | `store + warehouse + inTransit` — el inventario contable |

**Para cotizarle a un cliente se usa `available`, no `total`.** El tránsito es
mercancía que nadie tiene en la mano todavía; prometerla es prometer lo que no
se puede despachar. `total` está para cuadrar inventario, no para vender.

`totals` suma todas las variantes devueltas: si se filtró por `?talla=M`, es
el total de esa talla; si no, el del producto completo.

### Las dos tasas

- `rates.bcv` — la que publica hoy bcv.org.ve (se lee en vivo).
- `rates.pos` — `config/exchangeRate`, **la que realmente factura el sistema**.

`priceBs` se calcula con **la del POS**, porque cotizarle al cliente una cifra
que después la caja no le va a cobrar es peor que no cotizarle nada. Normalmente
son iguales o casi (832,48 vs 832,49 en el ejemplo). `rateUsed` dice cuál se
usó; con `?tasa=bcv` se fuerza la del BCV.

Si el BCV no responde, `priceBs` viene en `null` (no en 0 — un 0 se lee como
"es gratis") y el motivo queda en `rates.errors`.

### Búsquedas ambiguas → `300`

Con `?q=`, si coinciden varios productos y ninguno gana claro, responde **300**
con los candidatos en vez de adivinar:

```json
{
  "error": "Hay más de un producto que coincide.",
  "matches": 14,
  "options": [{ "id": "...", "name": "BLAZER BEIGE", "url": "..." }],
  "text": "Encontré 14 productos que coinciden. ¿Cuál te interesa?\n1. ..."
}
```

Si el nombre coincide **exacto** con lo buscado y ningún otro lo hace, resuelve
directo con 200. `?q=blazer beige` → responde; `?q=blazer` → pide precisar.

---

## API 3 — `POST /.netlify/functions/create-order`

Cierra la venta: crea la factura, descuenta el stock y registra al cliente.
Hace lo mismo que un cajero cerrando en el POS, **en una sola transacción
atómica** — o queda todo, o no queda nada.

### Body

```json
{
  "idempotencyKey": "wa-584141234567-1758000000",
  "client": {
    "name": "Juan Pérez",
    "rif_ci": "12345678",
    "phone": "04141234567",
    "address": "Av. Bolívar, Valencia"
  },
  "items": [
    { "productId": "dB8KawjmJ15k444vMY77", "size": "M", "color": "BEIGE", "quantity": 2 }
  ],
  "deliveryType": "local",
  "deliveryCostUsd": 3,
  "payments": [
    { "method": "Pago movil", "amountVes": 70337.52, "ref": "123456" }
  ],
  "expectedTotalUsd": 83,
  "observation": "Pedido por WhatsApp",
  "sellerName": "BOT WHATSAPP",
  "dryRun": false
}
```

| Campo | Obligatorio | Nota |
|---|---|---|
| `client.name`, `client.rif_ci` | **sí** | Se busca por cédula o teléfono; si no existe se crea |
| `items[]` | **sí** | Máximo 50. La variante se ubica por `size`(+`color`), `variantIndex` o `barcode` |
| `deliveryType` | no | `showroom` · `pickup` · `local` · `national` · `web` (default `web`) |
| `deliveryCostUsd` | no | 0 a 200 |
| `payments[]` | no | Sin pago → la factura entra como **'Pendiente de pago'** |
| `idempotencyKey` | **muy recomendado** | Evita cobrar dos veces si el bot reintenta |
| `expectedTotalUsd` | recomendado | Si no cuadra con el servidor, se rechaza |
| `dryRun` | no | Valida todo y **no escribe nada** |
| `branch` | no | `store` / `warehouse`. Por defecto sale del `deliveryType` |

**Precios y tasa NO se toman del request.** Se leen de Firestore y de
`config/exchangeRate`. El bot no puede fijar el precio de una venta.

### Métodos de pago válidos

`Pago movil` · `Punto de venta (Débito)` · `Transferencia bancaria` ·
`Efectivo (Bs)` · `Efectivo ($)` · `Zelle` · `Zinli` · `Binance` · `Paypal` ·
`Crédito`

Se acepta también el id (`pago-movil`, `efectivo-usd`…). Un método fuera de la
lista se rechaza con 400, para que el cierre de caja no se encuentre con algo
que no sabe clasificar. Si mandas `amountVes` se calcula el USD con la tasa del
servidor, y al revés.

### Respuesta 201

```json
{
  "invoiceId": "AbC123...",
  "numericId": 6313,
  "subtotal": 80, "offerDiscount": 0, "deliveryCostUsd": 3,
  "total": 83, "totalBs": 70337.52, "exchangeRate": 847.44,
  "paidUsd": 83, "pendingUsd": 0, "isPaid": true,
  "branch": "warehouse",
  "clientId": "XyZ...",
  "items": [...], "payments": [...],
  "text": "Pedido #6313 confirmado para Juan Pérez
• BLAZER BEIGE M / BEIGE x2 — $80
Envío: $3
Total: $83 (Bs. 70.337,52)
Pago recibido, queda por verificar."
}
```

### De qué sucursal sale la mercancía

| `deliveryType` | Sucursal | Por qué |
|---|---|---|
| `showroom`, `pickup` | **tienda** | El cliente la retira en persona |
| `local`, `national`, `web` | **almacén** | Se despacha para envío |

Mismo criterio que `branchFromDeliveryType()` en `src/utils/branchUtils.ts`.

> **Ojo:** la orden se descuenta de **una sola** sucursal. Si `availability`
> dice 8 disponibles (4 tienda + 4 almacén) y se piden 6 **para envío**, la
> orden falla: en el almacén solo hay 4. Físicamente es correcto — para
> despachar esas 2 hay que transferirlas primero desde la tienda. El 409 dice
> cuántas hay en cada sede.

### Estado inicial de la factura

| Situación | `status` |
|---|---|
| Pagada + `showroom` | `Finalizado` |
| Pagada + cualquier otro envío | `Por Preparar` |
| Sin pago o pago parcial | `Pendiente de pago` |

El pago queda **reportado, no verificado**: entra en `payments` con su
referencia y alguien lo confirma desde el panel de Facturas.

### Errores

| Código | Cuándo | Qué trae |
|---|---|---|
| `400` | Faltan datos, talla inexistente, método de pago desconocido | El motivo exacto |
| `401` | Llave mala o ausente | |
| `404` | El `productId` no existe | |
| `409` | **Sin stock** o **el total cambió** | `faltantes[]` con pedido vs disponible por sede, y cuántas hay en la otra |
| `500` | Error del servidor | No se creó nada |

Ejemplo de 409 por stock:

```json
{
  "error": "No hay stock suficiente para cerrar la orden.",
  "faltantes": [{
    "productName": "BLAZER BEIGE", "size": "S",
    "pedido": 99, "disponible": 15, "branch": "warehouse",
    "enLaOtraSucursal": 2
  }],
  "text": "BLAZER BEIGE talla S: pediste 99 y quedan 15 en almacén."
}
```

### Idempotencia — por qué importa

Si el bot manda la orden y se le cae la conexión antes de leer la respuesta, va
a reintentar. Sin protección, eso es **una segunda factura y stock descontado
dos veces**.

Mandando `idempotencyKey` (por ejemplo `wa-<teléfono>-<timestamp del pedido>`),
el reintento devuelve **200** con la factura que ya se creó y `duplicate: true`,
sin cobrar ni descontar de nuevo. Las llaves viven en la colección `botOrders`.

### `dryRun` — validar antes de cobrar

Con `"dryRun": true` corre **todo** (stock, precios, total, tasa) y no escribe
nada. Devuelve 200 con el total calculado y `numericIdPreview`.

Sirve para el flujo natural del bot:
1. `dryRun: true` → "Son $83 (Bs. 70.337,52), ¿confirmas?"
2. El cliente paga y manda la referencia.
3. La misma llamada con `dryRun: false` + `expectedTotalUsd: 83`.

Si entre el paso 1 y el 3 alguien compró la última talla M, el paso 3 devuelve
409 y el bot avisa en vez de vender algo que no existe.

### Ejemplo

```bash
curl -X POST "https://admin.alonzoapp.com/.netlify/functions/create-order"   -H "x-api-key: $CATALOG_API_KEY"   -H "Content-Type: application/json"   -d '{
    "idempotencyKey": "wa-584141234567-1758000000",
    "client": { "name": "Juan Pérez", "rif_ci": "12345678", "phone": "04141234567" },
    "items": [{ "productId": "dB8KawjmJ15k444vMY77", "size": "M", "quantity": 2 }],
    "deliveryType": "local", "deliveryCostUsd": 3,
    "payments": [{ "method": "Pago movil", "amountVes": 70337.52, "ref": "123456" }],
    "dryRun": true
  }'
```

### Cómo deshacer una orden mal creada

Desde el panel de Facturas, cancelarla: el POS la pasa a `Cancelado` y
**devuelve el stock**. No borrar el documento a mano — las reglas lo prohíben
(`allow delete: if false`) y dejaría el inventario descuadrado.

---

## El campo `text`

Las dos APIs traen un `text` ya redactado en español, listo para mandar por
WhatsApp sin que el bot tenga que armar la frase (ni inventar cifras):

```
BLAZER BEIGE (BLAZER)
• Talla M BEIGE — $40 (Bs. 33.299,20) — 4 en tienda y 4 en almacén (total 8)
Disponible en total: 8 unidades.
Tasa usada: Bs. 832,48 por dólar.
```

El JSON estructurado está igual para quien prefiera armar su propio mensaje.

---

## Qué NO se expone

- Productos con `active: false` (ocultos en la web).
- Categorías ocultas desde el POS (`config/webSettings.hiddenCategories`) —
  mismo criterio que usa el feed de Meta.
- Costos, proveedores, ventas, clientes: estas APIs solo leen `products`,
  `config/webSettings` y `config/exchangeRate`.

Con `?includeHidden=1` en `products` se ven los ocultos (uso interno).

---

## Probar en local

```bash
netlify dev     # sirve las functions en http://localhost:8888
curl -H "x-api-key: <llave>" "http://localhost:8888/.netlify/functions/products?q=blazer"
```

En local, si no hay `CATALOG_API_KEY` en el `.env`, la API responde 500 a
propósito. Las credenciales de Firestore caen al `serviceAccountKey.json`
del repo cuando no está `FIREBASE_SERVICE_ACCOUNT`.

> `npm run dev` (Vite a secas) **no** sirve las functions: el catch-all del SPA
> devuelve `index.html` con status 200. Hay que usar `netlify dev`.
