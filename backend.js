// backend.js — production-ready for Heroku (single-instance, safe, low-API usage)
import express from "express";
import dotenv from "dotenv";
import NodeCache from "node-cache";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import fetch, { AbortError } from "node-fetch";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const CACHE_TTL       = +(process.env.CACHE_TTL_SEC   || 6 * 60 * 60);
const FETCH_TIMEOUT = +(process.env.FETCH_TIMEOUT_MS || 4000); // ms per API
const MAX_QUERY_LENGTH = +(process.env.MAX_QUERY_LENGTH || 120);
const MAX_SUBQUERIES = +(process.env.MAX_SUBQUERIES || 10);
const RATE_LIMIT_MAX = +(process.env.RATE_LIMIT_MAX || 20); // per minute per IP

// Allowed origins: comma-separated list e.g. "https://yourdomain.com"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// API keys (optional)
const {
  RAWG_API_KEY,
  GEMINI_API_KEY,
  SERPER_API_KEY,
  TAVILY_API_KEY,
  BOOKS_API_KEY,
} = process.env;

// Simple safe logger
function safeLog(...args) {
  console.log(new Date().toISOString(), ...args);
}

// Utility: normalize key for cache
function normalizeKey(q) {
  return String(q || "")
    .trim()
    .toLowerCase();
}

// Sanitizer
function sanitizeQuery(q) {
  if (!q) return "";
  const cleaned = String(q)
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .trim();
  return cleaned.length > MAX_QUERY_LENGTH
    ? cleaned.slice(0, MAX_QUERY_LENGTH)
    : cleaned;
}

// fetch with timeout wrapper
function fetchWithTimeout(url, opts = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const signal = controller.signal;
  const finalOpts = { ...opts, signal };
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, finalOpts)
    .finally(() => clearTimeout(timer))
    .catch((err) => {
      if (err.name === "AbortError" || err instanceof AbortError) {
        const e = new Error("Fetch timed out");
        e.name = "FetchTimeout";
        throw e;
      }
      throw err;
    });
}

// caches
const cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 120 });

// middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        connectSrc: [
          "'self'",
          "https://*.supabase.co",
          "wss://*.supabase.co",
          "https://api.supabase.com",
          "https://cdn.jsdelivr.net",
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  }),
);
app.use(express.json({ limit: "24kb" }));
app.use(express.urlencoded({ extended: true }));

// CORS configuration
if (ALLOWED_ORIGINS.length) {
  // CORS configuration
  app.use(
    cors({
      origin: (origin, cb) => {
        // allow server-to-server, curl, and same-origin
        if (!origin) return cb(null, true);

        // if ALLOWED_ORIGINS is empty => allow all
        if (!ALLOWED_ORIGINS.length) return cb(null, true);

        // allow known origins
        if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);

        // block silently (DO NOT throw error)
        safeLog("❌ Blocked CORS Origin:", origin);
        return cb(null, false);
      },
    }),
  );
} else {
  // permissive for dev / simple Heroku deploy; strongly recommended to set ALLOWED_ORIGINS in prod
  app.use(cors());
  safeLog(
    "⚠️ ALLOWED_ORIGINS not set — CORS is permissive. Set ALLOWED_ORIGINS in env for production.",
  );
}

// rate limiter (applies to /search only below)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({ error: "Too many requests — slow down." }),
});

app.use(morgan("combined", { skip: (req) => req.path === "/health" }));

// Force HTTPS in production (Heroku sets x-forwarded-proto)
app.use((req, res, next) => {
  if (
    process.env.NODE_ENV === "production" &&
    req.headers["x-forwarded-proto"] !== "https"
  ) {
    return res.redirect(301, `https://${req.hostname}${req.url}`);
  }
  next();
});

// Serve frontend (assumes ../frontend)
app.use(express.static(path.join(__dirname, "frontend"), { index: false }));
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "frontend/index.html")),
);

