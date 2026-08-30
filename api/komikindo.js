const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL =
  "https://komikindo.ch";

const client =
  axios.create({

    timeout: 20000,

    maxRedirects: 5,

    headers: {

      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",

      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",

      "Accept-Language":
        "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  });


function absoluteUrl(
  value
){

  if(!value){
    return null;
  }

  try{

    return new URL(
      value,
      BASE_URL
    ).href;

  }catch{

    return null;
  }

}


function cleanUrl(
  value
){

  const url =
    absoluteUrl(value);

  if(!url){
    return null;
  }

  return url.replace(
    /#.*$/,
    ""
  );

}


function slugFromUrl(
  value
){

  const url =
    absoluteUrl(value);

  if(!url){
    return null;
  }

  try{

    const parts =
      new URL(url)
        .pathname
        .split("/")
        .filter(Boolean);

    return parts.length
      ? parts[parts.length - 1]
      : null;

  }catch{

    return null;

  }

}


function text(
  value
){

  return String(
    value || ""
  )
    .replace(/\u00a0/g," ")
    .replace(/\s+/g," ")
    .trim();

}


function image(
  $,
  element
){

  const img =
    $(element)
      .find("img")
      .first();

  if(!img.length){
    return null;
  }

  const src =
    img.attr("src") ||
    img.attr("data-src") ||
    img.attr("data-lazy-src") ||
    img.attr("data-original") ||
    img.attr("data-lazy");

  return cleanUrl(src);

}


function parseCard(
  $,
  element
){

  const el =
    $(element);

  const a =
    el.find("a")
      .first();

  const href =
    a.attr("href");

  if(!href){
    return null;
  }

  const url =
    absoluteUrl(href);

  if(!url){
    return null;
  }

  const title =
    text(
      el.find(".tt h4")
        .first()
        .text()
    ) ||

    text(
      el.find(".tt")
        .first()
        .text()
    ) ||

    text(
      el.find("h2")
        .first()
        .text()
    ) ||

    text(
      el.find("h3")
        .first()
        .text()
    ) ||

    text(
      el.find("h4")
        .first()
        .text()
    ) ||

    text(
      a.attr("title")
    ) ||

    text(
      a.text()
    );

  if(!title){
    return null;
  }

  return {

    title,

    slug:
      slugFromUrl(url),

    endpoint:
      url,

    thumbnail:
      image($,element),

    chapter:
      text(
        el.find(".epxs")
          .first()
          .text()
      ) ||
      text(
        el.find(".chapter")
          .first()
          .text()
      ) ||
      null,

    rating:
      text(
        el.find(".numscore")
          .first()
          .text()
      ) ||
      null,

    type:
      text(
        el.find(".typeflag")
          .first()
          .text()
      ) ||
      null
  };

}


function parseCards(
  $
){

  const selectors = [

    ".listupd .bsx",

    ".listupd .bs",

    ".animepost",

    ".bsx"
  ];

  const results = [];

  for(
    const selector
    of selectors
  ){

    $(selector)
      .each(
        (i,el) => {

          const item =
            parseCard(
              $,
              el
            );

          if(item){
            results.push(item);
          }

        }
      );

  }

  const seen =
    new Set();

  return results.filter(
    item => {

      if(
        seen.has(
          item.endpoint
        )
      ){
        return false;
      }

      seen.add(
        item.endpoint
      );

      return true;

    }
  );

}


async function fetchPage(
  url
){

  const response =
    await client.get(
      url,
      {
        headers:{
          Referer:
            BASE_URL
        }
      }
    );

  return response.data;

}


/* =========================================================
   HOME
========================================================= */

async function home(){

  const html =
    await fetchPage(
      BASE_URL
    );

  const $ =
    cheerio.load(
      html
    );

  let hotManga = [];

  let latestUpdate = [];

  $(".bixbox.hothome .bsx")
    .each(
      (i,el) => {

        const item =
          parseCard($,el);

        if(item){
          hotManga.push(item);
        }

      }
    );

  $(
    ".bixbox:not(.hothome) .animepost," +
    ".bixbox:not(.hothome) .bsx"
  )
    .each(
      (i,el) => {

        const item =
          parseCard($,el);

        if(item){
          latestUpdate.push(item);
        }

      }
    );

  return {
    hotManga,
    latestUpdate
  };

}


/* =========================================================
   SEARCH
========================================================= */

async function search(
  q,
  page = 1
){

  const url =
    page == 1
      ? `${BASE_URL}/?s=${encodeURIComponent(q)}`
      : `${BASE_URL}/page/${page}/?s=${encodeURIComponent(q)}`;

  const html =
    await fetchPage(
      url
    );

  const $ =
    cheerio.load(
      html
    );

  return parseCards($);

}


/* =========================================================
   LATEST
========================================================= */

async function latest(
  page = 1
){

  const url =
    page == 1
      ? `${BASE_URL}/komik-terbaru/`
      : `${BASE_URL}/komik-terbaru/page/${page}/`;

  const html =
    await fetchPage(
      url
    );

  const $ =
    cheerio.load(
      html
    );

  return parseCards($);

}


/* =========================================================
   LIST
========================================================= */

async function listManga(
  page = 1
){

  const url =
    page == 1
      ? `${BASE_URL}/daftar-manga/`
      : `${BASE_URL}/daftar-manga/page/${page}/`;

  const html =
    await fetchPage(
      url
    );

  const $ =
    cheerio.load(
      html
    );

  return parseCards($);

}


/* =========================================================
   DETAIL
========================================================= */

async function detail(
  slug
){

  const html =
    await fetchPage(
      `${BASE_URL}/komik/${encodeURIComponent(slug)}/`
    );

  const $ =
    cheerio.load(
      html
    );

  const title =
    text(
      $(".infox h1")
        .first()
        .text()
    ) ||
    text(
      $("h1.entry-title")
        .first()
        .text()
    ) ||
    text(
      $("h1")
        .first()
        .text()
    );

  const thumbnail =
    cleanUrl(
      $(".thumb img")
        .first()
        .attr("src")
    ) ||

    cleanUrl(
      $(".thumb img")
        .first()
        .attr("data-src")
    ) ||

    cleanUrl(
      $(".ime img")
        .first()
        .attr("src")
    );

  const synopsis =
    text(
      $(
        ".entry-content[itemprop='description']"
      )
        .first()
        .text()
    ) ||

    text(
      $(".desc")
        .first()
        .text()
    ) ||

    text(
      $(".entry-content")
        .first()
        .text()
    );

  const rating =
    text(
      $(".numscore")
        .first()
        .text()
    ) ||
    null;

  const status =
    text(
      $(".fstatus")
        .first()
        .text()
    ) ||
    text(
      $(".status")
        .first()
        .text()
    ) ||
    null;

  const genres = [];

  $(
    ".genre-info a," +
    ".genrex a," +
    ".genres a," +
    ".mgen a"
  )
    .each(
      (i,el) => {

        const value =
          text(
            $(el).text()
          );

        if(
          value &&
          !genres.includes(value)
        ){

          genres.push(value);

        }

      }
    );

  const chapterList = [];

  $(
    "#chapterlist li," +
    ".eplister li," +
    ".clstyle li"
  )
    .each(
      (i,el) => {

        const a =
          $(el)
            .find("a")
            .first();

        const href =
          a.attr("href");

        if(!href){
          return;
        }

        const url =
          absoluteUrl(
            href
          );

        const chapterSlug =
          slugFromUrl(
            url
          );

        if(!chapterSlug){
          return;
        }

        const chapter =
          text(
            $(el)
              .find(
                ".chapternum," +
                ".lchx a," +
                ".eph-num a"
              )
              .first()
              .text()
          ) ||
          text(
            a.text()
          );

        const date =
          text(
            $(el)
              .find(
                ".chapterdate," +
                ".eph-date"
              )
              .first()
              .text()
          ) ||
          null;

        chapterList.push({

          title:
            chapter,

          slug:
            chapterSlug,

          url,

          date

        });

      }
    );

  const unique =
    [];

  const seen =
    new Set();

  for(
    const chapter
    of chapterList
  ){

    if(
      seen.has(
        chapter.url
      )
    ){
      continue;
    }

    seen.add(
      chapter.url
    );

    unique.push(
      chapter
    );

  }

  return {

    title,

    slug,

    thumbnail,

    synopsis,

    rating,

    status,

    genres,

    chapterList:
      unique

  };

}


/* =========================================================
   CHAPTER
========================================================= */

async function chapter(
  slug
){

  /*
   * Chapter URL pada source berbentuk:
   *
   * https://komikindo.ch/<chapter-slug>/
   *
   * Tidak melakukan bypass proteksi.
   */

  const html =
    await fetchPage(
      `${BASE_URL}/${encodeURIComponent(slug)}/`
    );

  const $ =
    cheerio.load(
      html
    );

  const title =
    text(
      $(".entry-title")
        .first()
        .text()
    ) ||
    text(
      $(".title-section")
        .first()
        .text()
    ) ||
    text(
      $("h1")
        .first()
        .text()
    );

  const images = [];

  $(
    "#readerarea img," +
    ".reading-content img," +
    ".readingarea img," +
    ".chapter-content img," +
    ".reader-area img"
  )
    .each(
      (i,el) => {

        const img =
          $(el);

        const src =
          img.attr("src") ||
          img.attr("data-src") ||
          img.attr("data-lazy-src") ||
          img.attr("data-original");

        const url =
          cleanUrl(src);

        if(!url){
          return;
        }

        const lower =
          url.toLowerCase();

        if(
          lower.includes("histats") ||
          lower.endsWith(".gif") ||
          lower.includes("avatar")
        ){
          return;
        }

        if(
          !images.includes(url)
        ){

          images.push(
            url
          );

        }

      }
    );

  return {

    title,

    slug,

    totalImages:
      images.length,

    images

  };

}


/* =========================================================
   VERCEL HANDLER
========================================================= */

module.exports =
async function handler(
  req,
  res
){

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if(
    req.method ===
    "OPTIONS"
  ){

    return res.status(204)
      .end();

  }

  const action =
    String(
      req.query.action || ""
    ).toLowerCase();

  try{

    let data;

    switch(action){

      case "home":

        data =
          await home();

        break;


      case "search":{

        const q =
          String(
            req.query.q || ""
          ).trim();

        const page =
          Math.max(
            1,
            Number(
              req.query.page || 1
            )
          );

        if(!q){

          return res.status(400)
            .json({
              status:false,
              message:
                "Parameter q wajib diisi."
            });

        }

        data =
          await search(
            q,
            page
          );

        break;
      }


      case "latest":{

        const page =
          Math.max(
            1,
            Number(
              req.query.page || 1
            )
          );

        data =
          await latest(
            page
          );

        break;
      }


      case "list":{

        const page =
          Math.max(
            1,
            Number(
              req.query.page || 1
            )
          );

        data =
          await listManga(
            page
          );

        break;
      }


      case "detail":{

        const slug =
          String(
            req.query.slug || ""
          ).trim();

        if(!slug){

          return res.status(400)
            .json({
              status:false,
              message:
                "Parameter slug wajib diisi."
            });

        }

        data =
          await detail(
            slug
          );

        break;
      }


      case "chapter":{

        const slug =
          String(
            req.query.slug || ""
          ).trim();

        if(!slug){

          return res.status(400)
            .json({
              status:false,
              message:
                "Parameter slug wajib diisi."
            });

        }

        data =
          await chapter(
            slug
          );

        break;
      }


      default:

        return res.status(400)
          .json({
            status:false,
            message:
              "Action tidak tersedia.",
            available:[
              "home",
              "search",
              "latest",
              "list",
              "detail",
              "chapter"
            ]
          });

    }


    return res.status(200)
      .json({

        status:true,

        source:
          BASE_URL,

        action,

        data

      });


  }catch(error){

    console.error(
      error
    );

    return res.status(
      error.response?.status >= 400
        ? error.response.status
        : 500
    )
      .json({

        status:false,

        message:
          "Gagal mengambil data dari sumber.",

        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : undefined

      });

  }

};