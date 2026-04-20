// results.js
import { getSupabase } from "./supabase.js";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ---------- DOM ----------
const urlParams       = new URLSearchParams(window.location.search);
const query           = urlParams.get("q");
const titlesContainer = document.getElementById("titlesContainer");
const contentContainer= document.getElementById("contentContainer");
const searchInput     = document.getElementById("searchInput");
const searchBtn       = document.getElementById("searchBtn");
const themeBtn        = document.getElementById("themeToggle");
const clearCacheBtn   = document.getElementById("clearCacheBtn");
const menuToggle      = document.getElementById("menuToggle");
const leftPanel       = document.querySelector(".left-panel");
const backdrop        = document.getElementById("backdrop");
const backBtn         = document.getElementById("backDashboardBtn");

// ---------- Header height (fixes mobile hamburger position) ----------
function updateHeaderHeight() {
  const header = document.querySelector(".site-header");
  if (header) {
    document.documentElement.style.setProperty(
      "--header-height",
      header.offsetHeight + "px"
    );
  }
}
updateHeaderHeight();
window.addEventListener("resize", updateHeaderHeight);

// ---------- Auth — show Dashboard button if logged in ----------
const supabase = await getSupabase();

(async () => {
  const { data } = await supabase.auth.getSession();
  if (data?.session) {
    backBtn.style.display = "inline-block";
    backBtn.onclick = () => { window.location.href = "dashboard.html"; };
  }
})();

// ---------- Mobile drawer ----------
menuToggle.addEventListener("click", () => {
  const isOpen = leftPanel.classList.toggle("open");
  menuToggle.classList.toggle("shifted", isOpen);
  backdrop.classList.toggle("visible", isOpen);
});

backdrop.addEventListener("click", closeDrawer);
titlesContainer.addEventListener("click", closeDrawer);

function closeDrawer() {
  leftPanel.classList.remove("open");
  menuToggle.classList.remove("shifted");
  backdrop.classList.remove("visible");
}

// ---------- Theme ----------
const root = document.documentElement;
const storedTheme = localStorage.getItem("listem_theme") || "dark";
root.setAttribute("data-theme", storedTheme);

function syncTheme() {
  themeBtn.textContent = root.getAttribute("data-theme") === "dark" ? "☀️" : "🌑";
}
syncTheme();

themeBtn.addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  localStorage.setItem("listem_theme", next);
  syncTheme();
});

// ---------- Logo click ----------
document.getElementById("logoTitle")?.addEventListener("click", () => {
  window.location.href = "index.html";
});

// ---------- Clear cache ----------
clearCacheBtn?.addEventListener("click", () => {
  Object.keys(localStorage)
    .filter(k => k.startsWith("searchCache:"))
    .forEach(k => localStorage.removeItem(k));
  clearCacheBtn.textContent = "✓ Cleared";
  setTimeout(() => { clearCacheBtn.textContent = "🗑️ Clear Cache"; }, 1500);
});

// ---------- Search bar ----------
searchInput.value = query || "";

function triggerSearch() {
  const q = searchInput.value.trim();
  if (!q) return;
  window.location.href = `results.html?q=${encodeURIComponent(q)}`;
}
searchBtn.addEventListener("click", triggerSearch);
searchInput.addEventListener("keydown", e => {
  if (e.key === "Enter") triggerSearch();
});

