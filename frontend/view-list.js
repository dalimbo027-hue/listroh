// view-list.js
// Displays a single TOP10 list using the same left/right panel layout as results.html.
// Visibility rules:
//   PUBLISHED  → anyone can view
//   PENDING / PRIVATE → owner only (requires auth)

import { getSupabase } from "./supabase.js";

const supabase = await getSupabase();

// ─── DOM ─────────────────────────────────────────────────────────────────────
const leftContainer  = document.getElementById("leftContainer");
const rightContainer = document.getElementById("rightContainer");
const searchInput    = document.getElementById("searchInput");
const searchBtn      = document.getElementById("searchBtn");
const themeBtn       = document.getElementById("themeToggle");
const menuToggle     = document.getElementById("menuToggle");
const leftPanel      = document.querySelector(".left-panel");
const backdrop       = document.getElementById("backdrop");
const backBtn        = document.getElementById("backDashboardBtn");

const id = new URLSearchParams(window.location.search).get("id");

// ─── Header height (mobile hamburger fix) ────────────────────────────────────
function updateHeaderHeight() {
  const h = document.querySelector(".site-header");
  if (h) document.documentElement.style.setProperty("--header-height", h.offsetHeight + "px");
}
updateHeaderHeight();
window.addEventListener("resize", updateHeaderHeight);

// ─── Theme ────────────────────────────────────────────────────────────────────
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

// ─── Auth — show Dashboard button if logged in ───────────────────────────────
const { data: sessionData } = await supabase.auth.getSession();
const session = sessionData?.session ?? null;

if (session) {
  backBtn.style.display = "inline-block";
  backBtn.onclick = () => { window.location.href = "dashboard.html"; };
}

// ─── Search bar ──────────────────────────────────────────────────────────────
searchBtn.addEventListener("click", doSearch);
searchInput.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

function doSearch() {
  const q = searchInput.value.trim();
  if (q) window.location.href = `results.html?q=${encodeURIComponent(q)}`;
}

// ─── Mobile drawer ────────────────────────────────────────────────────────────
menuToggle.addEventListener("click", () => {
  const open = leftPanel.classList.toggle("open");
  menuToggle.classList.toggle("shifted", open);
  backdrop.classList.toggle("visible", open);
});

backdrop.addEventListener("click", closeDrawer);

function closeDrawer() {
  leftPanel.classList.remove("open");
  menuToggle.classList.remove("shifted");
  backdrop.classList.remove("visible");
}

// ─── Error / empty states ────────────────────────────────────────────────────
function showError(icon, title, message) {
  leftContainer.innerHTML = "";
  rightContainer.innerHTML = `
    <div style="text-align:center;padding:80px 20px;">
      <p style="font-size:3rem;margin:0 0 12px;">${icon}</p>
      <h2 style="margin:0 0 8px;color:var(--text);">${title}</h2>
      <p style="color:var(--muted);margin:0 0 20px;">${message}</p>
      <a href="index.html"
        style="display:inline-block;padding:10px 24px;border-radius:12px;
               background:var(--accent-2);color:#fff;text-decoration:none;font-weight:700;">
        ← Back to home
      </a>
    </div>
  `;
}

// ─── Load & render ────────────────────────────────────────────────────────────
async function loadList() {
  if (!id) {
    showError("🔍", "No list specified", "The URL is missing a list ID.");
    return;
  }

  // Fetch list — no embedded join, safe across all Supabase FK configs
  const { data: list, error: listErr } = await supabase
    .from("lists")
    .select("id, title, description, owner_id, visibility, created_at")
    .eq("id", id)
    .single();

  if (listErr || !list) {
    showError("🔍", "List not found", "This list doesn't exist or has been removed.");
    return;
  }

  // Fetch owner username separately
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", list.owner_id)
    .single();

  // ── Visibility gate ──
  if (list.visibility !== "PUBLISHED") {
    if (!session) {
      showError("🔒", "Private list", "You need to be logged in to view this list.");
      return;
    }
    if (session.user.id !== list.owner_id) {
      showError("🚫", "Access denied", "This list is private and belongs to another user.");
      return;
    }
  }

  // Fetch items
  const { data: items, error: itemsErr } = await supabase
    .from("list_items")
    .select("rank, content")
    .eq("list_id", id)
    .order("rank", { ascending: true });

  if (itemsErr) {
    showError("⚠️", "Failed to load items", itemsErr.message);
    return;
  }

  document.title = `${list.title} — Listroh`;

  // Attach username to list object for renderList
  list._username = profile?.username || "Anonymous";
  renderList(list, items || []);
}