// -------------------
// Supabase config for frontend (public anon key)
// Rate limited + cached so it isn't hammered on every page load
// -------------------
app.get("/config", limiter, (req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.json({
    supabaseUrl:     process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});
// ─── Query expansion ─────────────────────────────────────────────────────────
function expandQuery(q) {
  const lower = q.toLowerCase().trim();
  const year  = new Date().getFullYear();
  const y     = String(year);

  const fill = (tpl) => tpl.replace(/\{y\}/g, y).replace(/\{q\}/g, q);
  const pick = (arr) => arr.slice(0, MAX_SUBQUERIES).map(fill);

  const isMovie  = /\b(movie|film|cinema|watch)\b/.test(lower);
  const isGame   = /\b(game|gaming|play)\b/.test(lower);
  const isBook   = /\b(book|novel|read|author)\b/.test(lower);
  const isMusic  = /\b(music|song|album|artist|band)\b/.test(lower);
  const isTech   = /\b(programming|software|framework|library|tool|tech)\b/.test(lower);
  const isSport  = /\b(sport|football|soccer|nba|nfl|player|athlete)\b/.test(lower);
  const isFood   = /\b(food|recipe|restaurant|dish|cuisine|cook)\b/.test(lower);
  const isAnime  = /\b(anime|manga|series)\b/.test(lower);

  if (isMovie) return pick([
    "Top 10 best movies of all time",
    `Top 10 movies of {y}`,
    "Top 10 highest rated films IMDb",
    "Top 10 Oscar winning movies",
    "Top 10 most popular movies right now",
    "Top 10 classic Hollywood films",
  ]);
  if (isAnime) return pick([
    "Top 10 best anime series of all time",
    `Top 10 anime {y}`,
    "Top 10 most popular anime MyAnimeList",
    "Top 10 action anime",
    "Top 10 romance anime",
    "Top 10 shonen anime",
  ]);
  if (isGame) return pick([
    "Top 10 best video games of all time",
    `Top 10 games of {y}`,
    "Top 10 highest rated games Metacritic",
    "Top 10 open world games",
    "Top 10 RPG games",
    "Top 10 multiplayer games",
  ]);
  if (isBook) return pick([
    "Top 10 best books of all time",
    `Top 10 books of {y}`,
    "Top 10 most read books in the world",
    "Top 10 fiction books",
    "Top 10 non-fiction books",
    "Top 10 classic literature books",
  ]);
  if (isMusic) return pick([
    "Top 10 best songs of all time",
    `Top 10 albums of {y}`,
    "Top 10 best artists ever",
    "Top 10 most streamed songs Spotify",
    "Top 10 classic rock songs",
    "Top 10 hip hop albums",
  ]);
  if (isTech) return pick([
    `Top 10 {q}`,
    `Top 10 best {q} tools`,
    `Top 10 most popular {q} in {y}`,
    `Top 10 {q} frameworks`,
    `Top 10 free {q} resources`,
    `Top 10 {q} for beginners`,
  ]);
  if (isSport) return pick([
    `Top 10 best {q} players of all time`,
    `Top 10 {q} moments`,
    `Top 10 highest paid {q} players`,
    `Top 10 greatest {q} teams`,
    `Top 10 {q} records`,
    `Top 10 {q} players {y}`,
  ]);
  if (isFood) return pick([
    `Top 10 best {q}`,
    `Top 10 most popular {q} in the world`,
    `Top 10 {q} recipes`,
    `Top 10 {q} restaurants`,
    `Top 10 healthiest {q}`,
    `Top 10 {q} dishes`,
  ]);

  return pick([
    `Top 10 {q}`,
    `Top 10 best {q} of all time`,
    `Top 10 most popular {q}`,
    `Top 10 {q} in {y}`,
    `Top 10 recommended {q}`,
    `Top 10 {q} ranked`,
  ]);
}

// ─── API Fetchers ─────────────────────────────────────────────────────────────

async function fetchFromGemini(query) {
  if (!GEMINI_API_KEY) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const prompt = [
      `Give me a list of exactly 10 items for: "${query}"`,
      "Rules:",
      "- Return ONLY the numbered list, nothing else",
      "- Format: 1. Item name",
      "- No markdown, no bold, no explanations, no parentheses",
      "- Each item on its own line",
    ].join("\n");

    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
      }),
    }, FETCH_TIMEOUT + 2000);

    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    const items = text
      .split(/\r?\n/)
      .map(l => l
        .replace(/^\s*\d+[\.\)]\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/\s*\(.*?\)\s*/g, "")
        .trim()
      )
      .filter(l => l.length > 1 && l.length < 120)
      .slice(0, 10)
      .map(name => ({ name }));

    if (items.length >= 3) return { title: query, items, source: "Gemini" };
  } catch (err) {
    safeLog("Gemini error:", err.message);
  }
  return null;
}

