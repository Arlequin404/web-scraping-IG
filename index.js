// ======================================================
// SCRAPER SIMPLE DE INSTAGRAM CON PLAYWRIGHT
// ------------------------------------------------------
// Esta versión:
// 1. Pide cookies
// 2. Entra a un perfil
// 3. Extrae datos básicos del perfil
// 4. Recolecta publicaciones
// 5. Extrae datos simples de cada post
// 6. Guarda dos archivos:
//    - resultado_raw.json
//    - resultado_limpio.json
// ======================================================

const { chromium } = require('playwright');
const fs = require('fs');
const readline = require('readline');


// ======================================================
// PIDE COOKIES POR CONSOLA
// Acepta:
// - JSON completo
// - cadena de cookies
// - solo sessionid
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

      let input = String(answer || '').trim();
      input = input.replace(/^>\s*/, '').replace(/^["']|["']$/g, '');

      if (!input) return resolve(null);

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
// ======================================================
function normalizeUrl(profileUrl) {
  if (!profileUrl) return 'https://www.instagram.com/instagram/';
  const trimmed = String(profileUrl).trim();

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  }

  return `https://www.instagram.com/${trimmed.replace(/^@/, '').replace(/^\/+|\/+$/g, '')}/`;
}


// ======================================================
// LIMPIA TEXTO
// ======================================================
function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


// ======================================================
// CONVIERTE NÚMEROS COMO:
// 1,073 -> 1073
// 1.2k  -> 1200
// 2m    -> 2000000
// ======================================================
function parseCompactNumber(value) {
  if (value === null || value === undefined) return 0;

  const text = String(value).toLowerCase().trim();

  const compact = text.match(/([\d.,]+)\s*([kmb])/i);
  if (compact) {
    const raw = compact[1].replace(/,/g, '.');
    const base = parseFloat(raw);
    const suffix = compact[2].toLowerCase();

    const multiplier =
      suffix === 'k' ? 1_000 :
        suffix === 'm' ? 1_000_000 :
          suffix === 'b' ? 1_000_000_000 :
            1;

    return Math.round(base * multiplier);
  }

  const digits = text.replace(/[^\d]/g, '');
  return parseInt(digits, 10) || 0;
}


// ======================================================
// DEVUELVE SOLO YYYY-MM-DD
// ======================================================
function formatDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}


// ======================================================
// CIERRA POPUPS COMUNES
// ======================================================
async function dismissDialogs(page) {
  const labels = [
    'Permitir todas las cookies',
    'Allow all cookies',
    'Ahora no',
    'Not Now'
  ];

  for (const label of labels) {
    try {
      const button = page.getByRole('button', { name: label }).first();
      if (await button.isVisible({ timeout: 1200 })) {
        await button.click({ timeout: 1200 });
        await page.waitForTimeout(400);
      }
    } catch (_) { }
  }
}


// ======================================================
// HACE SCROLL PARA CARGAR MÁS POSTS
// ======================================================
async function autoScrollProfile(page, rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    try {
      await page.mouse.wheel(0, 3500);
      await page.waitForTimeout(1200);
    } catch (_) { }
  }
}


// ======================================================
// EXTRAE DATOS BÁSICOS DEL PERFIL
// ======================================================
async function extractProfile(page) {
  return page.evaluate(() => {
    const textOf = (el) => el?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
    const getMeta = (name, attr = 'property') =>
      document.querySelector(`meta[${attr}="${name}"]`)?.content || '';

    const header = document.querySelector('header');
    if (!header) return null;

    const ogDescription = getMeta('og:description');
    const description = getMeta('description', 'name');
    const ogImage = getMeta('og:image');
    const pageText = document.body.innerText.toLowerCase();

    const privateMarkers = [
      'esta cuenta es privada',
      'this account is private'
    ];

    const username =
      textOf(header.querySelector('h2')) ||
      location.pathname.split('/').filter(Boolean)[0] ||
      '';

    const rawStats = { posts: '', followers: '', following: '' };

    const statItems = Array.from(header.querySelectorAll('li'));
    const statTexts = statItems.map((li) => textOf(li)).filter(Boolean);

    for (const t of statTexts) {
      const lower = t.toLowerCase();
      if (!rawStats.posts && /(publicaci|post)/i.test(lower)) rawStats.posts = t;
      if (!rawStats.followers && /(seguidor|followers)/i.test(lower)) rawStats.followers = t;
      if (!rawStats.following && /(siguiendo|seguidos|following)/i.test(lower)) rawStats.following = t;
    }

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

    const metaBioMatch = description.match(/Instagram:\s*"([\s\S]*?)"\s*$/i);
    const bio = metaBioMatch ? metaBioMatch[1].trim().replace(/\s+/g, ' ') : '';

    const allLinks = Array.from(header.querySelectorAll('a[href]')).map((a) => ({
      href: a.href || '',
      text: textOf(a)
    }));

    const externalLink =
      allLinks.find((a) =>
        a.href &&
        !/instagram\.com/i.test(a.href) &&
        !/threads\.net|threads\.com/i.test(a.href) &&
        !/facebook\.com/i.test(a.href)
      )?.href || '';

    return {
      username,
      bio,
      profilePic: header.querySelector('img')?.src || ogImage || '',
      rawStats,
      isPrivate: privateMarkers.some((marker) => pageText.includes(marker)),
      externalLink
    };
  });
}


