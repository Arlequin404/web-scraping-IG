const { chromium } = require('playwright');
const fs = require('fs');
const readline = require('readline');

function askCookies() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    process.stdout.write('📋 Pega tus cookies o sessionid aquí y pulsa ENTER: ');
    rl.question('', (answer) => {
      rl.close();
      let input = answer.trim().replace(/^>\s*/, '').replace(/^["']|["']$/g, '');
      if (!input) return resolve(null);

      try {
        // Si es JSON completo
        return resolve(JSON.parse(input));
      } catch (e) {
        // Si es una cadena de texto (asumimos sessionid)
        const cookies = [{
          name: 'sessionid',
          value: input.includes('=') ? input.split('=')[1].split(';')[0].trim() : input,
          domain: '.instagram.com',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'None'
        }];
        return resolve({ cookies, origins: [] });
      }
    });
  });
}


function normalizeUrl(profileUrl) {
  if (!profileUrl) return 'https://www.instagram.com/instagram/';
  const trimmed = profileUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  }
  return `https://www.instagram.com/${trimmed.replace(/^@/, '').replace(/^\/+|\/+$/g, '')}/`;
}

function parseCount(text) {
  if (!text) return 0;
  const raw = String(text)
    .toLowerCase()
    .replace(/seguidores|seguidos|publicaciones|posts?|followers?|following|,|\s/g, '')
    .trim();

  const match = raw.match(/([\d.]+)([kmb])?/i);
  if (!match) return parseInt(raw.replace(/\D/g, ''), 10) || 0;

  const value = parseFloat(match[1]);
  const suffix = (match[2] || '').toLowerCase();
  const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
  return Math.round(value * multiplier);
}

function safeAverage(total, count) {
  return count > 0 ? Math.round(total / count) : 0;
}

function topN(items, limit = 3) {
  const counts = new Map();
  for (const item of items.filter(Boolean)) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ value: key, count }));
}

async function dismissDialogs(page) {
  const labels = ['Permitir todas las cookies', 'Allow all cookies', 'Ahora no', 'Not Now'];
  for (const label of labels) {
    const button = page.getByRole('button', { name: label }).first();
    try {
      if (await button.isVisible({ timeout: 1500 })) {
        await button.click({ timeout: 1500 });
        await page.waitForTimeout(500);
      }
    } catch (_) {}
  }
}

async function extractProfile(page) {
  return page.evaluate(() => {
    const text = (el) => el?.textContent?.trim() || '';
    const header = document.querySelector('header');
    if (!header) return null;

    const username = text(header.querySelector('h2')) || text(document.querySelector('meta[property="og:title"]'));

    const statLinks = Array.from(header.querySelectorAll('li, section ul li, a, span'));
    const stats = { posts: 0, followers: 0, following: 0 };

    for (const node of statLinks) {
      const t = text(node).toLowerCase();
      if (!t) continue;
      if ((t.includes('publicaci') || t.includes('post')) && !stats.posts) stats.posts = t;
      if ((t.includes('seguidor') || t.includes('followers')) && !stats.followers) stats.followers = t;
      if ((t.includes('seguidos') || t.includes('following')) && !stats.following) stats.following = t;
    }

    const allDivs = Array.from(header.querySelectorAll('div, span'))
      .map((el) => text(el))
      .filter(Boolean);

    const fullName = allDivs.find((t) => t !== username && t.length > 1 && !/^(publicaciones|seguidores|seguidos|posts|followers|following)/i.test(t)) || '';

    const bioCandidates = Array.from(header.querySelectorAll('section div, div[dir="auto"], span'))
      .map((el) => text(el))
      .filter(Boolean)
      .filter((t) => ![username, fullName].includes(t))
      .filter((t) => !/^(publicaciones|seguidores|seguidos|posts|followers|following|contacto|seguir|mensaje|siguiendo|follow|message|contact)$/i.test(t));

    const bio = bioCandidates.find((t) => t.length > 2) || '';

    const profilePic = header.querySelector('img')?.src || document.querySelector('meta[property="og:image"]')?.content || '';
    const externalLinkEl = header.querySelector('a[href*="l.instagram.com"], a[rel="me"], a[target="_blank"]');

    const pageText = document.body.innerText.toLowerCase();
    const privateMarkers = [
      'esta cuenta es privada',
      'this account is private'
    ];

    return {
      username,
      fullName,
      bio,
      category: '',
      profilePic,
      isVerified: !!header.querySelector('svg[aria-label*="Verified"], svg[title*="Verified"], svg[aria-label*="verificada"], svg[title*="verificada"]'),
      hasContact: !!Array.from(header.querySelectorAll('button')).find((b) => /contact|contacto/i.test(text(b))),
      rawStats: stats,
      isPrivate: privateMarkers.some((marker) => pageText.includes(marker)),
      externalLink: externalLinkEl?.href || externalLinkEl?.textContent?.trim() || ''
    };
  });
}

async function collectPostLinks(page, limit = 12) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);

  return page.evaluate((maxItems) => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
    const unique = new Map();

    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href || unique.has(href)) continue;
      const card = a.closest('article, div');
      const aria = card?.innerHTML || '';
      unique.set(href, {
        url: href.startsWith('http') ? href : `https://www.instagram.com${href}`,
        isPinned: /fijad|pinned/i.test(aria),
        type: href.includes('/reel/') ? 'Video' : (/carrusel|carousel/i.test(aria) ? 'Carousel' : 'Image')
      });
      if (unique.size >= maxItems) break;
    }

    return [...unique.values()];
  }, limit);
}

