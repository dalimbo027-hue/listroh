// edit-draft.js
// Local REGULAR list editing system.
// Stored in localStorage only.
// User can:
// - update title/desc/items
// - delete draft
// - convert to Top10

const root = document.documentElement;
const themeBtn = document.getElementById("themeToggle");

// ---------------- THEME ----------------
const storedTheme = localStorage.getItem("listem_theme");
if (storedTheme) root.setAttribute("data-theme", storedTheme);

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

// ---------------- BACK ----------------
document.getElementById("backBtn").addEventListener("click", () => {
  window.location.href = "dashboard.html";
});

// ---------------- STORAGE HELPERS ----------------
function loadDrafts() {
  try {
    return JSON.parse(localStorage.getItem("listroh_regular_drafts")) || [];
  } catch {
    return [];
  }
}

function saveDrafts(drafts) {
  localStorage.setItem("listroh_regular_drafts", JSON.stringify(drafts));
}

// ---------------- GET DRAFT ID ----------------
const params = new URLSearchParams(window.location.search);
const draftId = params.get("draft");

if (!draftId) {
  alert("Missing draft id.");
  window.location.href = "dashboard.html";
}

let drafts = loadDrafts();
let draft = drafts.find((d) => d.id === draftId);

if (!draft) {
  alert("Draft not found.");
  window.location.href = "dashboard.html";
}

document.getElementById("draftIdText").textContent = draft.id;

// ---------------- DOM ----------------
const titleInput = document.getElementById("draftTitle");
const descInput = document.getElementById("draftDesc");
const itemsBox = document.getElementById("itemsBox");

function renderItems() {
  itemsBox.innerHTML = "";

  draft.items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "item-row";

    row.innerHTML = `
      <div class="item-rank">${index + 1}</div>
      <input 
        type="text"
        class="draft-item-input"
        data-index="${index}"
        value="${item}"
        placeholder="Item #${index + 1}"
      />
    `;

    itemsBox.appendChild(row);
  });
}

function loadIntoForm() {
  titleInput.value = draft.title || "";
  descInput.value = draft.description || "";
  renderItems();
}

loadIntoForm();

// ---------------- ADD/REMOVE ----------------
document.getElementById("addItemBtn").addEventListener("click", () => {
  draft.items.push("");
  renderItems();
});

document.getElementById("removeItemBtn").addEventListener("click", () => {
  if (draft.items.length <= 1) return;
  draft.items.pop();
  renderItems();
});

// ---------------- SAVE ----------------
document.getElementById("draftForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const newTitle = titleInput.value.trim();
  const newDesc = descInput.value.trim();

  if (!newTitle) {
    alert("Title is required.");
    return;
  }

  const inputs = document.querySelectorAll(".draft-item-input");
  const items = [];

  inputs.forEach((inp) => {
    const val = inp.value.trim();
    if (val) items.push(val);
  });

  if (items.length < 1) {
    alert("Add at least 1 item.");
    return;
  }

  draft.title = newTitle;
  draft.description = newDesc || null;
  draft.items = items;
  draft.updated_at = Date.now();

  drafts = drafts.map((d) => (d.id === draft.id ? draft : d));
  saveDrafts(drafts);

  alert("Draft saved!");
});

// ---------------- DELETE ----------------
document.getElementById("deleteBtn").addEventListener("click", () => {
  if (!confirm("Delete this draft permanently?")) return;

  drafts = drafts.filter((d) => d.id !== draft.id);
  saveDrafts(drafts);

  alert("Draft deleted.");
  window.location.href = "dashboard.html";
});

// ---------------- CONVERT ----------------
document.getElementById("convertBtn").addEventListener("click", () => {
  window.location.href = `convert-top10.html?draft=${draft.id}`;
});
