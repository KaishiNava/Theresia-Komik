const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://komikindo.ch";

const client = axios.create({
  timeout: 20000,
  maxRedirects: 5,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language":
      "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache"
  }
});

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
  return url ? url.replace(/#.*$/, "") : null;
}

function slugFromUrl(value) {
  const url = absoluteUrl(value);
  if (!url) return null;

  try {
    const parts = new URL(url).pathname
      .split("/")
      .filter(Boolean);

    return parts.length
      ? parts[parts.length - 1]
      : null;
  } catch {
    return null;
  }
}

function text(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstText($, selectors, root = null) {
  for (const selector of selectors) {
    const node = root ? root.find(selector).first() : $(selector).first();

    if (node.length) {
      const value = text(node.text());
      if (value) return value;
    }
  }

  return null;
}

function firstAttr($, selectors, attr, root = null) {
  for (const selector of selectors) {
    const node = root ? root.find(selector).first() : $(selector).first();

    if (node.length) {
      const value = node.attr(attr);

      if (value) {
        return cleanUrl(value);
      }
    }
  }

  return null;
}

function getImage($, root) {
  const img = root.find("img").first();

  if (!img.length) return null;

  const candidates = [
    "data-src",
    "data-lazy-src",
    "data-original",
    "data-lazy",
    "src"
  ];

  for (const attr of candidates) {
    const value = img.attr(attr);

    if (value) {
      const url = cleanUrl(value);

      if (url) return url;
    }
  }

  return null;
}

/* =========================================================
   CARD
========================================================= */

function parseCard($, element) {
  const el = $(element);

  const links = el.find("a[href]");

  if (!links.length) return null;

  let mangaLink = null;

  links.each((i, node) => {
    if (mangaLink) return;

    const href = $(node).attr("href");

    if (!href) return;

    const url = absoluteUrl(href);

    if (!url) return;

    if (
      new URL(url).pathname.startsWith("/komik/")
    ) {
      mangaLink = url;
    }
  });

  if (!mangaLink) {
    const href = links.first().attr("href");
    mangaLink = absoluteUrl(href);
  }

  if (!mangaLink) return null;

  const title =
    firstText(
      $,
      [
        ".tt h4",
        ".tt",
        ".entry-title",
        "h2",
        "h3",
        "h4"
      ],
      el
    ) ||
    text(
      links
        .filter((i, node) => {
          const href = $(node).attr("href");
          return href && href.includes("/komik/");
        })
        .first()
        .attr("title")
    ) ||
    text(
      links
        .filter((i, node) => {
          const href = $(node).attr("href");
          return href && href.includes("/komik/");
        })
        .first()
        .text()
    );

  if (!title) return null;

  const chapter =
    firstText(
      $,
      [
        ".epxs",
        ".chapter",
        ".epx",
        ".lsch a",
        ".eph-num"
      ],
      el
    );

  const rating =
    firstText(
      $,
      [
        ".numscore",
        ".rating",
        ".score"
      ],
      el
    );

  const type =
    firstText(
      $,
      [
        ".typeflag",
        ".mtype"
      ],
      el
    );

  return {
    title,
    slug: slugFromUrl(mangaLink),
    endpoint: mangaLink,
    thumbnail: getImage($, el),
    chapter: chapter || null,
    rating: rating || null,
    type: type || null
  };
}

function parseCards($) {
  const selectors = [
    ".listupd .bsx",
    ".listupd .bs",
    ".listupd article",
    ".animepost",
    ".bsx"
  ];

  const results = [];
  const seen = new Set();

  for (const selector of selectors) {
    $(selector).each((i, element) => {
      const item = parseCard($, element);

      if (!item) return;

      const key = item.endpoint || item.slug;

      if (!key || seen.has(key)) return;

      seen.add(key);
      results.push(item);
    });
  }

  return results;
}

/* =========================================================
   FETCH
========================================================= */

async function fetchPage(url) {
  const response = await client.get(url, {
    headers: {
      Referer: BASE_URL
    }
  });

  if (
    !response.data ||
    typeof response.data !== "string"
  ) {
    throw new Error("HTML sumber kosong.");
  }

  return response.data;
}

/* =========================================================
   HOME
========================================================= */

async function home() {
  const html = await fetchPage(BASE_URL);
  const $ = cheerio.load(html);

  const hotManga = [];
  const latestUpdate = [];

  $(".bixbox.hothome .bsx").each((i, el) => {
    const item = parseCard($, el);

    if (item) {
      hotManga.push(item);
    }
  });

  $(
    ".bixbox:not(.hothome) .bsx," +
    ".bixbox:not(.hothome) .animepost"
  ).each((i, el) => {
    const item = parseCard($, el);

    if (item) {
      latestUpdate.push(item);
    }
  });

  return {
    hotManga,
    latestUpdate: dedupe(latestUpdate)
  };
}

/* =========================================================
   SEARCH
========================================================= */

async function search(q, page = 1) {
  const pageNumber = Math.max(
    1,
    Number(page) || 1
  );

  const url =
    pageNumber === 1
      ? `${BASE_URL}/?s=${encodeURIComponent(q)}`
      : `${BASE_URL}/page/${pageNumber}/?s=${encodeURIComponent(q)}`;

  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  return parseCards($);
}

/* =========================================================
   LATEST
========================================================= */

async function latest(page = 1) {
  const pageNumber = Math.max(
    1,
    Number(page) || 1
  );

  const url =
    pageNumber === 1
      ? `${BASE_URL}/komik-terbaru/`
      : `${BASE_URL}/komik-terbaru/page/${pageNumber}/`;

  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  return parseCards($);
}

/* =========================================================
   LIST
========================================================= */

async function listManga(page = 1) {
  const pageNumber = Math.max(
    1,
    Number(page) || 1
  );

  const url =
    pageNumber === 1
      ? `${BASE_URL}/daftar-manga/`
      : `${BASE_URL}/daftar-manga/page/${pageNumber}/`;

  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  return parseCards($);
}

/* =========================================================
   DETAIL
========================================================= */

async function detail(slug) {
  const safeSlug = String(slug || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");

  if (!safeSlug) {
    throw new Error("Slug manga kosong.");
  }

  const url =
    `${BASE_URL}/komik/${encodeURIComponent(safeSlug)}/`;

  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  const title =
    firstText($, [
      ".infox h1",
      ".entry-title",
      "h1"
    ]);

  const thumbnail =
    firstAttr(
      $,
      [
        ".thumb img",
        ".ime img",
        ".bigcontent img",
        ".infox img"
      ],
      "data-src"
    ) ||
    firstAttr(
      $,
      [
        ".thumb img",
        ".ime img",
        ".bigcontent img",
        ".infox img"
      ],
      "src"
    );

  const synopsis =
    firstText($, [
      ".entry-content[itemprop='description']",
      ".desc",
      ".entry-content",
      ".description"
    ]);

  const rating =
    firstText($, [
      ".numscore",
      ".rating",
      ".score"
    ]);

  const status =
    firstText($, [
      ".fstatus",
      ".status"
    ]);

  const author =
    firstText($, [
      ".authorx",
      ".author",
      "[itemprop='author']"
    ]);

  const artist =
    firstText($, [
      ".artistx",
      ".artist",
      ".illustrator"
    ]);

  const genres = [];

  $(
    ".genre-info a," +
    ".genrex a," +
    ".genres a," +
    ".mgen a," +
    ".genres-content a"
  ).each((i, el) => {
    const value = text($(el).text());

    if (
      value &&
      !genres.includes(value)
    ) {
      genres.push(value);
    }
  });

  /*
   * Chapter hanya dikembalikan sebagai metadata/link
   * dan tidak mengambil halaman/gambar baca.
   */

  const chapters = [];
  const chapterSeen = new Set();

  $(
    "#chapterlist li," +
    ".eplister li," +
    ".clstyle li," +
    ".listing-chapters_wrap li"
  ).each((i, el) => {
    const a = $(el)
      .find("a[href]")
      .first();

    if (!a.length) return;

    const href = a.attr("href");
    const chapterUrl = absoluteUrl(href);

    if (!chapterUrl) return;

    const chapterTitle =
      firstText(
        $,
        [
          ".chapternum",
          ".lchx a",
          ".eph-num a",
          ".chapter"
        ],
        $(el)
      ) ||
      text(a.text());

    const date =
      firstText(
        $,
        [
          ".chapterdate",
          ".eph-date",
          ".chapter-date"
        ],
        $(el)
      );

    if (
      chapterSeen.has(chapterUrl)
    ) {
      return;
    }

    chapterSeen.add(chapterUrl);

    chapters.push({
      title: chapterTitle || null,
      slug: slugFromUrl(chapterUrl),
      url: chapterUrl,
      date: date || null
    });
  });

  return {
    title,
    slug: safeSlug,
    endpoint: url,
    thumbnail,
    synopsis,
    rating,
    status,
    author,
    artist,
    genres,
    totalChapters: chapters.length,
    chapters
  };
}

/* =========================================================
   UTILS
========================================================= */

function dedupe(items) {
  const seen = new Set();

  return items.filter(item => {
    const key =
      item.endpoint ||
      item.slug ||
      item.title;

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

/* =========================================================
   HANDLER
========================================================= */

module.exports = async function handler(req, res) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const action = String(
    req.query.action || ""
  )
    .trim()
    .toLowerCase();

  try {
    let data;

    switch (action) {
      case "home":
        data = await home();
        break;

      case "search": {
        const q = String(
          req.query.q || ""
        ).trim();

        if (!q) {
          return res.status(400).json({
            status: false,
            message: "Parameter q wajib diisi."
          });
        }

        data = await search(
          q,
          req.query.page || 1
        );

        break;
      }

      case "latest":
        data = await latest(
          req.query.page || 1
        );
        break;

      case "list":
        data = await listManga(
          req.query.page || 1
        );
        break;

      case "detail": {
        const slug = String(
          req.query.slug || ""
        ).trim();

        if (!slug) {
          return res.status(400).json({
            status: false,
            message:
              "Parameter slug wajib diisi."
          });
        }

        data = await detail(slug);
        break;
      }

      default:
        return res.status(400).json({
          status: false,
          message: "Action tidak tersedia.",
          available: [
            "home",
            "search",
            "latest",
            "list",
            "detail"
          ],
          examples: {
            home: "/api/komikindo?action=home",
            search:
              "/api/komikindo?action=search&q=magic",
            latest:
              "/api/komikindo?action=latest&page=1",
            list:
              "/api/komikindo?action=list&page=1",
            detail:
              "/api/komikindo?action=detail&slug=magic-emperor"
          }
        });
    }

    return res.status(200).json({
      status: true,
      source: BASE_URL,
      action,
      data
    });

  } catch (error) {
    console.error("KOMIKINDO SCRAPER ERROR:", {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      url: error.config?.url
    });

    return res.status(
      error.response?.status >= 400
        ? error.response.status
        : 500
    ).json({
      status: false,
      message:
        "Gagal mengambil data dari sumber.",
      error: {
        message: error.message,
        sourceStatus:
          error.response?.status || null,
        sourceUrl:
          error.config?.url || null
      }
    });
  }
};