function renderList(list, items) {
  const owner = list._username;
  const date  = new Date(list.created_at).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });

  const visibilityColor = {
    PUBLISHED: "#00ffb4",
    PENDING:   "#ffd250",
    PRIVATE:   "#9aa0a6",
  }[list.visibility] || "var(--muted)";

  const visibilityLabel = {
    PUBLISHED: "✅ Published",
    PENDING:   "⏳ Pending review",
    PRIVATE:   "🔒 Private",
  }[list.visibility] || list.visibility;

  // ── LEFT PANEL — metadata card + item index ──────────────────────────────
  leftContainer.innerHTML = "";

  // Metadata card
  const meta = document.createElement("div");
  meta.className = "title-card active";
  meta.style.cssText = "cursor:default;margin-bottom:16px;";
  meta.innerHTML = `
    <div class="t" style="font-size:1rem;line-height:1.4;">${escHtml(list.title)}</div>
    ${list.description
      ? `<div class="sub" style="margin-top:6px;font-size:0.82rem;">${escHtml(list.description)}</div>`
      : ""}
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;">
      <span style="font-size:0.75rem;font-weight:700;color:${visibilityColor};">${visibilityLabel}</span>
      <span style="font-size:0.75rem;color:var(--muted);">by ${escHtml(owner)}</span>
      <span style="font-size:0.75rem;color:var(--muted);">${date}</span>
    </div>
  `;
  leftContainer.appendChild(meta);

  // Item index — clicking scrolls right panel to that item
  const indexLabel = document.createElement("p");
  indexLabel.style.cssText = "font-size:0.78rem;color:var(--muted);margin:0 0 8px 4px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;";
  indexLabel.textContent = "Items";
  leftContainer.appendChild(indexLabel);

  items.forEach(item => {
    const indexCard = document.createElement("div");
    indexCard.className = "title-card";
    indexCard.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 12px;";
    indexCard.dataset.rank = item.rank;

    const rankBadge = document.createElement("div");
    rankBadge.style.cssText = `
      min-width:28px;height:28px;border-radius:7px;
      background:var(--accent-2);display:grid;place-items:center;
      font-weight:800;color:#fff;font-size:0.8rem;flex-shrink:0;
    `;
    rankBadge.textContent = item.rank;

    const nameEl = document.createElement("span");
    nameEl.style.cssText = "font-size:0.88rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    nameEl.textContent = item.content;

    indexCard.append(rankBadge, nameEl);

    // Click → scroll right panel to that item
    indexCard.addEventListener("click", () => {
      document.querySelectorAll(".left-panel .title-card").forEach(c => c.classList.remove("active"));
      indexCard.classList.add("active");

      const target = document.getElementById(`item-row-${item.rank}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("item-highlight");
        setTimeout(() => target.classList.remove("item-highlight"), 1200);
      }

      if (window.innerWidth <= 768) closeDrawer();
    });

    leftContainer.appendChild(indexCard);
  });

  // ── RIGHT PANEL — ranked items ─────────────────────────────────────────────
  rightContainer.innerHTML = "";

  const panel = document.createElement("div");
  panel.className = "list-panel fade-in";

  // Sticky title
  const titleEl = document.createElement("h3");
  titleEl.className = "list-title";
  titleEl.textContent = list.title;
  panel.appendChild(titleEl);

  // Items list
  const ul = document.createElement("ul");
  ul.className = "items";
  ul.style.cssText = "list-style:none;padding:0;margin:0;";

  items.forEach(item => {
    const li = document.createElement("li");
    li.id = `item-row-${item.rank}`;
    li.style.cssText = "transition: background 0.3s ease;";

    const rank = document.createElement("div");
    rank.className = "rank";
    rank.textContent = item.rank;

    const txt = document.createElement("div");
    txt.className = "txt";

    const name = document.createElement("div");
    name.className = "result-name";
    name.textContent = item.content;
    txt.appendChild(name);

    li.append(rank, txt);
    ul.appendChild(li);
  });

  panel.appendChild(ul);

  // Source / meta footer
  const footer = document.createElement("p");
  footer.className = "source-note";
  footer.textContent = `By ${owner} · ${date} · ${items.length} items`;
  panel.appendChild(footer);

  rightContainer.appendChild(panel);
}

// ─── Safe HTML escape ─────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
loadList();