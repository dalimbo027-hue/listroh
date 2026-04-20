// convert-top10.js
// Converts a local REGULAR draft list into a TOP10 Supabase list.
// Steps:
// - user selects 10 items from draft
// - user drags to reorder ranking
// - user submits -> inserts into Supabase lists + list_items

import { getSupabase } from "./supabase.js";

const supabase = await getSupabase();
// ---------------- AUTH CHECK ----------------
const { data: sessionData } = await supabase.auth.getSession();
if (!sessionData?.session) {
  window.location.href = "index.html";
}
const user = sessionData.session.user;

// ---------------- THEME ----------------
const root = document.documentElement;
const themeBtn = document.getElementById("themeToggle");

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

// ---------------- DRAFT HELPERS ----------------
function loadDrafts() {
  try {
    return JSON.parse(localStorage.getItem("listroh_regular_drafts")) || [];
  } catch {
    return [];
  }
}

// ---------------- GET DRAFT ID ----------------
const params = new URLSearchParams(window.location.search);
const draftId = params.get("draft");

if (!draftId) {
  alert("Missing draft id.");
  window.location.href = "dashboard.html";
}

const drafts = loadDrafts();
const draft = drafts.find((d) => d.id === draftId);

if (!draft) {
  alert("Draft not found.");
  window.location.href = "dashboard.html";
}

// ---------------- DOM ----------------
document.getElementById("draftTitle").textContent = draft.title;
document.getElementById("draftDesc").textContent = draft.description || "";

const draftItemsBox = document.getElementById("draftItemsBox");
const selectedList = document.getElementById("selectedList");

// Selected items array (ranking is array order)
let selected = [];

// ---------------- RENDER DRAFT ITEMS ----------------
function renderDraftItems() {
  draftItemsBox.innerHTML = "";

  draft.items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "draft-item";

    const isSelected = selected.includes(item);

    div.innerHTML = `
      <span>${item}</span>
      <button ${isSelected ? "disabled" : ""}>
        ${isSelected ? "Selected" : "Add"}
      </button>
    `;

    const btn = div.querySelector("button");

    btn.addEventListener("click", () => {
      if (selected.length >= 10) {
        alert("You already selected 10 items.");
        return;
      }
      if (selected.includes(item)) {
        return; // already selected, button should be disabled but guard anyway
      }
      selected.push(item);
      renderSelected();
      renderDraftItems();
    });

    draftItemsBox.appendChild(div);
  });
}

// ---------------- RENDER SELECTED LIST (DRAG SORT) ----------------
function renderSelected() {
  selectedList.innerHTML = "";

  selected.forEach((item, index) => {
    const li = document.createElement("li");
    li.draggable = true;
    li.dataset.index = index;

    li.innerHTML = `
      <span><b>${index + 1}.</b> ${item}</span>
      <button data-index="${index}">❌</button>
    `;

    // Remove from selected
    li.querySelector("button").addEventListener("click", () => {
      selected.splice(index, 1);
      renderSelected();
      renderDraftItems();
    });

    // Drag start
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", index);
    });

    // Drag over
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
    });

    // Drop reorder
    li.addEventListener("drop", (e) => {
      e.preventDefault();

      const fromIndex = Number(e.dataTransfer.getData("text/plain"));
      const toIndex = Number(li.dataset.index);

      if (fromIndex === toIndex) return;

      const moved = selected.splice(fromIndex, 1)[0];
      selected.splice(toIndex, 0, moved);

      renderSelected();
    });

    selectedList.appendChild(li);
  });
}

// Initial render
renderDraftItems();
renderSelected();

// ---------------- SUBMIT TO SUPABASE ----------------
async function submitTop10(visibility) {
  if (selected.length !== 10) {
    throw new Error("You must select exactly 10 items.");
  }

  // Create TOP10 list
  const { data: newList, error: listError } = await supabase
    .from("lists")
    .insert([
      {
        owner_id: user.id,
        title: draft.title,
        description: draft.description || null,
        type: "TOP10",
        visibility,
      },
    ])
    .select()
    .single();

  if (listError) throw listError;

  // Insert items ranked by order in selected[]
  const rows = selected.map((content, index) => ({
    list_id: newList.id,
    rank: index + 1,
    content,
  }));

  const { error: itemsError } = await supabase.from("list_items").insert(rows);
  if (itemsError) throw itemsError;

  return newList.id;
}

// Save private
document.getElementById("submitPrivateBtn").addEventListener("click", async () => {
  try {
    await submitTop10("PRIVATE");
    alert("Converted to Top10 and saved!");
    window.location.href = "dashboard.html";
  } catch (err) {
    alert(err.message);
  }
});

// Submit review
document.getElementById("submitPendingBtn").addEventListener("click", async () => {
  try {
    if (!confirm("Submit this Top10 list for review?")) return;
    await submitTop10("PENDING");
    alert("Converted and submitted!");
    window.location.href = "dashboard.html";
  } catch (err) {
    alert(err.message);
  }
});