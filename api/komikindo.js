const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://komikindo.ch";

// Setup Axios dengan headers yang lebih mirip browser asli
const client = axios.create({
  timeout: 8000, // Vercel hobby limit 10 detik, kita set 8 detik agar sempat me-return error
  maxRedirects: 5,
  validateStatus: status => status >= 200 && status < 500,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Ch-Ua": '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache"
  }
});

/* =========================================================
   CACHE
========================================================= */

const cache = new Map();
const CACHE_TTL = 45 * 1000;

function getCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.time > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data) {
  cache.set(key, {
    time: Date.now(),
    data
  });
  if (cache.size > 100) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
}

/* =========================================================
   HELPERS
========================================================= */

function text(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value) {
  if (!value) return null;
  try {
    return new URL(value, BASE_URL).href;
  } catch {
    return null;
  }
}

function cleanUrl(value) {
  const url = absoluteUrl(value);
  if (!url) return null;
  return url.replace(/#.*$/, "");
}

function slugFromUrl(value) {
  const url = absoluteUrl(value);
  if (!url) return null;
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  } catch {
    return null;
  }
}

function isMangaUrl(url) {
  if (!url) return false;
  try {
    const pathname = new URL(url).pathname;
    return (
      pathname.startsWith("/komik/") &&
      pathname.split("/").filter(Boolean).length >= 2
    );
  } catch {
    return false;
  }
}

function isChapterUrl(url) {
  if (!url) return false;
  try {
    const pathname = new URL(url).pathname.split("/").filter(Boolean).join("/");
    return (
      /(^|\/)chapter[-/]/i.test(pathname) ||
      /-chapter-[0-9]/i.test(pathname) ||
      /\/[^/]+-ch(?:apter)?[-. ]?[0-9]/i.test(pathname)
    );
  } catch {
    return false;
  }
}

/* =========================================================
   IMAGE
========================================================= */

function getImage($, element) {
  const img = $(element).find("img").first();
  if (!img.length) return null;

  const attrs = [
    "src",
    "data-src",
    "data-lazy-src",
    "data-original",
    "data-lazy",
    "data-fallback-src"
  ];

  for (const attr of attrs) {
    const value = img.attr(attr);
    if (value) {
      const url = cleanUrl(value);
      if (url) return url;
    }
  }
  return null;
}

/* =========================================================
   PARSE MANGA CARD
========================================================= */

function parseMangaLink($, element) {
  const a = $(element);
  const href = a.attr("href") || a.find("a").first().attr("href");
  const url = cleanUrl(href);

  if (!isMangaUrl(url)) return null;

  let title =
    text(a.find("h2,h3,h4").first().text()) ||
    text(a.find(".tt").first().text()) ||
    text(a.attr("title")) ||
    text(a.find("a").first().attr("title")) ||
    text(a.text());

  if (!title) return null;

  title = title.replace(/\bWarna\b/gi, "").replace(/\s+/g, " ").trim();

  return {
    title,
    slug: slugFromUrl(url),
    endpoint: url,
    thumbnail: getImage($, element),
    chapter: null,
    rating: null,
    type: null
  };
}

/* =========================================================
   GENERIC MANGA CARDS
========================================================= */

function parseCards($) {
  const results = [];
  const seen = new Set();
  const selectors = [
    ".listupd .bsx",
    ".listupd .bs",
    ".listupd .animepost",
    ".bsx",
    ".animepost",
    ".page-item-detail"
  ];

  for (const selector of selectors) {
    $(selector).each((i, el) => {
      const item = parseMangaLink($, el);
      if (!item || seen.has(item.endpoint)) return;
      seen.add(item.endpoint);
      results.push(item);
    });
  }

  if (results.length === 0) {
    $("a[href]").each((i, el) => {
      const item = parseMangaLink($, el);
      if (!item || seen.has(item.endpoint)) return;
      seen.add(item.endpoint);
      results.push(item);
    });
  }

  return results;
}

/* =========================================================
   FETCH
========================================================= */

async function fetchPage(url, options = {}) {
  const cacheKey = url;

  if (!options.noCache) {
    const cached = getCache(cacheKey);
    if (cached) return cached;
  }

  try {
    const response = await client.get(url, {
      headers: {
        Referer: options.referer || BASE_URL
      }
    });

    if (response.status >= 400) {
      throw new Error(`HTTP Error ${response.status}: Situs sumber mungkin memblokir Vercel (Cloudflare/403) atau situs sedang down.`);
    }

    const html = response.data;

    if (typeof html !== "string" || html.length < 500) {
      throw new Error("Response HTML tidak valid atau diblokir oleh anti-bot.");
    }

    setCache(cacheKey, html);
    return html;

  } catch (error) {
    throw error;
  }
}

/* =========================================================
   HOME
========================================================= */

