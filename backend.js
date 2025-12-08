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
const CACHE_TTL = +(process.env.CACHE_TTL_SEC || 6 * 60 * 60); // seconds
const WINNER_TTL = +(process.env.WINNER_TTL_SEC || 24 * 60 * 60);
const FETCH_TIMEOUT = +(process.env.FETCH_TIMEOUT_MS || 4000); // ms per API
const MAX_QUERY_LENGTH = +(process.env.MAX_QUERY_LENGTH || 120);
const MAX_SUBQUERIES = +(process.env.MAX_SUBQUERIES || 10);
const RATE_LIMIT_MAX = +(process.env.RATE_LIMIT_MAX || 20); // per minute per IP

// Allowed origins: comma-separated list e.g. "https://yourdomain.com"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);

// API keys (optional)
const { RAWG_API_KEY, GEMINI_API_KEY, SERPER_API_KEY, TAVILY_API_KEY, BOOKS_API_KEY } = process.env;

// Simple safe logger
function safeLog(...args) {
  console.log(new Date().toISOString(), ...args);
}

// Utility: normalize key for cache
function normalizeKey(q) {
  return String(q || "").trim().toLowerCase();
}

// Sanitizer
function sanitizeQuery(q) {
  if (!q) return "";
  const cleaned = String(q).replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
  return cleaned.length > MAX_QUERY_LENGTH ? cleaned.slice(0, MAX_QUERY_LENGTH) : cleaned;
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
const winnerCache = new NodeCache({ stdTTL: WINNER_TTL, checkperiod: 300 });

// middleware
app.use(helmet());
app.use(express.json({ limit: "24kb" }));
app.use(express.urlencoded({ extended: true }));

// CORS configuration
if (ALLOWED_ORIGINS.length) {
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("CORS not allowed"), false);
    }
  }));
} else {
  // permissive for dev / simple Heroku deploy; strongly recommended to set ALLOWED_ORIGINS in prod
  app.use(cors());
  safeLog("⚠️ ALLOWED_ORIGINS not set — CORS is permissive. Set ALLOWED_ORIGINS in env for production.");
}

// rate limiter (applies to /search only below)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: "Too many requests — slow down." }),
});

app.use(morgan("combined", { skip: (req) => req.path === "/health" }));

// Serve frontend (assumes ../frontend)
app.use(express.static(path.join(__dirname, "frontend"), { index: false }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "frontend/index.html")));

/* -------------------
   Helpers: expandQuery (limited)
   ------------------- */
function expandQuery(q) {
  const lower = q.toLowerCase();
  const year = new Date().getFullYear();
  const make = (arr) => arr.map(x => x.replace(/\{year\}/g, year));
  let candidates = [];

  if (lower.includes("movie")) {
    candidates = make([
      "Top 10 movies of all time",
      "Top 10 movies in {year}",
      "Top 10 trending movies right now",
      "Top 10 classic movies",
      "Top 10 highest rated movies",
      "Top 10 upcoming movies",
      "Top 10 underrated movies",
      "Top 10 most watched movies",
      "Top 10 iconic movies",
      "Top 10 recommended movies"
    ]);
  } else if (lower.includes("game")) {
    candidates = make([
      "Top 10 games of all time",
      "Top 10 games in {year}",
      "Top 10 RPG games",
      "Top 10 multiplayer games",
      "Top 10 PC games",
      "Top 10 console games",
      "Top 10 indie games",
      "Top 10 trending games",
      "Top 10 mobile games",
      "Top 10 most downloaded games"
    ]);
  } else if (lower.includes("book")) {
    candidates = make([
      "Top 10 books of all time",
      "Top 10 books in {year}",
      "Top 10 fiction books",
      "Top 10 non-fiction books",
      "Top 10 classic literature books",
      "Top 10 mystery books",
      "Top 10 sci-fi books",
      "Top 10 historical books",
      "Top 10 self-help books",
      "Top 10 popular books"
    ]);
  } else {
    candidates = make([
      `Top 10 ${q}`,
      `Top 10 trending ${q}`,
      `Top 10 best ${q}`,
      `Top 10 ${q} in {year}`,
      `Top 10 popular ${q}`,
      `Top 10 new ${q}`,
      `Top 10 recommended ${q}`,
      `Top 10 ${q} right now`,
      `Top 10 ${q} you should know`,
      `Top 10 ${q} ever made`,
    ]);
  }

  return candidates.slice(0, MAX_SUBQUERIES);
}