// ---------- Client-side cache ----------
function getCached(q) {
  try {
    const raw = localStorage.getItem(`searchCache:${q}`);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(`searchCache:${q}`);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function setCache(q, data) {
  try {
    localStorage.setItem(`searchCache:${q}`, JSON.stringify({ timestamp: Date.now(), data }));
  } catch {
    // localStorage full — silently skip caching
  }
}

// ---------- Safe text helper (prevents XSS from API item names) ----------
function safeText(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

// ---------- Fetch ----------
async function fetchAndRender(q) {
  titlesContainer.innerHTML = `<p class="placeholder fade-in">Loading…</p>`;
  contentContainer.innerHTML = `<p class="placeholder fade-in">Fetching results…</p>`;

  const cached = getCached(q);
  if (cached) {
    renderResults(cached);
    return;
  }

  try {
    const res = await fetch(`/search?q=${encodeURIComponent(q)}`);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();

    if (!data?.items?.length) {
      titlesContainer.innerHTML = "";
      contentContainer.innerHTML = `
        <div style="text-align:center;padding:60px 20px;">
          <p style="font-size:2rem;">🔍</p>
          <p class="placeholder">No results found for "<strong>${safeText(q)}</strong>".</p>
          <p class="placeholder" style="font-size:0.88rem;">Try a different search term.</p>
        </div>`;
      return;
    }

    setCache(q, data);
    renderResults(data);

  } catch (err) {
    console.error("Search failed:", err);
    titlesContainer.innerHTML = "";
    contentContainer.innerHTML = `
      <div style="text-align:center;padding:60px 20px;">
        <p style="font-size:2rem;">⚠️</p>
        <p class="placeholder">${safeText(err.message)}</p>
        <button onclick="fetchAndRender(${JSON.stringify(q)})"
          style="margin-top:12px;padding:10px 20px;border-radius:10px;border:none;
                 background:var(--accent-2);color:#fff;cursor:pointer;font-weight:700;">
          Retry
        </button>
      </div>`;
  }
}

// ---------- Render ----------
function renderResults(data) {
  titlesContainer.innerHTML = "";
  contentContainer.innerHTML = "";

  const sections = (data.items || []).map(section => ({
    title:  section.title  || "Untitled",
    source: section.source || "Unknown",
    items:  section.items  || [],
  }));

  if (!sections.length) {
    contentContainer.innerHTML = `<p class="placeholder">No results to display.</p>`;
    return;
  }

  sections.forEach((section, index) => {
    // ── Left panel title card ──
    const card = document.createElement("div");
    card.className = "title-card";

    const t   = document.createElement("div");
    t.className = "t";
    t.textContent = section.title;

    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = section.source;

    card.append(t, sub);
    titlesContainer.appendChild(card);

    // ── Click → render items in right panel ──
    card.addEventListener("click", () => {
      document.querySelectorAll(".title-card").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      renderSection(section);
      if (window.innerWidth <= 768) closeDrawer();
    });

    // Auto-click first result
    if (index === 0) card.click();
  });
}

function renderSection(section) {
  // Build list panel
  const panel = document.createElement("div");
  panel.className = "list-panel fade-in";

  const titleEl = document.createElement("h3");
  titleEl.className = "list-title";
  titleEl.textContent = section.title;
  panel.appendChild(titleEl);

  const ul = document.createElement("ul");
  ul.className = "items";

  section.items.forEach((item, i) => {
    const li = document.createElement("li");

    // Rank badge
    const rank = document.createElement("div");
    rank.className = "rank";
    rank.textContent = i + 1;

    // Text block
    const txt = document.createElement("div");
    txt.className = "txt";

    const name = document.createElement("div");
    name.className = "result-name";
    name.textContent = item.name || item.title || "Untitled"; // textContent = safe

    txt.appendChild(name);

    if (item.link) {
      const a = document.createElement("a");
      a.href   = item.link;
      a.target = "_blank";
      a.rel    = "noopener noreferrer";
      a.className = "result-link";
      a.textContent = "🔗 View Source";
      txt.appendChild(a);
    }

    li.append(rank, txt);
    ul.appendChild(li);
  });

  panel.appendChild(ul);

  // Source attribution
  const sourceNote = document.createElement("p");
  sourceNote.className = "source-note";
  sourceNote.textContent = `Source: ${section.source}`;
  panel.appendChild(sourceNote);

  contentContainer.innerHTML = "";
  contentContainer.appendChild(panel);
}

// ---------- Boot ----------
if (query) {
  fetchAndRender(query);
} else {
  contentContainer.innerHTML = `
    <div style="text-align:center;padding:80px 20px;">
      <p style="font-size:2rem;">🔍</p>
      <p class="placeholder">Type something in the search box above to begin.</p>
    </div>`;
}