async function home() {
  const html = await fetchPage(BASE_URL);
  const $ = cheerio.load(html);

  const hotManga = [];
  const latestUpdate = [];
  const hotSeen = new Set();
  const latestSeen = new Set();

  $(
    ".hothome .bsx," +
    ".hothome .bs," +
    ".hothome .animepost"
  ).each((i, el) => {
    const item = parseMangaLink($, el);
    if (!item || hotSeen.has(item.endpoint)) return;
    hotSeen.add(item.endpoint);
    hotManga.push(item);
  });

  if (hotManga.length === 0) {
    $("a[href]").each((i, el) => {
      const item = parseMangaLink($, el);
      if (!item || latestSeen.has(item.endpoint)) return;
      latestSeen.add(item.endpoint);
      latestUpdate.push(item);
    });
  }

  $(
    ".bixbox:not(.hothome) .bsx," +
    ".bixbox:not(.hothome) .bs," +
    ".bixbox:not(.hothome) .animepost"
  ).each((i, el) => {
    const item = parseMangaLink($, el);
    if (!item || latestSeen.has(item.endpoint)) return;
    latestSeen.add(item.endpoint);
    latestUpdate.push(item);
  });

  return { hotManga, latestUpdate };
}

/* =========================================================
   SEARCH
========================================================= */

async function search(q, page = 1) {
  const query = text(q);
  if (!query) throw new Error("Parameter q wajib diisi.");

  let url = page <= 1 
    ? `${BASE_URL}/?s=${encodeURIComponent(query)}`
    : `${BASE_URL}/page/${page}/?s=${encodeURIComponent(query)}`;

  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  const results = parseCards($);

  return { query, page, total: results.length, results };
}

/* =========================================================
   LATEST
========================================================= */

async function latest(page = 1) {
  const url = page <= 1
      ? `${BASE_URL}/komik-terbaru/`
      : `${BASE_URL}/komik-terbaru/page/${page}/`;

  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  $("a[href]").each((i, el) => {
    const href = cleanUrl($(el).attr("href"));
    if (!isMangaUrl(href)) return;

    const title = text($(el).text());
    if (!title || seen.has(href)) return;
    seen.add(href);

    const parent = $(el).closest("li,.bsx,.animepost,.postbody,.bixbox,article");
    let chapter = null;

    if (parent.length) {
      const parentText = text(parent.text());
      const match = parentText.match(/\b(?:Ch\.?|Chapter)\s*[\w.-]+/i);
      if (match) chapter = match[0];
    }

    results.push({
      title,
      slug: slugFromUrl(href),
      endpoint: href,
      thumbnail: getImage($, el),
      chapter
    });
  });

  if (results.length === 0) {
    const fallback = parseCards($);
    return { page, total: fallback.length, results: fallback };
  }

  return { page, total: results.length, results };
}

/* =========================================================
   LIST
========================================================= */

async function listManga(page = 1) {
  const url = page <= 1
      ? `${BASE_URL}/daftar-manga/`
      : `${BASE_URL}/daftar-manga/page/${page}/`;

  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  $("a[href]").each((i, el) => {
    const href = cleanUrl($(el).attr("href"));
    if (!isMangaUrl(href)) return;

    const title = text($(el).find("h2,h3,h4").first().text()) || text($(el).attr("title")) || text($(el).text());
    if (!title || seen.has(href)) return;
    seen.add(href);

    results.push({
      title,
      slug: slugFromUrl(href),
      endpoint: href,
      thumbnail: getImage($, el),
      rating: null,
      chapter: null
    });
  });

  return { page, total: results.length, results };
}

/* =========================================================
   DETAIL
========================================================= */

async function detail(slug) {
  slug = text(slug);
  if (!slug) throw new Error("Parameter slug wajib diisi.");

  const url = `${BASE_URL}/komik/${encodeURIComponent(slug)}/`;
  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  const title = text($(".infox h1").first().text()) || text($("h1.entry-title").first().text()) || text($("h1").first().text());

  let thumbnail = null;
  const thumbSelectors = [".thumb img", ".ime img", ".bigcover img", ".c-tabs-item__content img"];
  for (const selector of thumbSelectors) {
    const value = getImage($, $(selector).first());
    if (value) {
      thumbnail = value;
      break;
    }
  }

  const synopsis = text($(".entry-content[itemprop='description']").first().text()) || text($(".desc").first().text()) || text($(".entry-content").first().text());
  const rating = text($(".numscore").first().text()) || null;
  const status = text($(".fstatus").first().text()) || text($(".status").first().text()) || null;

  const genres = [];
  const genreSeen = new Set();
  $(".genre-info a, .genrex a, .genres a, .mgen a, .seriestugenre a").each((i, el) => {
    const value = text($(el).text());
    if (!value || genreSeen.has(value)) return;
    genreSeen.add(value);
    genres.push(value);
  });

  const chapterList = [];
  const chapterSeen = new Set();

  $("a[href]").each((i, el) => {
    const a = $(el);
    const href = cleanUrl(a.attr("href"));
    if (!isChapterUrl(href)) return;

    const anchorText = text(a.text());
    const parentText = text(a.parent().text());
    const combined = `${anchorText} ${parentText}`;

    if (!/chapter|ch\./i.test(combined) && !/chapter/i.test(href)) return;
    if (chapterSeen.has(href)) return;
    chapterSeen.add(href);

    const chapterTitle = anchorText || text(a.find(".chapternum,.eph-num,.lchx").first().text()) || slugFromUrl(href);
    let date = null;
    const parent = a.closest("li,.eplister,.clstyle,.chapter-list,.row");
    if (parent.length) {
      date = text(parent.find(".chapterdate,.eph-date,.chapter-date").first().text()) || null;
    }

    chapterList.push({
      title: chapterTitle,
      slug: slugFromUrl(href),
      url: href,
      date
    });
  });

  chapterList.sort((a, b) => {
    const getNumber = value => {
      const match = String(value || "").match(/(\d+(?:\.\d+)?)/);
      return match ? Number(match[1]) : -1;
    };
    return getNumber(b.title) - getNumber(a.title);
  });

  return { title, slug, thumbnail, synopsis, rating, status, genres, chapterList, totalChapters: chapterList.length };
}

