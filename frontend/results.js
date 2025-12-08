// results.js — adaptive to multi-source backend (v3)
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ---------- DOM references ----------
const urlParams = new URLSearchParams(window.location.search);
const query = urlParams.get("q");

const titlesContainer = document.getElementById("titlesContainer");
const contentContainer = document.getElementById("contentContainer");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const themeBtn = document.getElementById("themeToggle");
const clearCacheBtn = document.getElementById("clearCacheBtn");

const menuToggle = document.getElementById("menuToggle");
const leftPanel = document.querySelector(".left-panel");
const backdrop = document.getElementById("backdrop");

menuToggle.addEventListener("click", () => {
  const isOpen = leftPanel.classList.toggle("open");

  if (isOpen) {
    menuToggle.classList.add("shifted");
    backdrop.classList.add("visible");
  } else {
    menuToggle.classList.remove("shifted");
    backdrop.classList.remove("visible");
  }
});

/* Close on backdrop click */
backdrop.addEventListener("click", () => {
  leftPanel.classList.remove("open");
  menuToggle.classList.remove("shifted");
  backdrop.classList.remove("visible");
});;

document.getElementById("titlesContainer").addEventListener("click", () => {
  leftPanel.classList.remove("open");
  menuToggle.classList.remove("shifted");
  backdrop.classList.remove("visible");
});


function updateHeaderHeight() {
  const header = document.querySelector(".site-header");
  if (header) {
    document.documentElement.style.setProperty(
      "--header-height",
      header.offsetHeight + "px"
    );
  }
}

// ---------- Theme Handling ----------
const root = document.documentElement;
const stored = localStorage.getItem("listem_theme");

if (stored) root.setAttribute("data-theme", stored);
if (!stored) {
  root.setAttribute("data-theme", "dark");
  localStorage.setItem("listem_theme", "dark");
}
function updateThemeIcon() {
  themeBtn.textContent =
    root.getAttribute("data-theme") === "dark" ? "☀️" : "🌑";
}
updateThemeIcon();

themeBtn.addEventListener("click", () => {
  const current = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", current);
  localStorage.setItem("listem_theme", current);
  updateThemeIcon();
});

// ---------- Home ----------
document.getElementById("logoTitle")?.addEventListener("click", () => {
  window.location.href = "index.html";
});

// ---------- Clear Cache ----------
clearCacheBtn?.addEventListener("click", () => {
  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith("searchCache:")) localStorage.removeItem(key);
  });
  alert("Cache cleared!");
});

// ---------- Cache ----------
function getCachedQuery(q) {
  try {
    const cache = JSON.parse(localStorage.getItem(`searchCache:${q}`));
    if (!cache) return null;
    if (Date.now() - cache.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(`searchCache:${q}`);
      return null;
    }
    return cache.data;
  } catch {
    return null;
  }
}
function setCachedQuery(q, data) {
  localStorage.setItem(
    `searchCache:${q}`,
    JSON.stringify({ timestamp: Date.now(), data })
  );
}

// ---------- Search ----------
searchInput.value = query || "";
function triggerSearch() {
  const q = searchInput.value.trim();
  if (!q) return;
  window.location.href = `results.html?q=${encodeURIComponent(q)}`;
}
searchBtn.addEventListener("click", triggerSearch);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") triggerSearch();
});

