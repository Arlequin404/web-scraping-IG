// Importa Playwright para controlar el navegador
const { chromium } = require('playwright');

// Importa fs para guardar el resultado en un archivo JSON
const fs = require('fs');

// Importa readline para pedir cookies por consola
const readline = require('readline');


// ======================================================
// PIDE LAS COOKIES AL USUARIO
// Acepta:
// 1) JSON completo con cookies
// 2) cadena de cookies tipo "a=b; c=d; sessionid=..."
// 3) solo el valor del sessionid
// ======================================================
function askCookies() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    console.log('🔐 Pega cookies completas, JSON o solo sessionid:');
    rl.question('> ', (answer) => {
      rl.close();

      // Limpia espacios y comillas externas
      let input = (answer || '').trim();
      input = input.replace(/^>\s*/, '').replace(/^["']|["']$/g, '');

      // Si no puso nada, devuelve null
      if (!input) return resolve(null);

      // Caso 1: el usuario pegó JSON completo
      if (input.startsWith('{')) {
        try {
          const parsed = JSON.parse(input);
          if (parsed && Array.isArray(parsed.cookies)) {
            return resolve(parsed);
          }
          console.log('❌ El JSON no contiene cookies válidas.');
          return resolve(null);
        } catch {
          console.log('❌ JSON inválido.');
          return resolve(null);
        }
      }

      // Caso 2: el usuario pegó cookies separadas por ;
      if (input.includes('=')) {
        const cookies = input
          .split(';')
          .map((c) => c.trim())
          .filter(Boolean)
          .map((c) => {
            const idx = c.indexOf('=');
            if (idx === -1) return null;

            const name = c.slice(0, idx).trim();
            const value = c.slice(idx + 1).trim();

            if (!name || !value) return null;

            return {
              name,
              value,
              domain: '.instagram.com',
              path: '/',
              secure: true,
              httpOnly: name === 'sessionid',
              sameSite: 'None'
            };
          })
          .filter(Boolean);

        if (!cookies.length) {
          console.log('❌ No se pudieron interpretar las cookies.');
          return resolve(null);
        }

        return resolve({ cookies, origins: [] });
      }

      // Caso 3: asumimos que el usuario pegó solo el valor de sessionid
      return resolve({
        cookies: [
          {
            name: 'sessionid',
            value: input,
            domain: '.instagram.com',
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'None'
          }
        ],
        origins: []
      });
    });
  });
}


// ======================================================
// NORMALIZA LA URL DEL PERFIL
// Acepta:
// - usuario
// - @usuario
// - URL completa
// Y devuelve siempre una URL válida de Instagram
// ======================================================
function normalizeUrl(profileUrl) {
  if (!profileUrl) return 'https://www.instagram.com/instagram/';
  const trimmed = profileUrl.trim();

  // Si ya vino URL completa
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  }

  // Si vino solo usuario o @usuario
  return `https://www.instagram.com/${trimmed.replace(/^@/, '').replace(/^\/+|\/+$/g, '')}/`;
}


// ======================================================
// LIMPIA TEXTO
// - quita espacios repetidos
// - quita NBSP
// - hace trim
// ======================================================
function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


// ======================================================
// CONVIERTE NÚMEROS COMPACTOS A ENTEROS
// Ejemplos:
// "1,073" -> 1073
// "1.2k" -> 1200
// "2m" -> 2000000
// ======================================================
function parseCompactNumber(value) {
  if (value === null || value === undefined) return 0;

  let text = String(value)
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
    .trim();

  // Caso con sufijo k / m / b
  const compact = text.match(/([\d.,]+)\s*([kmb])/i);
  if (compact) {
    let base = compact[1].replace(/,/g, '.');
    base = parseFloat(base);
    const suffix = compact[2].toLowerCase();

    const multiplier =
      suffix === 'k' ? 1_000 :
        suffix === 'm' ? 1_000_000 :
          suffix === 'b' ? 1_000_000_000 :
            1;

    return Math.round(base * multiplier);
  }

  // Caso número normal con separadores
  const digits = text.replace(/[^\d]/g, '');
  return parseInt(digits, 10) || 0;
}


// ======================================================
// PROMEDIO SEGURO
// Evita división por cero
// ======================================================
function safeAverage(total, count) {
  return count > 0 ? total / count : 0;
}


// ======================================================
// MEDIANA DE UN ARRAY NUMÉRICO
// ======================================================
function median(numbers) {
  const values = (numbers || []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!values.length) return 0;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[mid - 1] + values[mid]) / 2
    : values[mid];
}


// ======================================================
// DEVUELVE LOS VALORES MÁS FRECUENTES
// Sirve para topLocation, bestPostingHour, etc.
// ======================================================
function topN(items, limit = 3) {
  const counts = new Map();

  for (const item of items.filter(Boolean)) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}


// ======================================================
// CUENTA EMOJIS EN UN TEXTO
// ======================================================
function countEmojis(text) {
  return (String(text || '').match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu) || []).length;
}


// ======================================================
// DETECCIÓN BÁSICA DE IDIOMA
// Si encuentra caracteres típicos de español, devuelve "es"
// Si no, "en"
// ======================================================
function detectLanguage(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return 'unknown';
  if (/[áéíóúñ¿¡]/i.test(t)) return 'es';
  return 'en';
}


