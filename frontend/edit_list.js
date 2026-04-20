// edit-list.js
// Editing a TOP10 list stored in Supabase.
// Handles:
// - Loading list + items
// - Updating list title/desc/items
// - Submit review (PENDING)
// - If rejected, show rejection reason and allow resubmission

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

// ---------------- GET LIST ID ----------------
const params = new URLSearchParams(window.location.search);
const listId = params.get("id");

if (!listId) {
  alert("Missing list id.");
  window.location.href = "dashboard.html";
}

document.getElementById("listIdText").textContent = listId;

// ---------------- DOM ----------------
const titleInput = document.getElementById("listTitle");
const descInput = document.getElementById("listDesc");
const itemsBox = document.getElementById("itemsBox");

const statusText = document.getElementById("statusText");
const rejectBox = document.getElementById("rejectBox");
const rejectReasonText = document.getElementById("rejectReason");

const deleteBtn = document.getElementById("deleteBtn");
const submitBtn = document.getElementById("submitBtn");

// ---------------- LOAD LIST ----------------
let currentList = null;

async function loadList() {
  statusText.textContent = "Loading list...";

  // Fetch list metadata
  const { data: list, error: listError } = await supabase
    .from("lists")
    .select("*")
    .eq("id", listId)
    .eq("owner_id", user.id)
    .single();

  if (listError || !list) {
    alert("List not found or access denied.");
    window.location.href = "dashboard.html";
    return;
  }

  currentList = list;

  // Fetch list items
  const { data: items, error: itemsError } = await supabase
    .from("list_items")
    .select("*")
    .eq("list_id", listId)
    .order("rank", { ascending: true });

  if (itemsError) throw itemsError;

  // Fill form
  titleInput.value = list.title || "";
  descInput.value = list.description || "";

  // Show status
  if (list.visibility === "PUBLISHED") {
    statusText.textContent = "✅ Published";
  } else if (list.visibility === "PENDING") {
    statusText.textContent = "⏳ Pending Review";
  } else {
    // PRIVATE can mean draft OR rejected
    if (list.rejection_reason) {
      statusText.textContent = "❌ Rejected";
      rejectBox.style.display = "block";
      rejectReasonText.textContent = list.rejection_reason;
    } else {
      statusText.textContent = "🔒 Private";
    }
  }

  // Render TOP10 fixed slots
  itemsBox.innerHTML = "";
  const isPublished = list.visibility === "PUBLISHED";

  for (let i = 1; i <= 10; i++) {
    const row = document.createElement("div");
    row.className = "item-row";

    const existing = items.find((x) => x.rank === i);

    row.innerHTML = `
      <div class="item-rank">${i}</div>
      <input 
        type="text"
        class="top10-input"
        data-rank="${i}"
        value="${existing?.content || ""}"
        placeholder="Item #${i}"
        ${isPublished ? "disabled" : "required"}
      />
    `;

    itemsBox.appendChild(row);
  }

  // Lock the whole form for published lists
  if (isPublished) {
    titleInput.disabled = true;
    descInput.disabled = true;

    // Show read-only notice above the actions
    const notice = document.createElement("div");
    notice.style.cssText = `
      padding: 12px 16px;
      border-radius: 12px;
      background: rgba(0, 255, 247, 0.07);
      border: 1px solid rgba(0, 255, 247, 0.2);
      color: var(--accent);
      font-weight: 700;
      margin-top: 10px;
    `;
    notice.textContent = "🔒 This list is published and cannot be edited or deleted.";
    document.querySelector(".actions").replaceWith(notice);
  }
}

await loadList();

// ---------------- SAVE LIST ----------------
async function saveList({ submitForReview = false } = {}) {
  if (currentList?.visibility === "PUBLISHED") {
    throw new Error("Published lists cannot be edited.");
  }

  const title = titleInput.value.trim();
  const description = descInput.value.trim() || null;

  if (!title) throw new Error("Title is required.");

  // Read 10 items
  const inputs = document.querySelectorAll(".top10-input");
  const items = [];

  inputs.forEach((inp) => {
    const content = inp.value.trim();
    items.push({
      rank: Number(inp.dataset.rank),
      content,
    });
  });

  if (items.some((x) => !x.content)) {
    throw new Error("All 10 items must be filled.");
  }

  // Update list metadata
  const updatePayload = {
    title,
    description,
    updated_at: new Date().toISOString(),
  };

  // If submitting, set PENDING and clear rejection_reason
  if (submitForReview) {
    updatePayload.visibility = "PENDING";
    updatePayload.rejection_reason = null;
  }

  const { error: listError } = await supabase
    .from("lists")
    .update(updatePayload)
    .eq("id", listId)
    .eq("owner_id", user.id);

  if (listError) throw listError;

  // Replace items (simplest safe method)
  await supabase.from("list_items").delete().eq("list_id", listId);

  const rows = items.map((x) => ({
    list_id: listId,
    rank: x.rank,
    content: x.content,
  }));

  const { error: itemsError } = await supabase.from("list_items").insert(rows);
  if (itemsError) throw itemsError;

  return true;
}

// Save button
document.getElementById("editForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  try {
    await saveList({ submitForReview: false });
    alert("Saved!");
    window.location.href = "dashboard.html";
  } catch (err) {
    alert(err.message);
  }
});

// Submit review button
submitBtn.addEventListener("click", async () => {
  try {
    if (!confirm("Submit this list for review?")) return;
    await saveList({ submitForReview: true });
    alert("Submitted for review!");
    window.location.href = "dashboard.html";
  } catch (err) {
    alert(err.message);
  }
});

// ---------------- DELETE LIST ----------------
deleteBtn.addEventListener("click", async () => {
  if (currentList?.visibility === "PUBLISHED") {
    statusText.textContent = "⚠️ Published lists cannot be deleted.";
    statusText.style.color = "#ff7070";
    return;
  }
  if (!confirm("Delete this list permanently?")) return;

  try {
    await supabase.from("list_items").delete().eq("list_id", listId);
    await supabase.from("lists").delete().eq("id", listId).eq("owner_id", user.id);

    alert("Deleted.");
    window.location.href = "dashboard.html";
  } catch (err) {
    alert(err.message);
  }
});