// ---------- Fetch Results ----------
async function fetchAndRenderResults(q) {
  titlesContainer.innerHTML = `<p class="placeholder fade-in">Loading sections...</p>`;
  contentContainer.innerHTML = `<p class="placeholder fade-in">Loading results...</p>`;

  const cached = getCachedQuery(q);
  if (cached) return renderResults(cached);

  try {
    const res = await fetch(`/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data?.items?.length) {
      titlesContainer.innerHTML = "";
      contentContainer.innerHTML = `<p class="placeholder fade-in">No results found for "${q}".</p>`;
      return;
    }

    setCachedQuery(q, data);
    renderResults(data);
  } catch (err) {
    console.error("Fetch failed:", err);
    titlesContainer.innerHTML = "";
    contentContainer.innerHTML = `<p class="placeholder fade-in">⚠️ Unable to connect. Try again later.</p>`;
  }
}
// ---------- Render ----------
async function renderResults(data) {
  titlesContainer.innerHTML = "";
  contentContainer.innerHTML = "";

  const sections = (data.items || data.results || []).map((section) => ({
    title: section.title || section.query || "Untitled Section",
    source: section.source || "Unknown",
    items:
      section.items || section.results || section.data || section.list || [],
  }));

  function flattenItems(items) {
    const result = [];
    items.forEach((item) => {
      if (item.items && Array.isArray(item.items)) {
        result.push({
          isHeader: true,
          title: item.title || item.name || "Untitled Subsection",
          children: flattenItems(item.items),
        });
      } else {
        result.push({
          isHeader: false,
          title: item.name || item.title || "Untitled",
          link: item.link || item.url || null,
        });
      }
    });
    return result;
  }

  sections.forEach((section, index) => {
    const titleCard = document.createElement("div");
    titleCard.className = "title-card";
    titleCard.innerHTML = `
      <div class="t">${section.title}</div>
      <div class="sub">${section.source}</div>
    `;

    titleCard.addEventListener("click", () => {
      document
        .querySelectorAll(".title-card")
        .forEach((el) => el.classList.remove("active"));
      titleCard.classList.add("active");

      const flattened = flattenItems(section.items);

      const listHTML = flattened
        .map((item, i) => {
          if (item.isHeader) {
            const uid = "sub-" + Math.random().toString(36).substr(2, 6);
            return `
              <li class="subheader" data-uid="${uid}">
                <div class="subheader-title">${item.title}</div>
                <ul class="sub-items" id="${uid}">
                  ${item.children
                    .map(
                      (sub, j) => `
                        <li>
                          <div class="rank">${j + 1}</div>
                          <div class="txt">
                            <div class="result-name">${sub.title}</div>
                            ${
                              sub.link
                                ? `<a href="${sub.link}" target="_blank" class="result-link">🔗 View Source</a>`
                                : ""
                            }
                          </div>
                        </li>`
                    )
                    .join("")}
                </ul>
              </li>`;
          } else {
            return `
              <li>
                <div class="rank">${i + 1}</div>
                <div class="txt">
                  <div class="result-name">${item.title}</div>
                  ${
                    item.link
                      ? `<a href="${item.link}" target="_blank" class="result-link">🔗 View Source</a>`
                      : ""
                  }
                </div>
              </li>`;
          }
        })
        .join("");

      contentContainer.innerHTML = `
        <div class="list-panel fade-in">
          <h3 class="list-title">${section.title}</h3>
          <ul class="items">${listHTML}</ul>
          <p class="source-note">Source: ${section.source}</p>
        </div>
      `;

      document.querySelectorAll(".subheader-title").forEach((header) => {
        header.addEventListener("click", () => {
          const uid = header.parentElement.getAttribute("data-uid");
          const subList = document.getElementById(uid);
          header.classList.toggle("open");
          subList.classList.toggle("collapsed");
        });
      });

      if (window.innerWidth <= 768) titlesContainer.classList.add("hide");
    });

    titlesContainer.appendChild(titleCard);
    if (index === 0) titleCard.click();
  });
}

// ---------- Mobile ----------
window.addEventListener("resize", () => {
  if (window.innerWidth > 768) titlesContainer.classList.remove("hide");
});
document.getElementById("mobileBack")?.addEventListener("click", () => {
  titlesContainer.classList.remove("hide");
});

// ---------- Initial ----------
if (query) fetchAndRenderResults(query);
else
  contentContainer.innerHTML = `<p class="placeholder fade-in">Type something in the search box above to begin.</p>`;
// ---------- Enhanced Right Panel Rendering ----------
// ---------- Enhanced Right Panel Rendering (fixed display) ----------
async function performSearch(query) {

  try {
    const response = await fetch(`/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();
    const rightSide = document.getElementById("rightResults");
    rightSide.innerHTML = ""; // Clear before rendering

    // Safety checks
    if (!data || !data.items || !data.items.length) {
      rightSide.innerHTML = `<p>No results found.</p>`;
      return;
    }

    // Render each section of results
    data.items.forEach((block) => {

      const section = document.createElement("div");
      section.className = "result-section fade-in";

      // Section Title
      const header = document.createElement("h3");
      header.className = "result-section-title";
      header.textContent = block.title || block.source || "Results";
      section.appendChild(header);

      // Items List
      const list = document.createElement("ul");
      list.className = "result-list";

      block.items.forEach((item, index) => {
        const li = document.createElement("li");
        li.className = "result-item";

        // If link exists → wrap name in <a>, else just text
        if (item.link) {
          const link = document.createElement("a");
          link.href = item.link;
          link.target = "_blank";
          link.className = "result-name-link";
          link.textContent = item.name || item.title || `Item ${index + 1}`;
          li.appendChild(link);
        } else {
          const span = document.createElement("span");
          span.className = "result-name";
          span.textContent = item.name || item.title || `Item ${index + 1}`;
          li.appendChild(span);
        }

        list.appendChild(li);
      });

      section.appendChild(list);
      rightSide.appendChild(section);
    });
  } catch (err) {
    console.error("❌ Error fetching search results:", err);
    document.getElementById(
      "rightResults"
    ).innerHTML = `<p>Error loading results.</p>`;
  }
}
