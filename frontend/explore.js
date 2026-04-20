// explore.js
// Public discovery page — shows all PUBLISHED TOP10 lists.
// Features: paginated grid, sort by newest/oldest, filter by search term.

import { getSupabase } from "./supabase.js";

const supabase = await getSupabase();

// ---------------- THEME ----------------
const root = document.documentElement;
const storedTheme = localStorage.getItem("listem_theme");
if (storedTheme) root.setAttribute("data-theme", storedTheme);

const themeBtn = document.getElementById("themeToggle");
themeBtn.textContent = root.getAttribute("data-theme") === "dark" ? "☀️" : "🌑";
themeBtn.addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  localStorage.setItem("listem_theme", next);
  themeBtn.textContent = next === "dark" ? "☀️" : "🌑";
});

// ---------------- AUTH BUTTON ----------------
const authBtn = document.getElementById("authBtn");
(async () => {
  const { data } = await supabase.auth.getSession();
  if (data?.session) {
    authBtn.textContent = "Dashboard";
    authBtn.onclick = () => (window.location.href = "dashboard.html");
  } else {
    authBtn.textContent = "Login";
    authBtn.onclick = () => (window.location.href = "index.html");
  }
})();

// ---------------- STATE ----------------
const PAGE_SIZE = 12;
let currentPage = 0;
let currentSort = "newest";
let currentFilter = "";
let hasMore = false;

const grid = document.getElementById("listsGrid");
const loadMoreWrap = document.getElementById("loadMoreWrap");
const loadMoreBtn = document.getElementById("loadMoreBtn");

// ---------------- FETCH ----------------
async function fetchLists(reset = false) {
  if (reset) {
    currentPage = 0;
    grid.innerHTML = `<p class="placeholder">Loading...</p>`;
  }

  const from = currentPage * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Build base query — no embedded joins, just the lists table
  let query = supabase
    .from("lists")
    .select("id, title, description, created_at, owner_id, visibility, type", { count: "exact" })
    .eq("visibility", "PUBLISHED")
    .eq("type", "TOP10")
    .order("created_at", { ascending: currentSort === "oldest" })
    .range(from, to);

  if (currentFilter) {
    query = query.ilike("title", `%${currentFilter}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    grid.innerHTML = `<p class="placeholder">⚠️ Failed to load lists: ${error.message}</p>`;
    return;
  }

  hasMore = (from + PAGE_SIZE) < (count || 0);
  loadMoreWrap.style.display = hasMore ? "block" : "none";

  if (reset) grid.innerHTML = "";

  if (!data?.length && currentPage === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <p style="font-size:2rem;">📋</p>
        <p>No published lists yet.</p>
        ${currentFilter ? `<p style="font-size:0.9rem;">Try a different search term.</p>` : ""}
      </div>
    `;
    return;
  }

  if (!data?.length) return;

  // Fetch items + owner profiles in two batch queries (safe, no FK dependency)
  const listIds   = data.map(l => l.id);
  const ownerIds  = [...new Set(data.map(l => l.owner_id))];

  const [itemsRes, profilesRes] = await Promise.all([
    supabase
      .from("list_items")
      .select("list_id, rank, content")
      .in("list_id", listIds)
      .order("rank", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, username")
      .in("id", ownerIds),
  ]);

  const itemsByList   = {};
  (itemsRes.data || []).forEach(item => {
    if (!itemsByList[item.list_id]) itemsByList[item.list_id] = [];
    itemsByList[item.list_id].push(item);
  });

  const profileMap = {};
  (profilesRes.data || []).forEach(p => { profileMap[p.id] = p.username; });

  data.forEach((list) => {
    const listItems    = itemsByList[list.id] || [];
    const previewItems = listItems.slice(0, 3);
    const owner        = profileMap[list.owner_id] || "Anonymous";
    const date         = new Date(list.created_at).toLocaleDateString();

    const card = document.createElement("a");
    card.className = "list-card";
    card.href = `view-list.html?id=${list.id}`;

    card.innerHTML = `
      <h3 class="list-card-title">${escHtml(list.title)}</h3>
      ${list.description ? `<p class="list-card-desc">${escHtml(list.description)}</p>` : ""}

      <div class="list-card-preview">
        ${previewItems.map((item) => `
          <div class="preview-item">
            <div class="preview-rank">${item.rank}</div>
            <div class="preview-text">${escHtml(item.content)}</div>
          </div>
        `).join("")}
        ${listItems.length > 3
          ? `<p class="muted" style="font-size:0.8rem;margin:4px 0 0 0;">+ ${listItems.length - 3} more</p>`
          : ""}
      </div>

      <div class="list-card-meta">
        <span>by ${escHtml(owner)}</span>
        <span>${date}</span>
      </div>
    `;

    grid.appendChild(card);
  });

  currentPage++;
}

// ---------------- SORT ----------------
document.querySelectorAll(".sort-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".sort-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentSort = btn.dataset.sort;
    fetchLists(true);
  });
});

// ---------------- SEARCH FILTER ----------------
const searchInput = document.getElementById("exploreSearch");
const searchBtn = document.getElementById("exploreSearchBtn");

function applyFilter() {
  currentFilter = searchInput.value.trim();
  fetchLists(true);
}

searchBtn.addEventListener("click", applyFilter);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") applyFilter();
});

// Clear filter when input is emptied
searchInput.addEventListener("input", () => {
  if (!searchInput.value) {
    currentFilter = "";
    fetchLists(true);
  }
});

// ---------------- LOAD MORE ----------------
loadMoreBtn.addEventListener("click", () => fetchLists(false));

// ---------------- INITIAL LOAD ----------------
fetchLists(true);

// ---------------- SAFE HTML ESCAPE ----------------
function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}