async function scrapePost(context, item) {
  const postPage = await context.newPage();
  try {
    await postPage.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissDialogs(postPage);
    await postPage.waitForSelector('article, main', { timeout: 15000 });
    await postPage.waitForTimeout(1200);

    const data = await postPage.evaluate((info) => {
      const text = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
      const metaDescription = document.querySelector('meta[property="og:description"]')?.content || '';
      const timeEl = document.querySelector('time');
      const date = timeEl?.getAttribute('datetime') || '';
      const caption = text('h1') || text('article ul li h1') || '';
      const location = text('a[href*="/explore/locations/"]');

      let likes = 0;
      const likeCandidates = Array.from(document.querySelectorAll('section, span, a, div'))
        .map((el) => el.textContent?.trim() || '')
        .filter(Boolean);

      const likeText = likeCandidates.find((t) => /(likes|me gusta)/i.test(t)) || metaDescription;
      const likeMatch = likeText.match(/([\d.,]+)\s*(likes|me gusta)/i);
      if (likeMatch) {
        likes = parseInt(likeMatch[1].replace(/[^\d]/g, ''), 10) || 0;
      }

      const commentNodes = document.querySelectorAll('ul ul, article ul > li');
      const comments = Math.max(commentNodes.length - 1, 0);

      const rawCaption = caption || metaDescription;

      return {
        ...info,
        caption,
        hashtags: rawCaption.match(/#\w+/g) || [],
        mentions: rawCaption.match(/@\w+/g) || [],
        date,
        likes,
        comments,
        location
      };
    }, item);

    return data;
  } finally {
    await postPage.close();
  }
}

async function expertScrape(profileUrlInput) {
  const profileUrl = normalizeUrl(profileUrlInput);
  const authState = await askCookies();

  if (!authState) {
    console.error('❌ No se proporcionaron cookies válidas.');
    process.exitCode = 1;
    return;
  }

  console.log('🧐 Iniciando análisis...');
  const browser = await chromium.launch({ headless: true }); // Headless está bien si usamos cookies
  const context = await browser.newContext({ storageState: authState, locale: 'es-ES' });
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
      posts: parseCount(rawProfile.rawStats.posts),
      followers: parseCount(rawProfile.rawStats.followers),
      following: parseCount(rawProfile.rawStats.following)
    };

    const profile = {
      username: rawProfile.username,
      fullName: rawProfile.fullName,
      bio: rawProfile.bio,
      category: rawProfile.category,
      profilePic: rawProfile.profilePic,
      isVerified: rawProfile.isVerified,
      hasContact: rawProfile.hasContact,
      stats: {
        ...stats,
        ratio: Number((stats.followers / Math.max(stats.following, 1)).toFixed(2))
      },
      isPrivate: rawProfile.isPrivate,
      externalLink: rawProfile.externalLink
    };

    if (profile.isPrivate) {
      console.log('🔒 Cuenta privada. Guardando solo datos básicos.');
      fs.writeFileSync('resultado.json', JSON.stringify({ ...profile, analysis: null, posts: [] }, null, 2));
      return;
    }

    console.log('📸 Extrayendo publicaciones...');
    const postLinks = await collectPostLinks(page, 12);

    const detailedPosts = [];
    for (const item of postLinks) {
      console.log(`   🔗 ${item.url}`);
      try {
        const post = await scrapePost(context, item);
        detailedPosts.push(post);
      } catch (error) {
        console.log(`      ⚠️ No se pudo analizar este post: ${error.message}`);
      }
    }

    const totalLikes = detailedPosts.reduce((sum, post) => sum + (post.likes || 0), 0);
    const totalComments = detailedPosts.reduce((sum, post) => sum + (post.comments || 0), 0);
    const followers = Math.max(profile.stats.followers, 1);
    const analyzedCount = detailedPosts.length;

    const engagementRate = analyzedCount > 0
      ? `${((((totalLikes + totalComments) / analyzedCount) / followers) * 100).toFixed(2)}%`
      : '0.00%';

    const validDates = detailedPosts
      .map((post) => new Date(post.date))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => b - a);

    let publicationFrequency = 'No determinada';
    if (validDates.length > 1) {
      const days = Math.max((validDates[0] - validDates[validDates.length - 1]) / (1000 * 60 * 60 * 24), 1);
      publicationFrequency = `${(analyzedCount / (days / 30)).toFixed(1)} posts/mes`;
    }

    const distribution = { Image: 0, Video: 0, Carousel: 0 };
    for (const post of detailedPosts) {
      if (distribution[post.type] !== undefined) distribution[post.type] += 1;
    }

    const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const postingDays = validDates.map((d) => dayNames[d.getDay()]);
    const postingHours = validDates.map((d) => `${String(d.getHours()).padStart(2, '0')}:00`);

    const analysis = {
      totalAnalyzed: analyzedCount,
      engagementRate,
      avgLikes: safeAverage(totalLikes, analyzedCount),
      avgComments: safeAverage(totalComments, analyzedCount),
      publicationFrequency,
      contentTypeDistribution: distribution,
      topPostingDays: topN(postingDays, 3),
      topPostingHours: topN(postingHours, 3),
      commonHashtags: topN(detailedPosts.flatMap((p) => p.hashtags), 10),
      commonMentions: topN(detailedPosts.flatMap((p) => p.mentions), 10),
      dominantLanguage: profile.bio ? 'Detectado por bio/posts' : 'No determinado'
    };

    const finalReport = { ...profile, analysis, posts: detailedPosts };
    fs.writeFileSync('resultado.json', JSON.stringify(finalReport, null, 2));

    console.log('✅ Informe generado en resultado.json');
  } catch (error) {
    console.error('❌ Error crítico:', error.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

const target = process.argv[2] || 'https://www.instagram.com/instagram/';
expertScrape(target);