// ======================================================
// RECOLECTA LINKS DE POSTS Y REELS
// ======================================================
async function collectPostLinks(page, profileUsername, limit = 12) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1800);
  await autoScrollProfile(page, 3);

  return page.evaluate(({ maxItems, profileUsername }) => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
    const unique = new Map();

    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href) continue;

      const absoluteUrl = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
      if (unique.has(absoluteUrl)) continue;

      const shortcodeMatch = absoluteUrl.match(/\/(?:p|reel)\/([^/?#]+)/i);

      unique.set(absoluteUrl, {
        url: absoluteUrl,
        ownerUsername: profileUsername,
        shortcode: shortcodeMatch?.[1] || '',
        type: href.includes('/reel/') ? 'Video' : 'Image'
      });

      if (unique.size >= maxItems) break;
    }

    return [...unique.values()];
  }, { maxItems: limit, profileUsername });
}


// ======================================================
// EXTRAE DATOS SIMPLES DE CADA POST
// ======================================================
async function scrapePost(context, item, profileFollowers) {
  const postPage = await context.newPage();

  try {
    await postPage.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissDialogs(postPage);
    await postPage.waitForSelector('article, main', { timeout: 15000 });
    await postPage.waitForTimeout(1200);

    const data = await postPage.evaluate((info) => {
      const textOf = (el) => el?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
      const getMeta = (name, attr = 'property') =>
        document.querySelector(`meta[${attr}="${name}"]`)?.content || '';

      const metaDescription =
        getMeta('og:description') ||
        getMeta('description', 'name') ||
        '';

      const canonicalUrl =
        document.querySelector('link[rel="canonical"]')?.href ||
        info.url;

      const timeEl = document.querySelector('time');
      const date = timeEl?.getAttribute('datetime') || '';

      const location =
        textOf(document.querySelector('a[href*="/explore/locations/"]')) || '';

      const visibleTexts = Array.from(document.querySelectorAll('section, span, div, a, button'))
        .map((el) => textOf(el))
        .filter(Boolean)
        .slice(0, 1000);

      let likesRaw = '';
      let commentsRaw = '';
      let viewsRaw = '';

      const likeFromMeta = metaDescription.match(/(?:^|[^\d])([\d.,]+(?:\s*[kmb])?)\s*(likes|me gusta)\b/i);
      if (likeFromMeta) likesRaw = likeFromMeta[1];

      const commentFromMeta = metaDescription.match(/(?:^|[^\d])([\d.,]+(?:\s*[kmb])?)\s*(comments|comentarios)\b/i);
      if (commentFromMeta) commentsRaw = commentFromMeta[1];

      const viewsLine = visibleTexts.find((t) =>
        /\b([\d.,]+(?:\s*[kmb])?)\s*(views|visualizaciones|reproducciones)\b/i.test(t)
      );
      if (viewsLine) {
        const m = viewsLine.match(/([\d.,]+(?:\s*[kmb])?)/i);
        if (m) viewsRaw = m[1];
      }

      const images = Array.from(document.querySelectorAll('img'));
      const videos = Array.from(document.querySelectorAll('video'));

      let caption = metaDescription || '';

      return {
        ...info,
        canonicalUrl,
        date,
        location,
        caption,
        likesRaw,
        commentsRaw,
        viewsRaw,
        imageCount: images.length,
        videoCount: videos.length
      };
    }, item);

    let likes = parseCompactNumber(data.likesRaw);
    let comments = parseCompactNumber(data.commentsRaw);
    let views = parseCompactNumber(data.viewsRaw);

    if (profileFollowers > 0 && likes > Math.max(profileFollowers * 20, 50000)) likes = 0;
    if (profileFollowers > 0 && comments > Math.max(profileFollowers * 5, 10000)) comments = 0;

    let caption = cleanText(data.caption || '');

    const quotedCaption =
      caption.match(/:\s*"([\s\S]*?)"\.?$/) ||
      caption.match(/:\s*“([\s\S]*?)”\.?$/) ||
      caption.match(/:\s*'([\s\S]*?)'\.?$/);

    if (quotedCaption && quotedCaption[1]) {
      caption = cleanText(quotedCaption[1]);
    }

    caption = caption
      .replace(/^\d[\d.,kmb]*\s+(likes|me gusta)\s*,?\s*\d[\d.,kmb]*\s+(comments|comentarios)\s*-\s*/i, '')
      .replace(/^[^:"]+\bel\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}:\s*/i, '')
      .replace(/^"+|"+$/g, '')
      .trim();

    const engagementRatePost = profileFollowers > 0
      ? Number((((likes + comments) / profileFollowers) * 100).toFixed(2))
      : 0;

    return {
      id: data.shortcode || null,
      url: data.canonicalUrl || data.url,
      fecha: formatDateOnly(data.date),
      tipo: data.type === 'Video' ? 'Reel' : (data.imageCount > 1 ? 'Carrusel' : 'Imagen'),
      caption,
      ubicacion: cleanText(data.location || ''),
      likes,
      comments,
      views,
      engagementRatePost,
      imageCount: data.imageCount || 0,
      videoCount: data.videoCount || 0
    };
  } finally {
    await postPage.close();
  }
}


// ======================================================
// CREA UNA SALIDA LIMPIA Y SIMPLE
// ======================================================
function buildSimpleReport(raw) {
  const profile = raw.profile || {};
  const posts = Array.isArray(raw.posts) ? raw.posts : [];

  const bestPost = [...posts].sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))[0] || null;

  return {
    resumen: {
      usuario: profile.username || '',
      seguidores: profile.followers || 0,
      seguidos: profile.following || 0,
      publicaciones: profile.posts || 0,
      cuentaPrivada: !!profile.isPrivate,
      ultimaPublicacion: raw.lastPostDate || null,
      diasSinPublicar: raw.daysSinceLastPost ?? null
    },
    perfil: profile,
    posts,
    destacado: bestPost,
    scraping: {
      scrapedAt: raw.scrapedAt || null,
      scrapeDurationMs: raw.scrapeDuration || 0,
      requestCount: raw.requestCount || 0,
      errorCount: raw.errorCount || 0,
      sourceType: raw.sourceType || 'playwright'
    }
  };
}


