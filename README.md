# 📸 Instagram Web Scraper Experto

Este es un potente script de automatización basado en **Playwright** diseñado para extraer y analizar datos profundos de perfiles de Instagram de forma segura y privada.

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
2. **Introduce tu sesión:**
   Cuando el programa lo pida, pega tu `sessionid` o el JSON de tus cookies y pulsa **ENTER**.
3. **Obtén los resultados:**
   El programa analizará el perfil y las últimas 12 publicaciones, generando un informe detallado en `resultado.json`.

## 🧠 ¿Cómo funciona por dentro?

El programa realiza un proceso de tres etapas para entregarte datos precisos:

### 1. Extracción de Perfil
Accede a la cabecera del perfil para obtener:
- **Métricas Base:** Seguidores, seguidos y número de posts.
- **Identidad:** Nombre real, biografía, foto de perfil y si está verificada.
- **Privacidad:** Detecta automáticamente si la cuenta es privada.

### 2. Análisis de Engagement (Interacción)
Navega una a una por las últimas 12 publicaciones para extraer:
- Likes y comentarios reales.
- **Engagement Rate:** Calcula el porcentaje de interacción basándose en el promedio de likes/comentarios dividido por el total de seguidores.
- **Distribución de Contenido:** Clasifica si el usuario sube más Imágenes, Videos o Carruseles.

### 3. Inteligencia de Datos
- **Frecuencia de Publicación:** Analiza las fechas de los posts para determinar cuántas veces publica al mes.
- **Mejores Horarios/Días:** Identifica cuándo tiene más actividad el perfil.
- **Hashtags y Menciones:** Extrae las etiquetas y menciones más frecuentes para entender su nicho.

## 📁 Archivos del Proyecto
- `index.js`: El motor principal de scraping y análisis.
- `resultado.json`: Informe final estructurado y listo para usar.

## ⚠️ Nota Legal
Este proyecto tiene fines educativos. Úsalo con responsabilidad respetando los límites de Instagram para evitar bloqueos.