/* =========================================================
   CHAPTER
========================================================= */

async function chapter(slug) {
  slug = text(slug);
  if (!slug) throw new Error("Parameter slug wajib diisi.");

  const url = `${BASE_URL}/${encodeURIComponent(slug)}/`;
  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  const title = text($(".entry-title").first().text()) || text($(".title-section").first().text()) || text($("h1").first().text());
  const images = [];
  const seen = new Set();

  const selectors = [
    "#readerarea img",
    ".reading-content img",
    ".readingarea img",
    ".chapter-content img",
    ".reader-area img",
    ".reading-content-container img",
    ".entry-content img"
  ];

  for (const selector of selectors) {
    $(selector).each((i, el) => addReaderImage($, el));
    if (images.length > 0) break;
  }

  if (images.length === 0) {
    $("img").each((i, el) => addReaderImage($, el));
  }

  function addReaderImage($, element) {
    const img = $(element);
    const sources = [
      img.attr("data-src"),
      img.attr("data-lazy-src"),
      img.attr("data-original"),
      img.attr("data-lazy"),
      img.attr("src")
    ];

    let url = null;
    for (const source of sources) {
      const candidate = cleanUrl(source);
      if (candidate) {
        url = candidate;
        break;
      }
    }

    if (!url) return;
    const lower = url.toLowerCase();
    const blocked = ["logo", "avatar", "favicon", "histats", "google-analytics", "gravatar"];

    if (blocked.some(value => lower.includes(value))) return;
    if (lower.endsWith(".gif") && !lower.includes("chapter")) return;
    if (seen.has(url)) return;

    seen.add(url);
    images.push(url);
  }

  return { title, slug, totalImages: images.length, images };
}

/* =========================================================
   HANDLER / EXPORT UNTUK VERCEL
========================================================= */

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ status: false, message: "Method tidak diizinkan." });
  }

  const action = String(req.query.action || "").toLowerCase();

  try {
    let data;
    switch (action) {
      case "home":
        data = await home();
        break;
      case "search": {
        const q = text(req.query.q);
        const page = Math.max(1, Number(req.query.page || 1));
        if (!q) return res.status(400).json({ status: false, message: "Parameter q wajib diisi." });
        data = await search(q, page);
        break;
      }
      case "latest": {
        const page = Math.max(1, Number(req.query.page || 1));
        data = await latest(page);
        break;
      }
      case "list": {
        const page = Math.max(1, Number(req.query.page || 1));
        data = await listManga(page);
        break;
      }
      case "detail": {
        const slug = text(req.query.slug);
        if (!slug) return res.status(400).json({ status: false, message: "Parameter slug wajib diisi." });
        data = await detail(slug);
        break;
      }
      case "chapter": {
        const slug = text(req.query.slug);
        if (!slug) return res.status(400).json({ status: false, message: "Parameter slug wajib diisi." });
        data = await chapter(slug);
        break;
      }
      default:
        return res.status(400).json({
          status: false,
          message: "Action tidak tersedia.",
          available: ["home", "search", "latest", "list", "detail", "chapter"]
        });
    }

    return res.status(200).json({ status: true, source: BASE_URL, action, data });

  } catch (error) {
    console.error(`[KomikIndo:${action}] ERROR:`, error.message);
    
    // PERUBAHAN PENTING: Error message asli sekarang dikirimkan ke frontend
    return res.status(502).json({
      status: false,
      message: "Scraping gagal.",
      action: action,
      detail_error: error.message || "Unknown Error", 
      tips: "Jika tertulis HTTP Error 403, berarti IP Vercel kamu diblokir oleh sistem anti-bot/Cloudflare website sumber."
    });
  }
};