async function fetchFromSerper(query) {
  if (!SERPER_API_KEY) return null;
  try {
    const res = await fetchWithTimeout("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: `${query} list`, num: 10 }),
    });
    if (!res.ok) throw new Error(`Serper ${res.status}`);
    const data = await res.json();

    const answerItems = data?.answerBox?.list || [];
    if (answerItems.length >= 3) {
      return { title: query, items: answerItems.slice(0, 10).map(name => ({ name })), source: "Serper" };
    }

    const items = (data?.organic || [])
      .slice(0, 10)
      .map(r => ({ name: r.title, link: r.link }))
      .filter(r => r.name);

    if (items.length >= 3) return { title: query, items, source: "Serper" };
  } catch (err) {
    safeLog("Serper error:", err.message);
  }
  return null;
}

async function fetchFromTavily(query) {
  if (!TAVILY_API_KEY) return null;
  try {
    const res = await fetchWithTimeout("https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${TAVILY_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, max_results: 10, search_depth: "basic", include_answer: true }),
    });
    if (!res.ok) throw new Error(`Tavily ${res.status}`);
    const data = await res.json();

    if (data?.answer) {
      const parsed = data.answer
        .split(/\r?\n/)
        .map(l => l.replace(/^\s*[\d\.\-\*]+\s*/, "").trim())
        .filter(l => l.length > 1 && l.length < 120)
        .slice(0, 10)
        .map(name => ({ name }));
      if (parsed.length >= 3) return { title: query, items: parsed, source: "Tavily" };
    }

    const items = (data?.results || [])
      .slice(0, 10)
      .map(r => ({ name: r.title || r.url, link: r.url }))
      .filter(r => r.name);

    if (items.length >= 3) return { title: query, items, source: "Tavily" };
  } catch (err) {
    safeLog("Tavily error:", err.message);
  }
  return null;
}

async function fetchFromRAWG(query) {
  if (!RAWG_API_KEY) return null;
  try {
    const term = query.replace(/top\s*\d+\s*/i, "").trim();
    const url = `https://api.rawg.io/api/games?key=${RAWG_API_KEY}&search=${encodeURIComponent(term)}&page_size=10&ordering=-rating`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`RAWG ${res.status}`);
    const data = await res.json();
    const items = (data.results || []).slice(0, 10).map(g => ({ name: g.name, link: `https://rawg.io/games/${g.slug}` }));
    if (items.length >= 3) return { title: query, items, source: "RAWG" };
  } catch (err) {
    safeLog("RAWG error:", err.message);
  }
  return null;
}

async function fetchFromGoogleBooks(query) {
  if (!BOOKS_API_KEY) return null;
  try {
    const term = query.replace(/top\s*\d+\s*/i, "").trim();
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(term)}&maxResults=10&orderBy=relevance&key=${BOOKS_API_KEY}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`GoogleBooks ${res.status}`);
    const data = await res.json();
    const items = (data.items || []).slice(0, 10).map(b => ({
      name: b.volumeInfo?.title || "Untitled",
      link: b.volumeInfo?.infoLink || null,
    }));
    if (items.length >= 3) return { title: query, items, source: "Google Books" };
  } catch (err) {
    safeLog("Google Books error:", err.message);
  }
  return null;
}