// ======================================================
// FUNCIÓN PRINCIPAL
// ======================================================
async function run(profileUrlInput) {
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

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: authState,
    locale: 'es-ES'
  });

  context.on('request', () => {
    requestCount++;
  });

  const page = await context.newPage();

  try {
    console.log(`📂 Analizando perfil: ${profileUrl}`);

    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissDialogs(page);
    await page.waitForSelector('header', { timeout: 30000 });
    await page.waitForTimeout(1800);

    const rawProfile = await extractProfile(page);
    if (!rawProfile) throw new Error('No se pudo extraer el perfil.');

    const profile = {
      username: cleanText(rawProfile.username),
      bio: cleanText(rawProfile.bio),
      profilePic: rawProfile.profilePic || '',
      externalLink: rawProfile.externalLink || '',
      isPrivate: !!rawProfile.isPrivate,
      posts: parseCompactNumber(rawProfile.rawStats.posts),
      followers: parseCompactNumber(rawProfile.rawStats.followers),
      following: parseCompactNumber(rawProfile.rawStats.following)
    };

    if (profile.isPrivate) {
      const rawResult = {
        profile,
        posts: [],
        lastPostDate: null,
        daysSinceLastPost: null,
        scrapedAt: new Date().toISOString(),
        scrapeDuration: Date.now() - startedAt,
        requestCount,
        errorCount,
        sourceType: 'playwright'
      };

      const cleanResult = buildSimpleReport(rawResult);

      fs.writeFileSync('resultado_raw.json', JSON.stringify(rawResult, null, 2));
      fs.writeFileSync('resultado_limpio.json', JSON.stringify(cleanResult, null, 2));

      console.log('🔒 Cuenta privada. Se guardó solo información básica.');
      return;
    }

    const postLinks = await collectPostLinks(page, profile.username, 12);

    const posts = [];
    for (const item of postLinks) {
      try {
        console.log(`🔗 ${item.url}`);
        const post = await scrapePost(context, item, profile.followers);
        posts.push(post);

        // Espera fija corta para estabilidad
        await page.waitForTimeout(900);
      } catch (error) {
        errorCount++;
        console.log(`⚠️ Error en post: ${error.message}`);
      }
    }

    const validDates = posts
      .map((p) => p.fecha)
      .filter(Boolean)
      .map((d) => new Date(d))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => b - a);

    const lastPostDate = validDates[0] ? validDates[0].toISOString().slice(0, 10) : null;
    const daysSinceLastPost = validDates[0]
      ? Math.floor((Date.now() - validDates[0].getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const rawResult = {
      profile,
      posts,
      lastPostDate,
      daysSinceLastPost,
      scrapedAt: new Date().toISOString(),
      scrapeDuration: Date.now() - startedAt,
      requestCount,
      errorCount,
      sourceType: 'playwright'
    };

    const cleanResult = buildSimpleReport(rawResult);

    fs.writeFileSync('resultado_raw.json', JSON.stringify(rawResult, null, 2));
    fs.writeFileSync('resultado_limpio.json', JSON.stringify(cleanResult, null, 2));

    console.log('✅ Archivos generados: resultado_raw.json y resultado_limpio.json');
  } catch (error) {
    console.error('❌ Error crítico:', error.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}


// ======================================================
// PUNTO DE ENTRADA
// ======================================================
const target = process.argv[2] || 'https://www.instagram.com/instagram/';
run(target);