function generateFallbackList(q) {
  const base = q.replace(/top\s*\d+/i, "").trim();
  return {
    title: `Fallback results for "${q}"`,
    items: Array.from({ length: 10 }, (_, i) => ({ name: `${base} suggestion ${i + 1}`, link: null })),
    source: "Local Fallback"
  };
}

/* -------------------
   API fetchers (use fetchWithTimeout)
   return {title, items, source} or null
   ------------------- */

async function fetchFromRAWG(query) {
  if (!RAWG_API_KEY) return null;
  try {
    const url = `https://api.rawg.io/api/games?key=${RAWG_API_KEY}&search=${encodeURIComponent(query)}&page_size=10`;
    const res = await fetchWithTimeout(url, { method: "GET" }, FETCH_TIMEOUT);
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
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10&key=${BOOKS_API_KEY}`;
    const res = await fetchWithTimeout(url, { method: "GET" }, FETCH_TIMEOUT);
    if (!res.ok) throw new Error(`GoogleBooks ${res.status}`);
    const data = await res.json();
    const items = (data.items || []).slice(0, 10).map(b => ({ name: b.volumeInfo?.title || "Untitled", link: b.volumeInfo?.infoLink || null }));
    if (items.length) return { title: `Top books for "${query}"`, items, source: "Google Books" };
  } catch (err) {
    safeLog("Google Books error:", err.message);
  }
  return null;
}

async function fetchFromGemini(query) {
  if (!GEMINI_API_KEY) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const body = { contents: [ { role: "user", parts: [{ text: `List 10 ${query}. Only numbered list.` }] } ] };
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }, FETCH_TIMEOUT + 1000);
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const items = text.split(/\r?\n|•|-/).map(l => l.replace(/^\s*[\d\)\.\-]+/, "").trim()).filter(Boolean).slice(0, 10).map(name => ({ name }));
    if (items.length) return { title: `Gemini: ${query}`, items, source: "Gemini" };
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
      body: JSON.stringify({ q: query })
    }, FETCH_TIMEOUT);
    if (!res.ok) throw new Error(`Serper ${res.status}`);
    const data = await res.json();
    const items = (data?.organic || []).slice(0, 10).map(r => ({ name: r.title, link: r.link }));
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
      body: JSON.stringify({ query, max_results: 10 })
    }, FETCH_TIMEOUT);
    if (!res.ok) throw new Error(`Tavily ${res.status}`);
    const data = await res.json();
    const items = (data?.results || []).slice(0, 10).map(r => ({ name: r.title || r.url, link: r.url }));
    if (items.length >= 3) return { title: query, items, source: "Tavily" };
  } catch (err) {
    safeLog("Tavily error:", err.message);
  }
  return null;
}

async function fetchFromJina(query) {
  try {
    const url = `https://r.jina.ai/https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(url, { method: "GET" }, FETCH_TIMEOUT);
    if (!res.ok) throw new Error(`Jina ${res.status}`);
    const text = await res.text();
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 10).map(name => ({ name }));
    if (lines.length) return { title: `Jina: ${query}`, items: lines, source: "Jina AI" };
  } catch (err) {
    safeLog("Jina error:", err.message);
  }
  return null;
}