async function fetchFromWikipedia(query) {
  try {
    const term = query.replace(/top\s*\d+\s*/i, "").trim();
    const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(term)}&limit=10&format=json&origin=*`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
    const data = await res.json();
    const names = data[1] || [];
    const links = data[3] || [];
    const items = names.map((name, i) => ({ name, link: links[i] || null }));
    if (items.length >= 3) return { title: query, items, source: "Wikipedia" };
  } catch (err) {
    safeLog("Wikipedia error:", err.message);
  }
  return null;
}

// ─── Per-subquery chain ───────────────────────────────────────────────────────
function getChain(q) {
  const lower = q.toLowerCase();
  if (/\b(book|novel|author|read)\b/.test(lower))
    return [fetchFromGoogleBooks, fetchFromGemini, fetchFromSerper, fetchFromTavily, fetchFromWikipedia];
  if (/\b(game|gaming)\b/.test(lower))
    return [fetchFromRAWG, fetchFromGemini, fetchFromSerper, fetchFromTavily, fetchFromWikipedia];
  return [fetchFromGemini, fetchFromSerper, fetchFromTavily, fetchFromWikipedia];
}

async function fetchBestResult(subquery) {
  for (const fn of getChain(subquery)) {
    try {
      const result = await fn(subquery);
      if (result) {
        safeLog(`  ✓ ${fn.name} → "${subquery}"`);
        return result;
      }
    } catch (err) {
      safeLog(`  ✗ ${fn.name} failed: ${err.message}`);
    }
  }
  return null;
}

// ─── /search ─────────────────────────────────────────────────────────────────
app.get("/search", limiter, async (req, res) => {
  try {
    const rawQ = req.query.q;
    if (!rawQ) return res.status(400).json({ error: "Missing query param 'q'" });

    const q = sanitizeQuery(rawQ);
    if (!q) return res.status(400).json({ error: "Invalid or empty query" });

    const cacheKey = q.toLowerCase().trim();
    const cached = cache.get(cacheKey);
    if (cached) {
      safeLog(`Cache HIT "${cacheKey}"`);
      return res.json(cached);
    }

    safeLog(`Search: "${q}" from ${req.ip}`);

    const subqueries = expandQuery(q);
    safeLog(`Subqueries (${subqueries.length}):`, subqueries);

    // Run all subqueries in parallel — much faster than sequential
    const settled = await Promise.allSettled(
      subqueries.map(sq => fetchBestResult(sq))
    );

    const items = settled
      .map((r, i) => {
        if (r.status === "fulfilled" && r.value) return r.value;
        safeLog(`  ↳ No result for subquery "${subqueries[i]}" — skipping`);
        return null;
      })
      .filter(Boolean);

    if (!items.length) {
      return res.status(502).json({
        error: "No results found. All data sources failed or returned nothing.",
        query: q,
      });
    }

    const response = {
      query: q,
      timestamp: Date.now(),
      items,
      source: "listroh-backend",
    };

    cache.set(cacheKey, response);
    safeLog(`Returning ${items.length} sections for "${q}"`);
    return res.json(response);

  } catch (err) {
    safeLog("Search error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// health
app.get("/health", (req, res) =>
  res.json({
    status: "ok",
    uptime: process.uptime(),
    cacheKeys: cache.keys().length,
  }),
);

// graceful shutdown
let server;
function shutdown(sig) {
  safeLog(`Received ${sig}, shutting down`);
  if (server)
    server.close(() => {
      safeLog("Server closed");
      process.exit(0);
    });
  setTimeout(() => {
    safeLog("Force exit");
    process.exit(1);
  }, 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server = app.listen(PORT, () =>
  safeLog(`✅ List'em backend listening on ${PORT}`),
);