// ======================================================
// SENTIMIENTO BÁSICO POR PALABRAS CLAVE
// No es NLP avanzado, solo heurístico
// ======================================================
function simpleSentiment(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return 'neutral';

  const positive = ['love', 'amo', 'feliz', 'happy', 'excellent', 'excelente', 'increíble', 'genial', '🔥', '😍', 'te amo'];
  const negative = ['bad', 'odio', 'terrible', 'horrible', 'sad', 'triste', '😡', '💔'];

  let score = 0;
  for (const word of positive) if (t.includes(word)) score++;
  for (const word of negative) if (t.includes(word)) score--;

  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
}


// ======================================================
// SUBJECTIVITY BÁSICA
// Más palabras personales = más subjetivo
// ======================================================
function simpleSubjectivity(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return 0;

  const subjectiveMarkers = ['yo', 'me', 'mi', 'my', 'i ', 'feel', 'siento', 'amo', 'odio', 'creo', 'pienso', 'eres', 'te amo'];
  let score = 0;
  for (const word of subjectiveMarkers) if (t.includes(word)) score++;
  return Math.min(1, score / 5);
}


// ======================================================
// EXTRAE PALABRAS CLAVE FRECUENTES
// Filtra stopwords comunes
// ======================================================
function extractKeywords(text, limit = 10) {
  const stopwords = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'have',
    'para', 'como', 'este', 'esta', 'pero', 'porque', 'desde', 'entre',
    'una', 'uno', 'unas', 'unos', 'que', 'con', 'por', 'del', 'las', 'los',
    'about', 'into', 'just', 'you', 'are', 'was', 'they', 'them', 'very',
    'sobre', 'hasta', 'donde', 'cuando', 'likes', 'comments', 'followers',
    'seguidores', 'siguiendo', 'publicaciones', 'november', 'october',
    'august', 'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'september', 'december', 'mika', 'gamez', 'instagram'
  ]);

  const words = String(text || '')
    .toLowerCase()
    .match(/\b[\p{L}\p{N}_]{4,}\b/gu) || [];

  const freq = new Map();
  for (const word of words) {
    if (stopwords.has(word)) continue;
    freq.set(word, (freq.get(word) || 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}


// ======================================================
// INFIERA CATEGORÍA DE CONTENIDO POR TEXTO
// ======================================================
function inferContentCategory(caption) {
  const text = String(caption || '').toLowerCase();
  if (!text) return 'unknown';
  if (/(promo|sale|oferta|discount|shop|comprar)/i.test(text)) return 'promotional';
  if (/(travel|viaje|trip|vacation|playa|beach|chimborazo|altar)/i.test(text)) return 'travel';
  if (/(food|comida|recipe|receta|restaurant)/i.test(text)) return 'food';
  if (/(fitness|gym|workout|entreno|deporte)/i.test(text)) return 'fitness';
  if (/(family|friends|cumple|birthday|party)/i.test(text)) return 'lifestyle';
  return 'general';
}


// ======================================================
// TOMA LOS PRIMEROS KEYWORDS COMO TOPICS
// ======================================================
function inferTopics(keywords) {
  return (keywords || []).slice(0, 5);
}


// ======================================================
// SANEAMIENTO DE MÉTRICAS
// - si es negativa o inválida -> 0
// - si es demasiado absurda -> null
// ======================================================
function sanitizeMetric(value, maxReasonable = 10000000) {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > maxReasonable) return null;
  return value;
}


// ======================================================
// VARIANZA ESTADÍSTICA
// ======================================================
function calcVariance(values) {
  const arr = (values || []).filter((n) => Number.isFinite(n));
  if (!arr.length) return 0;
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / arr.length;
}


// ======================================================
// MIDE QUÉ TAN COMPLETO ESTÁ EL OBJETO FINAL
// Recorre todo recursivamente y calcula proporción de campos presentes
// ======================================================
function calculateCompleteness(obj) {
  const flatValues = [];

  function walk(value) {
    if (Array.isArray(value)) {
      if (!value.length) {
        flatValues.push(null);
      } else {
        for (const item of value) walk(item);
      }
      return;
    }

    if (value && typeof value === 'object') {
      for (const v of Object.values(value)) walk(v);
      return;
    }

    flatValues.push(value);
  }

  walk(obj);

  if (!flatValues.length) return 0;

  const present = flatValues.filter((v) =>
    v !== null &&
    v !== undefined &&
    !(typeof v === 'string' && v.trim() === '')
  ).length;

  return Number((present / flatValues.length).toFixed(4));
}


// ======================================================
// CIERRA POPUPS DE COOKIES O DIALOGS DE INSTAGRAM
// ======================================================
async function dismissDialogs(page) {
  const labels = [
    'Permitir todas las cookies',
    'Allow all cookies',
    'Ahora no',
    'Not Now'
  ];

  for (const label of labels) {
    const button = page.getByRole('button', { name: label }).first();
    try {
      if (await button.isVisible({ timeout: 1500 })) {
        await button.click({ timeout: 1500 });
        await page.waitForTimeout(500);
      }
    } catch (_) { }
  }
}


// ======================================================
// HACE SCROLL EN EL PERFIL PARA CARGAR MÁS POSTS
// ======================================================
async function autoScrollProfile(page, rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    try {
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(1500);
    } catch (_) { }
  }
}