async function fetchFromWikipedia(query) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=10&format=json&origin=*`;
    const res = await fetchWithTimeout(url, { method: "GET" }, FETCH_TIMEOUT);
    if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
    const data = await res.json();
    const items = (data[1] || []).map((name, i) => ({ name, link: data[3]?.[i] || null }));
    if (items.length) return { title: `Wikipedia: ${query}`, items, source: "Wikipedia" };
  } catch (err) {
    safeLog("Wikipedia error:", err.message);
  }
  return null;
}

/* -------------------
   Smart search (per-request)
   - per-request "winner" and disabled set
   - tries persisted winner (if present) but per-request only
   ------------------- */
async function smartSearchForSubquery(subquery, perRequestState, preferPersistentWinner = true) {
  const lower = subquery.toLowerCase();
  const chain = lower.includes("book")
    ? [fetchFromGoogleBooks, fetchFromGemini, fetchFromSerper, fetchFromTavily, fetchFromWikipedia, fetchFromJina]
    : lower.includes("game")
    ? [fetchFromRAWG, fetchFromGemini, fetchFromSerper, fetchFromTavily, fetchFromWikipedia, fetchFromJina]
    : [fetchFromGemini, fetchFromSerper, fetchFromTavily, fetchFromWikipedia, fetchFromJina];

  const tried = new Set();

  // 1) per-request winner
  if (perRequestState.winner) {
    const fn = perRequestState.winner;
    try {
      const res = await fn(subquery);
      if (res) return { result: res, winnerFn: fn };
    } catch (err) {
      safeLog(`Per-request winner failed: ${err.message}`);
      perRequestState.disabled.add(fn.name);
      tried.add(fn.name);
      perRequestState.winner = null;
    }
  }

  // 2) persisted winner (from winnerCache)
  if (preferPersistentWinner && perRequestState.mainQueryKey) {
    const key = `winner:${perRequestState.mainQueryKey}`;
    const persisted = winnerCache.get(key);
    if (persisted) {
      const mapping = { fetchFromRAWG, fetchFromGoogleBooks, fetchFromGemini, fetchFromSerper, fetchFromTavily, fetchFromJina, fetchFromWikipedia };
      const fn = mapping[persisted];
      if (fn && !perRequestState.disabled.has(fn.name) && !tried.has(fn.name)) {
        try {
          const res = await fn(subquery);
          if (res) {
            perRequestState.winner = fn;
            return { result: res, winnerFn: fn };
          }
        } catch (err) {
          safeLog(`Persisted winner ${persisted} failed: ${err.message}`);
          perRequestState.disabled.add(fn.name);
          tried.add(fn.name);
        }
      }
    }
  }

  // 3) iterate chain
  for (const fn of chain) {
    if (perRequestState.disabled.has(fn.name) || tried.has(fn.name)) continue;
    try {
      const res = await fn(subquery);
      if (res) {
        perRequestState.winner = fn;
        return { result: res, winnerFn: fn };
      } else {
        perRequestState.disabled.add(fn.name);
      }
    } catch (err) {
      safeLog(`${fn.name} error: ${err.message}`);
      perRequestState.disabled.add(fn.name);
    }
  }

  return { result: null, winnerFn: null };
}

/* -------------------
   /search route
   ------------------- */
app.get("/search", limiter, async (req, res) => {
  try {
    const rawQ = req.query.q;
    if (!rawQ) return res.status(400).json({ error: "Missing query param 'q'" });

    const q = sanitizeQuery(rawQ);
    if (!q) return res.status(400).json({ error: "Invalid or empty query" });

    const normalized = normalizeKey(q);
    const cached = cache.get(normalized);
    if (cached) {
      safeLog(`Cache HIT for "${normalized}"`);
      return res.json(cached);
    }

    safeLog(`Search "${q}" from ${req.ip}`);

    const subqueries = expandQuery(q);
    safeLog(`Expanded ${subqueries.length} subqueries`);

    const perRequestState = { winner: null, disabled: new Set(), mainQueryKey: normalized };

    // if persisted winner present, seed perRequestState.winner
    const persistedWinner = winnerCache.get(`winner:${normalized}`);
    if (persistedWinner) {
      const map = { fetchFromRAWG, fetchFromGoogleBooks, fetchFromGemini, fetchFromSerper, fetchFromTavily, fetchFromJina, fetchFromWikipedia };
      perRequestState.winner = map[persistedWinner] || null;
      if (perRequestState.winner) safeLog(`Seeded per-request winner: ${persistedWinner}`);
    }

    const results = [];

    for (const sq of subqueries) {
      safeLog(`Subquery "${sq}"`);
      const { result, winnerFn } = await smartSearchForSubquery(sq, perRequestState, true);
      if (result) {
        results.push(result);
        if (winnerFn && !winnerCache.get(`winner:${normalized}`)) {
          try {
            winnerCache.set(`winner:${normalized}`, winnerFn.name);
            safeLog(`Persisted winner ${winnerFn.name} for "${normalized}"`);
          } catch (err) {
            safeLog("Could not persist winner:", err.message);
          }
        }
      } else {
        results.push(generateFallbackList(sq));
      }
    }

    const response = { query: q, normalizedQuery: normalized, timestamp: Date.now(), items: results, source: "listem-backend" };
    cache.set(normalized, response);
    return res.json(response);

  } catch (err) {
    safeLog("Search error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// health
app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime(), cacheKeys: cache.keys().length }));

// graceful shutdown
let server;
function shutdown(sig) {
  safeLog(`Received ${sig}, shutting down`);
  if (server) server.close(() => { safeLog("Server closed"); process.exit(0); });
  setTimeout(() => { safeLog("Force exit"); process.exit(1); }, 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server = app.listen(PORT, () => safeLog(`✅ List'em backend listening on ${PORT}`));


