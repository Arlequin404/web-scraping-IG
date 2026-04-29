# 📸 Instagram Web Scraper Experto

Este es un potente script de automatización basado en **Playwright** diseñado para extraer y analizar datos de perfiles de Instagram y sus publicaciones de forma segura y privada.

## 🔐 Seguridad y Privacidad
A diferencia de otros scrapers, este programa **NO guarda tus tokens, contraseñas ni cookies en el disco**. Todo se maneja en la memoria temporal durante la ejecución. Al cerrar el programa, no queda rastro de tu sesión en la carpeta del proyecto.

## 🚀 Instalación Rápida

1. Asegúrate de tener [Node.js](https://nodejs.org/) instalado.
2. Instala las dependencias:
   ```bash
   npm install
   ```
3. Instala el motor del navegador:
   ```bash
   npx playwright install chromium
   ```

## 📊 Cómo usar el programa

1. **Ejecuta el análisis:**
   ```bash
   node index.js https://www.instagram.com/nombre_de_usuario/
   ```
   *(Si no proporcionas una URL, por defecto analizará el perfil oficial de Instagram).*

2. **Introduce tu sesión:**
   Cuando el programa lo pida en la consola, pega tu `sessionid`, una cadena de cookies separada por punto y coma, o el JSON completo de tus cookies y pulsa **ENTER**.

3. **Obtén los resultados:**
   El programa analizará el perfil y las últimas publicaciones (hasta 12). Al finalizar, generará dos archivos:
   - `resultado_raw.json`: Todos los datos extraídos en crudo.
   - `resultado_limpio.json`: Un resumen estructurado, limpio y fácil de leer.

## 🧠 ¿Qué datos extrae?

El programa realiza un proceso en etapas para entregarte información valiosa:

### 1. Perfil del Usuario
- **Métricas Base:** Número de seguidores, cuentas seguidas y cantidad total de publicaciones.
- **Identidad:** Nombre de usuario, biografía completa, URL de foto de perfil y enlaces externos.
- **Privacidad:** Detecta automáticamente si la cuenta es privada (en cuyo caso, solo guarda la información básica del perfil).

### 2. Publicaciones
Extrae información detallada de los últimos posts (hasta 12):
- **Métricas:** Likes, comentarios y visualizaciones (en caso de Reels/Videos).
- **Contenido:** Tipo de publicación (Imagen, Carrusel, Reel), fecha de publicación, texto descriptivo (caption) y ubicación etiquetada.
- **Engagement Rate:** Calcula el porcentaje de interacción individual de cada post basado en la cantidad de seguidores.

---

## 📖 Documentación Técnica: Lógica y Proceso del Scraper

El script (`index.js`) sigue una arquitectura secuencial y modular. Utiliza **Playwright** porque su capacidad de controlar navegadores modernos en modo headless permite interactuar con páginas dinámicas (SPA) como Instagram de manera similar a como lo haría un usuario real, superando las barreras del scraping estático (ej. Axios).

### Flujo de Ejecución (Paso a Paso)

#### Fase 1: Inicialización y Autenticación
1. **Normalización de URL (`normalizeUrl`):** Asegura que la entrada tenga el formato `https://www.instagram.com/usuario/`.
2. **Solicitud de Cookies (`askCookies`):** Pide al usuario sus credenciales. **Lógica de seguridad:** Los datos solo se mantienen en la memoria RAM y se inyectan en el contexto de Playwright temporalmente. No hay rastros en disco.
3. **Lanzamiento:** Abre Chromium y prepara el contexto con la sesión inyectada.

#### Fase 2: Extracción del Perfil (`extractProfile`)
1. Navega a la URL y usa `dismissDialogs` para cerrar posibles avisos de cookies.
2. Ejecuta código en la página para extraer:
   - Identidad (Nombre, bio extraída del `<meta name="description">`).
   - Métricas (Seguidores, seguidos y posts desde los textos del `<header>`).
   - Privacidad (Busca "esta cuenta es privada").
   *(Si es privada, se aborta el escaneo de posts y se exporta solo el perfil).*

#### Fase 3: Recolección de Enlaces (`collectPostLinks`)
1. Hace "scrolls" automáticos hacia abajo (`autoScrollProfile`) emulando comportamiento humano para forzar el *lazy-loading*.
2. Recolecta hasta 12 enlaces únicos que pertenezcan a posts (`/p/`) o reels (`/reel/`).

#### Fase 4: Scraping de Publicaciones (`scrapePost`)
Para cada enlace:
1. Abre nueva pestaña, navega al post y espera a que el `<article>` cargue.
2. Extrae las **Métricas ocultas** utilizando expresiones regulares (RegEx) en el `og:description` y texto visible.
3. Convierte textos (como "1.2M") a valores numéricos reales con `parseCompactNumber`.
4. Calcula el **Engagement Rate**: `((likes + comentarios) / seguidores) * 100`.

#### Fase 5: Estructuración y Exportación
1. Limpia los textos (`cleanText`) para borrar saltos de línea raros o espacios invisibles.
2. Estructura el JSON en `buildSimpleReport` y lo guarda usando la librería `fs` en `resultado_raw.json` y `resultado_limpio.json`.

### Lógica Clave de Estabilidad
- **Retardos Estratégicos:** Uso de `waitForTimeout` simulando ritmo humano y evitando bloqueos (Rate Limiting).
- **Resiliencia:** Bloques `try...catch` por cada publicación. Si falla una, suma a `errorCount` y continúa, en lugar de detener el script completo.

---

## 📁 Archivos del Proyecto
- `index.js`: El motor principal de scraping con la lógica de Playwright.
- `resultado_raw.json` y `resultado_limpio.json`: Informes generados tras la ejecución exitosa.

## ⚠️ Nota Legal
Este proyecto tiene fines puramente educativos. Úsalo con responsabilidad y respetando los términos de servicio y límites de Instagram para evitar bloqueos en tu cuenta.