// ======================================================
// EXTRAE DATOS DEL PERFIL
// - username
// - bio
// - fullName
// - stats
// - links externos
// - verificación
// - contacto
// ======================================================
async function extractProfile(page) {
  return page.evaluate(() => {
    const textOf = (el) => el?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
    const getMeta = (name, attr = 'property') =>
      document.querySelector(`meta[${attr}="${name}"]`)?.content || '';

    const header = document.querySelector('header');
    if (!header) return null;

    const ogTitle = getMeta('og:title');
    const ogDescription = getMeta('og:description');
    const ogImage = getMeta('og:image');
    const description = getMeta('description', 'name');

    const pageText = document.body.innerText.toLowerCase();

    const privateMarkers = [
      'esta cuenta es privada',
      'this account is private'
    ];

    let username =
      textOf(header.querySelector('h2')) ||
      location.pathname.split('/').filter(Boolean)[0] ||
      '';

    let fullName = '';
    let bio = '';
    const rawStats = { posts: '', followers: '', following: '' };

    const statItems = Array.from(header.querySelectorAll('li'));
    const statTexts = statItems.map((li) => textOf(li)).filter(Boolean);

    // Busca stats visibles en el header
    for (const t of statTexts) {
      const lower = t.toLowerCase();
      if (!rawStats.posts && /(publicaci|post)/i.test(lower)) rawStats.posts = t;
      if (!rawStats.followers && /(seguidor|followers)/i.test(lower)) rawStats.followers = t;
      if (!rawStats.following && /(siguiendo|seguidos|following)/i.test(lower)) rawStats.following = t;
    }

    // Si no los encontró bien en el header, intenta con metadatos
    if (ogDescription) {
      const postsMatch =
        ogDescription.match(/([\d.,kmb]+)\s+Posts/i) ||
        ogDescription.match(/([\d.,kmb]+)\s+publicaciones/i);

      const followersMatch =
        ogDescription.match(/([\d.,kmb]+)\s+Followers/i) ||
        ogDescription.match(/([\d.,kmb]+)\s+seguidores/i);

      const followingMatch =
        ogDescription.match(/([\d.,kmb]+)\s+Following/i) ||
        ogDescription.match(/([\d.,kmb]+)\s+siguiendo/i);

      if (!rawStats.posts && postsMatch) rawStats.posts = postsMatch[1];
      if (!rawStats.followers && followersMatch) rawStats.followers = followersMatch[1];
      if (!rawStats.following && followingMatch) rawStats.following = followingMatch[1];
    }

    // Extrae bio desde meta description
    const metaBioMatch = description.match(/Instagram:\s*"([\s\S]*?)"\s*$/i);
    const metaBio = metaBioMatch ? metaBioMatch[1].trim() : '';

    bio = metaBio
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Intenta usar la primera línea de la bio como fullName
    if (metaBio) {
      const firstLine = metaBio.split('\n')[0]?.trim() || '';
      if (firstLine && firstLine.length <= 80) {
        fullName = firstLine;
      }
    }

    // Si no sale, toma el inicio de la bio
    if (!fullName && bio) {
      const bioStart = bio.split(/[📍#@]/)[0]?.trim() || '';
      if (bioStart && bioStart.length <= 80) {
        fullName = bioStart;
      }
    }

    if (/^icono de enlace$/i.test(bio)) bio = '';

    const allLinks = Array.from(header.querySelectorAll('a[href]')).map((a) => ({
      href: a.href || '',
      text: textOf(a)
    }));

    const threadsLink =
      allLinks.find((a) => /threads\.net|threads\.com/i.test(a.href))?.href || '';

    const externalLink =
      allLinks.find((a) =>
        a.href &&
        !/instagram\.com/i.test(a.href) &&
        !/threads\.net|threads\.com/i.test(a.href) &&
        !/facebook\.com/i.test(a.href)
      )?.href || '';

    const guessedEmail =
      bio.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)?.[0] || '';

    const guessedPhone =
      bio.match(/(\+?\d[\d\s-]{7,}\d)/)?.[0] || '';

    const businessButtons = Array.from(header.querySelectorAll('button, a'))
      .map((el) => textOf(el).toLowerCase());

    const hasContact = businessButtons.some((t) => /contact|contacto|llamar|call|email|correo/.test(t));

    return {
      profileId: '',
      username,
      fullName,
      bio,
      businessCategory: '',
      profilePic: header.querySelector('img')?.src || ogImage || '',
      isVerified: !!header.querySelector(
        'svg[aria-label*="Verified"], svg[title*="Verified"], svg[aria-label*="verificada"], svg[title*="verificada"]'
      ),
      hasContact,
      rawStats,
      isPrivate: privateMarkers.some((marker) => pageText.includes(marker)),
      externalLink,
      threadsLink,
      guessedEmail,
      guessedPhone,
      publicEmail: guessedEmail || null,
      publicPhone: guessedPhone || null,
      businessAddress: '',
      accountType: 'personal',
      isBusinessAccount: hasContact,
      isCreatorAccount: false,
      isProfessionalAccount: hasContact,
      meta: {
        ogTitle,
        ogDescription,
        description,
        ogImage
      }
    };
  });
}


// ======================================================
// RECOLECTA LINKS DE POSTS DEL PERFIL
// - posts /p/
// - reels /reel/
// filtra contenido ajeno
// ======================================================
async function collectPostLinks(page, profileUsername, limit = 24) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  await autoScrollProfile(page, 4);

  return page.evaluate(({ maxItems, profileUsername }) => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
    const unique = new Map();

    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href) continue;

      const absoluteUrl = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
      if (unique.has(absoluteUrl)) continue;

      const pathMatch = absoluteUrl.match(/^https?:\/\/www\.instagram\.com\/([^/]+)\//i);
      const urlOwner = pathMatch?.[1]?.toLowerCase() || '';

      if (urlOwner && !['explore', 'reel', 'p'].includes(urlOwner) && urlOwner !== profileUsername.toLowerCase()) {
        continue;
      }

      const card = a.closest('article, div');
      const html = card?.innerHTML || '';
      const shortcodeMatch = absoluteUrl.match(/\/(?:p|reel)\/([^/?#]+)/i);

      unique.set(absoluteUrl, {
        url: absoluteUrl,
        canonicalUrl: absoluteUrl,
        ownerUsername: profileUsername,
        isOwnPost: true,
        isPinned: /fijad|pinned/i.test(html),
        type: href.includes('/reel/')
          ? 'Video'
          : (/carrusel|carousel/i.test(html) ? 'Carousel' : 'Image'),
        shortcode: shortcodeMatch?.[1] || ''
      });

      if (unique.size >= maxItems * 3) break;
    }

    return [...unique.values()].slice(0, maxItems);
  }, { maxItems: limit, profileUsername });
}


// ======================================================
// EXTRAE TODA LA INFO DE UN POST
// - caption
// - likes
// - comments
// - fecha
// - location
// - imágenes / videos
// - métricas derivadas
// - NLP básico
// ======================================================
async function scrapePost(context, item, profileUsername, profileFollowers) {
  const postPage = await context.newPage();

  try {
    await postPage.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissDialogs(postPage);
    await postPage.waitForSelector('article, main', { timeout: 15000 });
    await postPage.waitForTimeout(1500);

    try {
      await postPage.mouse.wheel(0, 1500);
      await postPage.waitForTimeout(700);
    } catch (_) { }

    const data = await postPage.evaluate((info) => {
      const textOf = (el) => el?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
      const getMeta = (name, attr = 'property') =>
        document.querySelector(`meta[${attr}="${name}"]`)?.content || '';

      const metaDescription =
        getMeta('og:description') ||
        getMeta('description', 'name') ||
        '';

      const metaTitle = getMeta('og:title');
      const metaImage = getMeta('og:image');
      const metaType = getMeta('og:type');

      const canonicalUrl =
        document.querySelector('link[rel="canonical"]')?.href ||
        info.url;

      const timeEl = document.querySelector('time');
      const date = timeEl?.getAttribute('datetime') || '';

      const location =
        textOf(document.querySelector('a[href*="/explore/locations/"]')) || '';

      const ownerCandidates = Array.from(document.querySelectorAll('header a, article header a'))
        .map((a) => {
          const href = a.getAttribute('href') || '';
          const label = textOf(a);
          return { href, label };
        })
        .filter((a) => /^\/[^/]+\/?$/.test(a.href) && a.label);

      const ownerUsername =
        ownerCandidates[0]?.label ||
        info.ownerUsername ||
        info.profileUsername ||
        '';

      // Intenta sacar caption desde varios lugares
      const captionCandidates = [
        textOf(document.querySelector('article h1')),
        textOf(document.querySelector('article ul li h1')),
        ...Array.from(document.querySelectorAll('article ul li'))
          .map((li) => textOf(li))
          .filter(Boolean),
        ...Array.from(document.querySelectorAll('article div[dir="auto"], article span'))
          .map((el) => textOf(el))
          .filter(Boolean)
      ];

      let caption = '';
      for (const t of captionCandidates) {
        if (!t) continue;
        if (/(likes|me gusta|comments|comentarios|view all|ver los|seguir|siguiendo|follow|message|mensaje)/i.test(t)) continue;
        if (t.length < 3) continue;
        caption = t;
        break;
      }

      // Si no lo encontró visible, usa el meta description
      if (!caption && metaDescription) {
        caption = metaDescription;
      }

      // Toma mucho texto visible para buscar likes/comments/views
      const visibleTexts = Array.from(document.querySelectorAll('section, span, div, a, button'))
        .map((el) => textOf(el))
        .filter(Boolean)
        .slice(0, 1500);

      let likesRaw = '';
      let commentsRaw = '';
      let viewsRaw = '';

      const likeFromMeta = metaDescription.match(/(?:^|[^\d])([\d.,]+(?:\s*[kmb])?)\s*(likes|me gusta)\b/i);
      if (likeFromMeta) likesRaw = likeFromMeta[1];

      const commentFromMeta = metaDescription.match(/(?:^|[^\d])([\d.,]+(?:\s*[kmb])?)\s*(comments|comentarios)\b/i);
      if (commentFromMeta) commentsRaw = commentFromMeta[1];

      const likeLine = visibleTexts.find((t) =>
        /\b([\d.,]+(?:\s*[kmb])?)\s*(likes|me gusta)\b/i.test(t)
      );
      if (!likesRaw && likeLine) {
        const m = likeLine.match(/([\d.,]+(?:\s*[kmb])?)/i);
        if (m) likesRaw = m[1];
      }

      const commentLine = visibleTexts.find((t) =>
        /\b(view all|ver los?|ver todas?)\b.*\b(comments|comentarios)\b/i.test(t) ||
        /\b([\d.,]+(?:\s*[kmb])?)\s*(comments|comentarios)\b/i.test(t)
      );
      if (!commentsRaw && commentLine) {
        const m = commentLine.match(/([\d.,]+(?:\s*[kmb])?)/i);
        if (m) commentsRaw = m[1];
      }

      const viewsLine = visibleTexts.find((t) =>
        /\b([\d.,]+(?:\s*[kmb])?)\s*(views|visualizaciones|reproducciones)\b/i.test(t)
      );
      if (viewsLine) {
        const m = viewsLine.match(/([\d.,]+(?:\s*[kmb])?)/i);
        if (m) viewsRaw = m[1];
      }

      const images = Array.from(document.querySelectorAll('img'));
      const videos = Array.from(document.querySelectorAll('video'));

      const imageUrls = images
        .map((img) => img.src)
        .filter(Boolean);

      const videoUrls = videos
        .map((video) => video.src || video.currentSrc)
        .filter(Boolean);

      const firstImage = images[0];
      const firstVideo = videos[0];

      const width =
        firstVideo?.videoWidth ||
        firstImage?.naturalWidth ||
        null;

      const height =
        firstVideo?.videoHeight ||
        firstImage?.naturalHeight ||
        null;

      const hashtags = (caption || metaDescription || '').match(/#\w+/g) || [];
      const mentions = (caption || metaDescription || '').match(/@\w+/g) || [];

      return {
        ...info,
        canonicalUrl,
        ownerUsername,
        isOwnPost: ownerUsername.toLowerCase() === String(info.profileUsername || '').toLowerCase(),
        date,
        location,
        caption,
        hashtags,
        mentions,
        likesRaw,
        commentsRaw,
        viewsRaw,
        meta: {
          title: metaTitle,
          description: metaDescription,
          image: metaImage,
          type: metaType
        },
        media: {
          imageUrls: [...new Set(imageUrls)].slice(0, 10),
          videoUrls: [...new Set(videoUrls)].slice(0, 5),
          imageCount: [...new Set(imageUrls)].length,
          videoCount: [...new Set(videoUrls)].length,
          thumbnailUrl: metaImage || imageUrls[0] || null,
          duration: firstVideo?.duration || null,
          resolution: width && height ? { width, height } : null
        },
        pageSignals: {
          hasVideoElement: !!firstVideo,
          hasLocation: !!document.querySelector('a[href*="/explore/locations/"]'),
          hasTimeElement: !!timeEl
        }
      };
    }, { ...item, profileUsername });

    // Convierte likes/comments/views a números
    let likes = parseCompactNumber(data.likesRaw);
    let comments = parseCompactNumber(data.commentsRaw);
    let views = parseCompactNumber(data.viewsRaw);

    // Filtra lecturas absurdas
    if (profileFollowers > 0 && likes > Math.max(profileFollowers * 20, 50000)) {
      likes = null;
    }
    if (profileFollowers > 0 && comments > Math.max(profileFollowers * 5, 10000)) {
      comments = null;
    }
    if (data.likesRaw && /\b1\s*m\b/i.test(String(data.likesRaw))) {
      likes = null;
    }

    likes = sanitizeMetric(likes, 100000000);
    comments = sanitizeMetric(comments, 1000000);
    views = sanitizeMetric(views, 1000000000);

    const type =
      data.type ||
      (data.canonicalUrl.includes('/reel/') ? 'Video' : 'Image');

    const captionOriginal = cleanText(data.caption || '');
    let finalCaption = captionOriginal;

    // Intenta sacar solo el texto entre comillas
    const quotedCaption =
      finalCaption.match(/:\s*"([\s\S]*?)"\.?$/) ||
      finalCaption.match(/:\s*“([\s\S]*?)”\.?$/) ||
      finalCaption.match(/:\s*'([\s\S]*?)'\.?$/);

    if (quotedCaption && quotedCaption[1]) {
      finalCaption = cleanText(quotedCaption[1]);
    }

    // Limpieza de prefijos, fechas y comillas sobrantes
    finalCaption = finalCaption
      .replace(/^\d[\d.,kmb]*\s+(likes|me gusta)\s*,?\s*\d[\d.,kmb]*\s+(comments|comentarios)\s*-\s*/i, '')
      .replace(/^[^:"]+\bel\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}:\s*/i, '')
      .replace(/^"+/, '')
      .replace(/"+\.?$/, '')
      .replace(/""/g, '"')
      .trim();

    if (finalCaption.startsWith('"') && finalCaption.endsWith('"')) {
      finalCaption = finalCaption.slice(1, -1).trim();
    }

    finalCaption = finalCaption.replace(/"\s*([^\"]*)$/, '$1').trim();

    const captionWordCount = finalCaption ? finalCaption.split(/\s+/).length : 0;

    // Marca si realmente se encontró el dato o si quedó null
    const likesFound = likes !== null && likes !== undefined;
    const commentsFound = comments !== null && comments !== undefined;
    const viewsFound = views !== null && views !== undefined;

    const safeLikes = likesFound ? likes : 0;
    const safeComments = commentsFound ? comments : 0;
    const safeViews = viewsFound ? views : 0;

    // Métricas de engagement
    const engagementRatePost = profileFollowers > 0
      ? Number((((safeLikes + safeComments) / profileFollowers) * 100).toFixed(4))
      : 0;

    const likesToFollowersRatio = profileFollowers > 0
      ? Number(((safeLikes / profileFollowers) * 100).toFixed(4))
      : 0;

    const commentsToLikesRatio = safeLikes > 0
      ? Number((safeComments / safeLikes).toFixed(4))
      : 0;

    const mediaAspectRatio =
      data.media?.resolution?.width && data.media?.resolution?.height
        ? Number((data.media.resolution.width / data.media.resolution.height).toFixed(4))
        : null;

    // NLP y categorización
    const contentCategory = inferContentCategory(finalCaption);
    const keywords = extractKeywords(finalCaption, 10);
    const topics = inferTopics(keywords);
    const hashtagDensity = captionWordCount > 0
      ? Number(((data.hashtags?.length || 0) / captionWordCount).toFixed(4))
      : 0;

    return {
      ...data,
      type,
      captionRaw: data.caption || '',
      captionClean: finalCaption,
      captionLength: finalCaption.length,
      captionWordCount,
      captionLanguage: detectLanguage(finalCaption),
      emojiCount: countEmojis(finalCaption),
      hashtagsCount: data.hashtags?.length || 0,
      mentionsCount: data.mentions?.length || 0,
      hasHashtags: (data.hashtags?.length || 0) > 0,
      hasMentions: (data.mentions?.length || 0) > 0,
      hasLocation: !!cleanText(data.location || '') && !/^ubicaciones$/i.test(cleanText(data.location || '')),
      contentCategory,
      isReel: type === 'Video' || /\/reel\//i.test(data.canonicalUrl),
      isCarousel: type === 'Carousel' || (data.media?.imageCount || 0) > 1,
      carouselSize: Math.max(data.media?.imageCount || 0, data.media?.videoCount || 0, 0),
      mediaAspectRatio,
      likes: safeLikes,
      comments: safeComments,
      views: safeViews,
      likesSanitized: likesFound,
      commentsSanitized: commentsFound,
      viewsSanitized: viewsFound,
      engagementRatePost,
      likesToFollowersRatio,
      commentsToLikesRatio,
      engagementScore: Number((((safeLikes * 1) + (safeComments * 2) + (safeViews * 0.05))).toFixed(2)),
      dayOfWeek: data.date ? new Date(data.date).getDay() : null,
      hourOfDay: data.date ? new Date(data.date).getHours() : null,
      isWeekend: data.date ? [0, 6].includes(new Date(data.date).getDay()) : false,
      country: '',
      city: /^ubicaciones$/i.test(cleanText(data.location || '')) ? '' : cleanText(data.location || ''),
      geoCoordinates: null,
      locationFrequency: 0,
      topLocation: '',
      sentiment: simpleSentiment(finalCaption),
      subjectivity: simpleSubjectivity(finalCaption),
      keywords,
      topics,
      hashtagDensity,
      hashtagPerformance: null,
      taggedUsers: [],
      mentionedUsers: data.mentions || [],
      topCommenters: [],
      interactionCount: safeLikes + safeComments,
      collaborationPosts: false,
      imageCount: data.media?.imageCount || 0,
      videoCount: data.media?.videoCount || 0,
      thumbnailUrl: data.media?.thumbnailUrl || null,
      mediaSize: null,
      duration: data.media?.duration || null,
      resolution: data.media?.resolution || null,
      resolutionText: data.media?.resolution
        ? `${data.media.resolution.width}x${data.media.resolution.height}`
        : null
    };
  } finally {
    await postPage.close();
  }
}


// ======================================================
// FUNCIÓN PRINCIPAL
// - abre navegador
// - carga perfil
// - extrae perfil
// - recolecta posts
// - scrapea posts
// - calcula analytics
// - guarda resultado.json
// ======================================================
async function expertScrape(profileUrlInput) {
  const startedAt = Date.now();
  const profileUrl = normalizeUrl(profileUrlInput);
  const authState = await askCookies();

  if (!authState) {
    console.error('❌ No se proporcionaron cookies válidas.');
    process.exitCode = 1;
    return;
  }

  let requestCount = 0;
  let errorCount = 0;
  let retryCount = 0;

  console.log('🧐 Iniciando análisis...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: authState,
    locale: 'es-ES'
  });

  // Cuenta requests del navegador
  context.on('request', () => {
    requestCount++;
  });

  const page = await context.newPage();

  try {
    console.log(`📂 Analizando perfil: ${profileUrl}`);
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissDialogs(page);
    await page.waitForSelector('header', { timeout: 30000 });
    await page.waitForTimeout(2500);

    const rawProfile = await extractProfile(page);
    if (!rawProfile) throw new Error('No se pudo extraer el encabezado del perfil.');

    const stats = {
      posts: parseCompactNumber(rawProfile.rawStats.posts),
      followers: parseCompactNumber(rawProfile.rawStats.followers),
      following: parseCompactNumber(rawProfile.rawStats.following)
    };

    const cleanedFullName = cleanText(rawProfile.fullName);
    const cleanedBio = cleanText(rawProfile.bio);

    // Construye el objeto perfil final
    const profile = {
      profileId: rawProfile.profileId || '',
      username: cleanText(rawProfile.username),
      fullName:
        cleanedFullName === cleanedBio ||
          cleanedFullName.toLowerCase() === 'instagram de' ||
          /^\d+$/.test(cleanedFullName)
          ? ''
          : cleanedFullName,
      bio:
        /^\d+$/.test(cleanedBio)
          ? ''
          : cleanedBio,
      accountType: rawProfile.accountType || 'personal',
      isBusinessAccount: !!rawProfile.isBusinessAccount,
      isCreatorAccount: !!rawProfile.isCreatorAccount,
      isProfessionalAccount: !!rawProfile.isProfessionalAccount,
      businessCategory: rawProfile.businessCategory || '',
      publicEmail: rawProfile.publicEmail || null,
      publicPhone: rawProfile.publicPhone || null,
      businessAddress: rawProfile.businessAddress || '',
      category: rawProfile.businessCategory || '',
      profilePic: rawProfile.profilePic,
      isVerified: rawProfile.isVerified,
      hasContact: rawProfile.hasContact,
      stats: {
        ...stats,
        ratio: stats.following > 0
          ? Number((stats.followers / stats.following).toFixed(2))
          : stats.followers > 0 ? stats.followers : 0
      },
      isPrivate: rawProfile.isPrivate,
      externalLink: rawProfile.externalLink,
      threadsLink: rawProfile.threadsLink,
      guessedEmail: rawProfile.guessedEmail,
      guessedPhone: rawProfile.guessedPhone,
      meta: rawProfile.meta
    };

    // Si la cuenta es privada, guarda solo el perfil y termina
    if (profile.isPrivate) {
      console.log('🔒 Cuenta privada. Guardando solo datos básicos.');
      const partial = {
        profile,
        posts: [],
        analytics: null,
        scrapeConfidence: 0.3,
        missingFields: ['posts', 'engagement', 'captions', 'likes', 'comments'],
        dataCompleteness: calculateCompleteness(profile),
        scrapedAt: new Date().toISOString(),
        scrapeDuration: Date.now() - startedAt,
        requestCount,
        errorCount,
        retryCount,
        sourceType: 'playwright'
      };

      fs.writeFileSync('resultado.json', JSON.stringify(partial, null, 2));
      return;
    }

    console.log('📸 Extrayendo publicaciones...');
    const postLinks = await collectPostLinks(page, profile.username, 24);

    const detailedPostsRaw = [];
    for (const item of postLinks) {
      console.log(`   🔗 ${item.url}`);
      try {
        const post = await scrapePost(context, item, profile.username, profile.stats.followers);
        detailedPostsRaw.push(post);
      } catch (error) {
        errorCount++;
        console.log(`      ⚠️ Error en post: ${error.message}`);
      }
    }

    // Filtra seguridad adicional por owner / tipo de URL
    const detailedPosts = detailedPostsRaw
      .filter((post) => {
        const owner = (post.ownerUsername || '').toLowerCase();
        const profileUser = (profile.username || '').toLowerCase();
        const url = String(post.url || '').toLowerCase();

        if (owner && owner !== profileUser) return false;
        if (url.includes('instagram.com/') && !url.includes('/p/') && !url.includes('/reel/')) return false;

        return true;
      })
      .slice(0, 24);

    const validLikesPosts = detailedPosts.filter((p) => p.likesSanitized && (p.likes || 0) > 0);
    const validCommentsPosts = detailedPosts.filter((p) => p.commentsSanitized && (p.comments || 0) >= 0);
    const validViewsPosts = detailedPosts.filter((p) => p.viewsSanitized && (p.views || 0) > 0);

    const totalLikes = validLikesPosts.reduce((sum, post) => sum + (post.likes || 0), 0);
    const totalComments = validCommentsPosts.reduce((sum, post) => sum + (post.comments || 0), 0);

    const followers = profile.stats.followers;
    const analyzedCount = detailedPosts.length;

    const averageLikes = safeAverage(totalLikes, validLikesPosts.length);
    const averageComments = safeAverage(totalComments, validCommentsPosts.length);
    const medianLikes = median(validLikesPosts.map((p) => p.likes || 0));
    const medianComments = median(validCommentsPosts.map((p) => p.comments || 0));

    const engagementRateProfile =
      followers > 0 && analyzedCount > 0
        ? Number((((averageLikes + averageComments) / followers) * 100).toFixed(4))
        : 0;

    const validDates = detailedPosts
      .map((post) => new Date(post.date))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => b - a);

    let publicationFrequency = 'No determinada';
    if (validDates.length > 1) {
      const days = Math.max((validDates[0] - validDates[validDates.length - 1]) / (1000 * 60 * 60 * 24), 1);
      publicationFrequency = `${(analyzedCount / (days / 30)).toFixed(1)} posts/mes`;
    }

    const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const postingDays = validDates.map((d) => dayNames[d.getDay()]);
    const postingHours = validDates.map((d) => `${String(d.getHours()).padStart(2, '0')}:00`);

    const locations = detailedPosts
      .map((p) => p.location)
      .filter((loc) => loc && !/^ubicaciones$/i.test(loc));

    const topLocations = topN(locations, 10);

    const visibleActivityRange =
      validDates.length > 0
        ? {
          firstPost: validDates[validDates.length - 1].toISOString(),
          lastPost: validDates[0].toISOString()
        }
        : null;

    const postIntervalsDays = [];
    for (let i = 0; i < validDates.length - 1; i++) {
      const diff = (validDates[i] - validDates[i + 1]) / (1000 * 60 * 60 * 24);
      postIntervalsDays.push(Number(diff.toFixed(2)));
    }

    const avgPostingInterval = safeAverage(
      postIntervalsDays.reduce((a, b) => a + b, 0),
      postIntervalsDays.length
    );

    const intervalVariance = calcVariance(postIntervalsDays);
    const postingConsistencyScore =
      postIntervalsDays.length > 1
        ? Number((1 / (1 + intervalVariance)).toFixed(4))
        : 0;

    const engagementValues = detailedPosts.map((p) => (p.likes || 0) + (p.comments || 0));
    const engagementVariance = Number(calcVariance(engagementValues).toFixed(4));

    let engagementTrend = 'stable';
    if (engagementValues.length >= 4) {
      const half = Math.floor(engagementValues.length / 2);
      const firstHalf = safeAverage(
        engagementValues.slice(half).reduce((a, b) => a + b, 0),
        engagementValues.slice(half).length
      );
      const secondHalf = safeAverage(
        engagementValues.slice(0, half).reduce((a, b) => a + b, 0),
        engagementValues.slice(0, half).length
      );

      if (secondHalf > firstHalf * 1.1) engagementTrend = 'up';
      else if (secondHalf < firstHalf * 0.9) engagementTrend = 'down';
    }

    const contentTypeGroups = {};
    for (const post of detailedPosts) {
      const key = post.type || 'Unknown';
      if (!contentTypeGroups[key]) contentTypeGroups[key] = [];
      contentTypeGroups[key].push(post);
    }

    let bestContentType = null;
    let worstContentType = null;
    if (Object.keys(contentTypeGroups).length) {
      const contentTypeScores = Object.entries(contentTypeGroups).map(([type, items]) => ({
        type,
        avgEngagement: safeAverage(
          items.reduce((sum, p) => sum + ((p.likes || 0) + (p.comments || 0)), 0),
          items.length
        )
      })).sort((a, b) => b.avgEngagement - a.avgEngagement);

      bestContentType = contentTypeScores[0]?.type || null;
      worstContentType = contentTypeScores[contentTypeScores.length - 1]?.type || null;
    }

    const bestPostingHour = topN(postingHours, 1)[0]?.value || null;
    const bestPostingDay = topN(postingDays, 1)[0]?.value || null;

    const topPerformingPost = [...detailedPosts]
      .sort((a, b) => ((b.likes || 0) + (b.comments || 0)) - ((a.likes || 0) + (a.comments || 0)))[0] || null;

    const now = new Date();
    const lastPostDate = validDates[0] || null;
    const daysSinceLastPost = lastPostDate
      ? Math.floor((now - lastPostDate) / (1000 * 60 * 60 * 24))
      : null;

    // Inserta frecuencia de location por post
    for (const post of detailedPosts) {
      post.locationFrequency = post.location
        ? locations.filter((loc) => loc === post.location).length
        : 0;
      post.topLocation = topLocations[0]?.value || '';
    }

    // Construye analytics generales
    const analytics = {
      totalAnalyzed: analyzedCount,
      engagementRateProfile,
      avgLikes: Number(averageLikes.toFixed(2)),
      avgComments: Number(averageComments.toFixed(2)),
      medianLikes,
      medianComments,
      avgViews: Number(safeAverage(
        validViewsPosts.reduce((sum, p) => sum + (p.views || 0), 0),
        validViewsPosts.length
      ).toFixed(2)),
      publicationFrequency,
      dayOfWeekMode: bestPostingDay,
      hourOfDayMode: bestPostingHour,
      bestPostingHour,
      bestPostingDay,
      bestContentType,
      worstContentType,
      topPerformingPostId: topPerformingPost?.shortcode || null,
      viralScore: topPerformingPost
        ? Number((((topPerformingPost.likes || 0) + (topPerformingPost.comments || 0)) / Math.max(followers, 1) * 100).toFixed(4))
        : 0,
      engagementTrend,
      engagementVariance,
      postingConsistencyScore,
      avgPostingIntervalDays: Number(avgPostingInterval.toFixed(2)),
      inactiveDays: daysSinceLastPost,
      locationFrequency: topLocations,
      topLocation: topLocations[0]?.value || '',
      followersGrowth: null,
      followersGrowthRate: null,
      postsGrowth: null,
      engagementGrowth: null
    };

    profile.lastPostDate = lastPostDate ? lastPostDate.toISOString() : null;
    profile.daysSinceLastPost = daysSinceLastPost;
    profile.profileCreationEstimate = visibleActivityRange?.firstPost || null;

    const missingFields = [];
    if (!profile.bio) missingFields.push('profile.bio');
    if (!profile.publicEmail) missingFields.push('profile.publicEmail');
    if (!profile.publicPhone) missingFields.push('profile.publicPhone');
    if (!detailedPosts.some((p) => p.captionClean)) missingFields.push('posts.caption');
    if (!detailedPosts.some((p) => (p.likes || 0) > 0)) missingFields.push('posts.likes');
    if (!detailedPosts.some((p) => (p.comments || 0) > 0)) missingFields.push('posts.comments');
    if (!detailedPosts.some((p) => p.location && !/^ubicaciones$/i.test(p.location))) missingFields.push('posts.location');

    const finalReport = {
      profile,
      posts: detailedPosts,
      analytics,
      scrapeConfidence: Number((1 - (missingFields.length / 12)).toFixed(4)),
      missingFields,
      dataCompleteness: calculateCompleteness({
        profile,
        posts: detailedPosts,
        analytics
      }),
      outlierScore: engagementVariance,
      scrapedAt: new Date().toISOString(),
      scrapeDuration: Date.now() - startedAt,
      requestCount,
      errorCount,
      retryCount,
      sourceType: 'playwright'
    };

    // Guarda el resultado final
    fs.writeFileSync('resultado.json', JSON.stringify(finalReport, null, 2));
    console.log('✅ Informe generado en resultado.json');
  } catch (error) {
    errorCount++;
    console.error('❌ Error crítico:', error.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}


// ======================================================
// PUNTO DE ENTRADA
// Si no se pasa argumento, usa instagram como ejemplo
// ======================================================
const target = process.argv[2] || 'https://www.instagram.com/instagram/';
expertScrape(target);