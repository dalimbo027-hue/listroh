// dashboard.js
// Main dashboard:
// - Tabs system
// - Search results shown in Search tab
// - Create list supports:
//      REGULAR = local draft only
//      TOP10 = saved to Supabase
// - My Lists shows:
//      Local REGULAR drafts
//      Supabase TOP10 lists (PRIVATE / PENDING / PUBLISHED)
// - Handles rejection reason + resubmit workflow properly

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

// ---------------- LOGOUT ----------------
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "index.html";
});

// ---------------- TAB SYSTEM ----------------
const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

function openTab(tabId) {
  tabButtons.forEach((btn) => btn.classList.remove("active"));
  tabContents.forEach((tab) => tab.classList.remove("active"));

  document.querySelector(`[data-tab="${tabId}"]`).classList.add("active");
  document.getElementById(tabId).classList.add("active");
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    openTab(btn.dataset.tab);
  });
});

// ---------------- SEARCH SYSTEM ----------------
// This uses your existing backend /search route.
// Results will render inside Search tab.
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const searchResultsBox = document.getElementById("searchResultsBox");

async function performSearch(q) {
  if (!q) return;

  openTab("searchTab");

  searchResultsBox.innerHTML = `<p class="placeholder">Loading results...</p>`;

  try {
    const res = await fetch(`/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();

    if (!data?.items?.length) {
      searchResultsBox.innerHTML = `<p class="placeholder">No results found.</p>`;
      return;
    }

    // Render similar style to results page
    searchResultsBox.innerHTML = data.items
      .map((section) => {
        const listHTML = (section.items || [])
          .slice(0, 10)
          .map(
            (item, idx) => `
              <li style="margin-bottom:10px;">
                <b>${idx + 1}.</b> ${item.name || item.title || item.content || "Untitled"}
              </li>
            `,
          )
          .join("");

        return `
          <div class="profile-card">
            <h3 style="color:var(--accent);margin-top:0;">${section.title}</h3>
            <p class="placeholder">Source: ${section.source}</p>
            <ul style="padding-left:18px;">${listHTML}</ul>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    console.error(err);
    searchResultsBox.innerHTML = `<p class="placeholder">⚠️ Search failed.</p>`;
  }
}

searchBtn.addEventListener("click", () => {
  const q = searchInput.value.trim();
  if (!q) return;
  window.location.href = `results.html?q=${encodeURIComponent(q)}&from=dashboard`;
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const q = searchInput.value.trim();
    if (!q) return;
    window.location.href = `results.html?q=${encodeURIComponent(q)}&from=dashboard`;
  }
});

// ---------------- LOCAL DRAFT STORAGE ----------------
function loadDrafts() {
  try {
    return JSON.parse(localStorage.getItem("listroh_regular_drafts")) || [];
  } catch {
    return [];
  }
}

function saveDrafts(drafts) {
  try {
    localStorage.setItem("listroh_regular_drafts", JSON.stringify(drafts));
    const check = localStorage.getItem("listroh_regular_drafts");
    if (!check) throw new Error("Storage did not persist.");
    return true;
  } catch (err) {
    console.error("saveDrafts failed:", err);
    throw new Error(
      "Could not save draft. Browser storage may be disabled (private/incognito mode). " + err.message
    );
  }
}

function createLocalDraft(title, description, items) {
  const drafts = loadDrafts();

  drafts.unshift({
    id: "draft_" + Date.now(),
    title,
    description,
    items,
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  saveDrafts(drafts);
}

// ---------------- CREATE LIST UI ----------------
const createTop10Box = document.getElementById("createTop10Box");
const createRegularBox = document.getElementById("createRegularBox");

const listTypeSelect = document.getElementById("listTypeSelect");

const regularItemInput = document.getElementById("regularItemInput");
const regularAddBtn = document.getElementById("regularAddBtn");
const regularItemsList = document.getElementById("regularItemsList");

// Regular list items stored in memory before saving draft
let regularDraftItems = [];

// ---------- TOP10 INPUTS ----------
function buildTop10Inputs() {
  createTop10Box.innerHTML = "";

  for (let i = 1; i <= 10; i++) {
    const row = document.createElement("div");
    row.className = "item-row";

    row.innerHTML = `
      <div class="item-rank">${i}</div>
      <input 
        type="text"
        class="create-top10-input"
        data-rank="${i}"
        placeholder="Item #${i}"
        required
      />
    `;

    createTop10Box.appendChild(row);
  }
}

// ---------- REGULAR ITEMS ----------
function renderRegularItems() {
  regularItemsList.innerHTML = "";

  if (regularDraftItems.length === 0) {
    regularItemsList.innerHTML = `<p class="placeholder">No items added yet.</p>`;
    return;
  }

  regularDraftItems.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "regular-item-card";

    card.innerHTML = `
      <div><b>${index + 1}.</b> ${item}</div>

      <div class="regular-item-actions">
        <button data-action="up">⬆</button>
        <button data-action="down">⬇</button>
        <button data-action="delete">🗑</button>
      </div>
    `;

    card.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;

        if (action === "delete") {
          regularDraftItems.splice(index, 1);
        }

        if (action === "up" && index > 0) {
          [regularDraftItems[index - 1], regularDraftItems[index]] = [
            regularDraftItems[index],
            regularDraftItems[index - 1],
          ];
        }

        if (action === "down" && index < regularDraftItems.length - 1) {
          [regularDraftItems[index + 1], regularDraftItems[index]] = [
            regularDraftItems[index],
            regularDraftItems[index + 1],
          ];
        }

        renderRegularItems();
      });
    });

    regularItemsList.appendChild(card);
  });
}

function addRegularItem() {
  const value = regularItemInput.value.trim();
  if (!value) return;

  regularDraftItems.push(value);
  regularItemInput.value = "";
  renderRegularItems();
}

regularAddBtn.addEventListener("click", addRegularItem);

regularItemInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addRegularItem();
  }
});

// ---------- SWITCH TYPE ----------
function updateCreateUI() {
  const type = listTypeSelect.value;

  if (type === "TOP10") {
    createTop10Box.style.display = "flex";
    createRegularBox.style.display = "none";
    buildTop10Inputs();
  } else {
    createTop10Box.style.display = "none";
    createRegularBox.style.display = "block";
    renderRegularItems();
  }
}

listTypeSelect.addEventListener("change", updateCreateUI);

// Default state
buildTop10Inputs();
updateCreateUI();

// ---------- READ TOP10 ITEMS ----------
function getTop10Items({ requireAll = true } = {}) {
  const inputs = document.querySelectorAll(".create-top10-input");
  const items = [];

  inputs.forEach((inp) => {
    items.push({
      rank: Number(inp.dataset.rank),
      content: inp.value.trim(),
    });
  });

  if (requireAll && items.some((x) => !x.content)) {
    throw new Error("All 10 items must be filled to submit for review.");
  }

  const filled = items.filter((x) => x.content);
  if (filled.length < 1) {
    throw new Error("Add at least 1 item before saving.");
  }

  return requireAll ? items : filled;
}

// ---------------- CREATE LIST HANDLER ----------------
async function createList(visibility) {
  const title = document.getElementById("listTitle").value.trim();
  const description = document.getElementById("listDesc").value.trim() || null;
  const type = listTypeSelect.value;

  if (!title) throw new Error("Title is required.");

  // ---------------- REGULAR = LOCAL DRAFT ----------------
  if (type === "REGULAR") {
    if (regularDraftItems.length < 1) {
      throw new Error("Add at least 1 item.");
    }

    // Business rule: Regular lists cannot be submitted.
    if (visibility === "PENDING") {
      throw new Error(
        "Regular lists cannot be submitted. Convert to Top10 first.",
      );
    }

    createLocalDraft(title, description, regularDraftItems);

    // Reset regular draft memory
    regularDraftItems = [];
    renderRegularItems();

    return null;
  }

  // ---------------- TOP10 = SUPABASE ----------------
  const items = getTop10Items({ requireAll: visibility === "PENDING" });

  const { data: newList, error: listError } = await supabase
    .from("lists")
    .insert([
      {
        owner_id: user.id,
        title,
        description,
        type: "TOP10",
        visibility, // PRIVATE or PENDING
      },
    ])
    .select()
    .single();

  if (listError) throw listError;

  const rows = items.map((x) => ({
    list_id: newList.id,
    rank: x.rank,
    content: x.content,
  }));

  const { error: itemsError } = await supabase.from("list_items").insert(rows);
  if (itemsError) throw itemsError;

  return newList.id;
}

// Save (PRIVATE)
document
  .getElementById("createListForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();

    const statusEl = document.getElementById("createStatus");
    const saveBtn = e.target.querySelector('button[type="submit"]');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
    if (statusEl) statusEl.textContent = "";

    try {
      await createList("PRIVATE");

      if (statusEl) {
        statusEl.textContent = "✅ Saved!";
        statusEl.style.color = "var(--accent)";
      } else {
        alert("Saved!");
      }

      document.getElementById("listTitle").value = "";
      document.getElementById("listDesc").value = "";

      if (listTypeSelect.value === "TOP10") buildTop10Inputs();
      if (listTypeSelect.value === "REGULAR") {
        regularDraftItems = [];
        renderRegularItems();
      }

      renderMyLists();
    } catch (err) {
      console.error("Save failed:", err);
      const msg = err?.message || err?.hint || err?.details || err?.error_description || "Unknown error.";
      if (statusEl) {
        statusEl.textContent = "⚠️ " + msg;
        statusEl.style.color = "#ff7070";
      } else {
        alert(msg);
      }
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "💾 Save"; }
    }
  });

// Submit review (PENDING)
document
  .getElementById("submitPendingBtn")
  .addEventListener("click", async () => {
    try {
      await createList("PENDING");
      alert("Submitted for review!");

      document.getElementById("listTitle").value = "";
      document.getElementById("listDesc").value = "";
      buildTop10Inputs();

      renderMyLists();
    } catch (err) {
      alert(err.message);
    }
  });

// ---------------- MY LISTS ----------------
const myListsContainer = document.getElementById("myListsContainer");

function statusLabel(list) {
  if (list.visibility === "PUBLISHED") return "✅ PUBLISHED";
  if (list.visibility === "PENDING") return "⏳ PENDING REVIEW";
  if (list.visibility === "PRIVATE") {
    if (list.rejection_reason) return "❌ REJECTED";
    return "🔒 PRIVATE";
  }
  return list.visibility;
}

// Resubmit rejected list
async function resubmitList(listId) {
  // Resubmitting means:
  // - visibility becomes PENDING
  // - rejection_reason cleared
  const { error } = await supabase
    .from("lists")
    .update({
      visibility: "PENDING",
      rejection_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", listId)
    .eq("owner_id", user.id);

  if (error) throw error;
}

async function deleteSupabaseList(listId) {
  // Delete items first to avoid FK errors (if cascade not enabled)
  await supabase.from("list_items").delete().eq("list_id", listId);
  await supabase
    .from("lists")
    .delete()
    .eq("id", listId)
    .eq("owner_id", user.id);
}

async function fetchSupabaseLists() {
  const { data, error } = await supabase
    .from("lists")
    .select(
      `
      id,
      title,
      description,
      type,
      visibility,
      created_at,
      updated_at,
      rejection_reason
    `,
    )
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

async function renderMyLists() {
  myListsContainer.innerHTML = `<p class="placeholder">Loading...</p>`;

  // ---------- LOCAL DRAFTS ----------
  const drafts = loadDrafts();

  let draftHTML = `<h3 style="color:var(--accent);">Local Draft Lists (REGULAR)</h3>`;

  if (!drafts.length) {
    draftHTML += `<p class="placeholder">No local drafts yet.</p>`;
  } else {
    draftHTML += drafts.map((d) => `
      <div class="profile-card">
        <h3>${d.title}</h3>
        <p class="placeholder">${d.description || ""}</p>
        <p style="color:orange;font-weight:900;">REGULAR • LOCAL DRAFT</p>
        <p class="placeholder">Items: ${d.items.length}</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">
          <button class="edit-draft-btn" data-id="${d.id}">✏️ Edit</button>
          <button class="delete-draft-btn" data-id="${d.id}">🗑 Delete</button>
          <button class="convert-btn" data-id="${d.id}">⭐ Convert to Top10</button>
        </div>
      </div>
    `).join("");
  }

  // ---------- SUPABASE TOP10 ----------
  let supabaseHTML = `<h3 style="color:var(--accent);margin-top:20px;">Submitted Lists (TOP10)</h3>`;

  try {
    const lists = await fetchSupabaseLists();

    if (!lists.length) {
      supabaseHTML += `<p class="placeholder">No submitted Top10 lists yet.</p>`;
    } else {
      supabaseHTML += lists.map((list) => {
        const isPending   = list.visibility === "PENDING";
        const isPublished = list.visibility === "PUBLISHED";
        const isRejected  = list.visibility === "PRIVATE" && list.rejection_reason;
        const isPrivate   = list.visibility === "PRIVATE" && !list.rejection_reason;

        // ---- status badge ----
        let statusColor = "var(--muted)";
        if (isPending)   statusColor = "#ffd250";
        if (isPublished) statusColor = "#00ffb4";
        if (isRejected)  statusColor = "#ff7070";

        const rejectedNote = isRejected
          ? `<div style="margin-top:6px;padding:10px 12px;border-radius:10px;background:rgba(255,80,80,0.08);border:1px solid rgba(255,80,80,0.2);">
               <p style="margin:0;font-size:0.85rem;color:#ff8080;font-weight:700;">Rejection reason:</p>
               <p style="margin:4px 0 0;font-size:0.85rem;color:#ffb4b4;">${list.rejection_reason}</p>
             </div>`
          : "";

        // ---- buttons per status ----
        // PENDING / PUBLISHED → view only, no edit/delete
        // PRIVATE (draft)     → edit + delete
        // REJECTED            → edit + delete + resubmit
        const viewBtn = (isPending || isPublished)
          ? `<button class="view-list-btn" data-id="${list.id}">👁 View</button>`
          : "";

        const editBtn = (isPrivate || isRejected)
          ? `<button class="edit-top10-btn" data-id="${list.id}">✏️ Edit</button>`
          : "";

        const deleteBtn = (isPrivate || isRejected)
          ? `<button class="delete-top10-btn" data-id="${list.id}">🗑 Delete</button>`
          : "";

        const resubmitBtn = isRejected
          ? `<button class="resubmit-btn" data-id="${list.id}">🔁 Resubmit</button>`
          : "";

        const lockedNote = (isPending || isPublished)
          ? `<p style="margin:6px 0 0;font-size:0.82rem;color:var(--muted);">
               ${isPending ? "⏳ Under review — editing is locked until a decision is made." : "🔒 Published lists cannot be edited or deleted."}
             </p>`
          : "";

        return `
          <div class="profile-card">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <h3 style="margin:0;">${list.title}</h3>
              <span style="font-size:0.8rem;font-weight:700;color:${statusColor};">${statusLabel(list)}</span>
            </div>
            ${list.description ? `<p class="placeholder" style="margin:6px 0 0;">${list.description}</p>` : ""}
            ${rejectedNote}
            ${lockedNote}
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
              ${viewBtn}${editBtn}${resubmitBtn}${deleteBtn}
            </div>
          </div>
        `;
      }).join("");
    }

    myListsContainer.innerHTML =
      draftHTML +
      `<hr style="border:1px solid rgba(255,255,255,0.08);margin:20px 0;">` +
      supabaseHTML;

    // ---------- BUTTON HANDLERS ----------
    document.querySelectorAll(".convert-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.location.href = `convert-top10.html?draft=${btn.dataset.id}`;
      });
    });

    document.querySelectorAll(".edit-draft-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.location.href = `edit-draft.html?draft=${btn.dataset.id}`;
      });
    });

    document.querySelectorAll(".delete-draft-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!confirm("Delete this local draft?")) return;
        const updated = loadDrafts().filter((d) => d.id !== btn.dataset.id);
        saveDrafts(updated);
        renderMyLists();
      });
    });

    document.querySelectorAll(".view-list-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.location.href = `view-list.html?id=${btn.dataset.id}`;
      });
    });

    document.querySelectorAll(".edit-top10-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.location.href = `edit-list.html?id=${btn.dataset.id}`;
      });
    });

    document.querySelectorAll(".delete-top10-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this list permanently?")) return;
        await deleteSupabaseList(btn.dataset.id);
        renderMyLists();
      });
    });

    document.querySelectorAll(".resubmit-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          if (!confirm("Resubmit this list for review?")) return;
          await resubmitList(btn.dataset.id);
          renderMyLists();
        } catch (err) {
          alert(err.message);
        }
      });
    });

  } catch (err) {
    console.error(err);
    myListsContainer.innerHTML =
      draftHTML +
      `<hr style="border:1px solid rgba(255,255,255,0.08);margin:20px 0;">` +
      `<p class="placeholder">⚠️ Failed to load Supabase lists.</p>`;
  }
}

// ---------------- PROFILE TAB ----------------
async function renderProfile() {
  const profileBox = document.getElementById("profileBox");
  profileBox.innerHTML = `<p class="placeholder">Loading profile...</p>`;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error) {
    profileBox.innerHTML = `<p class="placeholder">⚠️ Profile not found.</p>`;
    return;
  }

  const initial = (data.username || user.email || "?")[0].toUpperCase();

  profileBox.innerHTML = `
    <div class="profile-card" style="max-width:640px;">

      <!-- Avatar + identity row -->
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px;">
        <div style="
          width:64px;height:64px;border-radius:50%;
          background:var(--accent-2);
          display:grid;place-items:center;
          font-size:1.6rem;font-weight:800;color:#fff;
          flex-shrink:0;
        ">${initial}</div>

        <div style="flex:1;min-width:0;">
          <p style="margin:0;font-size:1.1rem;font-weight:800;color:var(--text);">
            ${data.username || "Unnamed User"}
          </p>
          <p style="margin:2px 0 0;font-size:0.85rem;color:var(--muted);">${user.email}</p>
          <span style="
            display:inline-block;margin-top:4px;
            padding:2px 10px;border-radius:999px;font-size:0.75rem;font-weight:700;
            background:${data.role === "admin" ? "rgba(255,80,80,0.15)" : "rgba(0,255,247,0.08)"};
            color:${data.role === "admin" ? "#ff8080" : "var(--accent)"};
            border:1px solid ${data.role === "admin" ? "rgba(255,80,80,0.3)" : "rgba(0,255,247,0.2)"};
          ">${(data.role || "user").toUpperCase()}</span>
        </div>
      </div>

      <!-- Stats row -->
      <div style="display:flex;gap:0;margin-bottom:20px;border:1px solid var(--panel-border);border-radius:12px;overflow:hidden;">
        <div style="flex:1;padding:12px;text-align:center;border-right:1px solid var(--panel-border);">
          <p style="margin:0;font-size:1.3rem;font-weight:800;color:var(--accent);">${data.followers || 0}</p>
          <p style="margin:2px 0 0;font-size:0.78rem;color:var(--muted);">Followers</p>
        </div>
        <div style="flex:1;padding:12px;text-align:center;border-right:1px solid var(--panel-border);">
          <p style="margin:0;font-size:1.3rem;font-weight:800;color:var(--accent);">${data.following || 0}</p>
          <p style="margin:2px 0 0;font-size:0.78rem;color:var(--muted);">Following</p>
        </div>
        <div style="flex:1;padding:12px;text-align:center;">
          <p style="margin:0;font-size:1.3rem;font-weight:800;color:var(--accent);" id="profileListCount">—</p>
          <p style="margin:2px 0 0;font-size:0.78rem;color:var(--muted);">Published</p>
        </div>
      </div>

      <hr style="border:none;border-top:1px solid var(--panel-border);margin:0 0 18px 0;" />

      <!-- Editable fields -->
      <div style="display:flex;flex-direction:column;gap:14px;">

        <div>
          <label style="display:block;font-size:0.82rem;font-weight:700;color:var(--muted);margin-bottom:6px;">Username</label>
          <input id="profileUsername" type="text" value="${data.username || ""}" placeholder="Enter a username..."
            style="width:100%;padding:11px 14px;border-radius:12px;border:1px solid var(--panel-border);background:var(--glass);color:var(--text);outline:none;font-size:0.95rem;" />
        </div>

        <div>
          <label style="display:block;font-size:0.82rem;font-weight:700;color:var(--muted);margin-bottom:6px;">Bio</label>
          <textarea id="profileBio" placeholder="Tell people about yourself..."
            style="width:100%;padding:11px 14px;border-radius:12px;border:1px solid var(--panel-border);background:var(--glass);color:var(--text);outline:none;min-height:90px;resize:vertical;font-family:inherit;font-size:0.95rem;"
          >${data.bio || ""}</textarea>
        </div>

        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <button id="saveProfileBtn" style="padding:11px 20px;border-radius:12px;border:none;cursor:pointer;font-weight:700;background:var(--accent);color:#001;font-size:0.95rem;">
            💾 Save changes
          </button>
          <p id="profileStatus" style="margin:0;font-size:0.88rem;color:var(--muted);min-height:1.2em;"></p>
        </div>

      </div>
    </div>
  `;

  // Fetch published list count for this user
  supabase
    .from("lists")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id)
    .eq("visibility", "PUBLISHED")
    .then(({ count }) => {
      const el = document.getElementById("profileListCount");
      if (el) el.textContent = count ?? 0;
    });

  // Save handler
  document.getElementById("saveProfileBtn").addEventListener("click", async () => {
    const username = document.getElementById("profileUsername").value.trim();
    const bio = document.getElementById("profileBio").value.trim();
    const statusEl = document.getElementById("profileStatus");
    const btn = document.getElementById("saveProfileBtn");

    if (!username) {
      statusEl.textContent = "⚠️ Username is required.";
      statusEl.style.color = "#ff7070";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Saving…";
    statusEl.textContent = "";

    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        username,
        bio: bio || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    btn.disabled = false;
    btn.textContent = "💾 Save changes";

    if (updateError) {
      statusEl.textContent = "⚠️ " + updateError.message;
      statusEl.style.color = "#ff7070";
    } else {
      statusEl.textContent = "✅ Profile updated.";
      statusEl.style.color = "var(--accent)";
      // Clear the success message after 3s
      setTimeout(() => { statusEl.textContent = ""; }, 3000);
    }
  });
}

// ---------------- INITIAL LOAD ----------------
renderMyLists();
renderProfile();

// ──────────────────────────────────────────────────────────────────────────────
// ADMIN PANEL
// Runs after initial load. Checks if user is admin, shows tab/button if so.
// ──────────────────────────────────────────────────────────────────────────────

const ADMIN_PAGE_SIZE = 12;

const adminState = {
  tab:   "adminPending",
  sort:  "created_at",
  page:  0,
  total: 0,
};

const ADMIN_VISIBILITY = {
  adminPending:   "PENDING",
  adminPublished: "PUBLISHED",
  adminRejected:  "PRIVATE",
};

async function initAdminIfNeeded() {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") return;

  // ── Show UI ──
  document.getElementById("adminTabBtn").style.display = "block";

  const adminHeaderBtn = document.getElementById("adminHeaderBtn");
  if (adminHeaderBtn) {
    adminHeaderBtn.style.display = "inline-block";
    adminHeaderBtn.addEventListener("click", () => {
      openTab("adminTab");
      if (!adminState.total && !document.getElementById("adminPending").children.length) {
        loadAdminTab();
      }
    });
  }

  // ── Admin sub-tabs ──
  document.querySelectorAll(".admin-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      document.querySelectorAll(".admin-list-container").forEach(c => c.style.display = "none");
      document.getElementById(btn.dataset.adminTab).style.display = "grid";

      adminState.tab  = btn.dataset.adminTab;
      adminState.page = 0;
      loadAdminTab();
    });
  });

  // ── Sort ──
  document.getElementById("adminSort").addEventListener("change", e => {
    adminState.sort = e.target.value;
    adminState.page = 0;
    loadAdminTab();
  });

  // ── Pagination ──
  document.getElementById("adminPrevPage").addEventListener("click", () => {
    if (adminState.page <= 0) return;
    adminState.page--;
    loadAdminTab();
  });

  document.getElementById("adminNextPage").addEventListener("click", () => {
    if (adminState.page + 1 >= Math.ceil(adminState.total / ADMIN_PAGE_SIZE)) return;
    adminState.page++;
    loadAdminTab();
  });

  // ── Edit modal buttons ──
  document.getElementById("adminCancelEdit").addEventListener("click",  closeEditModal);
  document.getElementById("adminSaveDraft").addEventListener("click",   () => adminSaveList(false));
  document.getElementById("adminSaveApprove").addEventListener("click", () => adminSaveList(true));
  document.getElementById("adminAddItem").addEventListener("click",     () => adminAddItemRow(""));

  // ── Reject modal buttons ──
  document.getElementById("cancelReject").addEventListener("click",  closeRejectModal);
  document.getElementById("confirmReject").addEventListener("click", confirmReject);

  // ── Tag modal buttons ──
  document.getElementById("tagModalCancel").addEventListener("click", closeTagModal);
  document.getElementById("tagModalSave").addEventListener("click",   saveTagModal);

  // ── Load when admin tab is opened via sidebar ──
  document.querySelector("[data-tab='adminTab']").addEventListener("click", () => {
    if (!adminState.total && !document.getElementById("adminPending").children.length) {
      loadAdminTab();
    }
  });
}

// ── LOAD TAB ──────────────────────────────────────────────────────────────────
async function loadAdminTab() {
  const container = document.getElementById(adminState.tab);
  container.innerHTML = `<p class="placeholder" style="grid-column:1/-1;padding:20px 0;">Loading…</p>`;

  const from       = adminState.page * ADMIN_PAGE_SIZE;
  const to         = from + ADMIN_PAGE_SIZE - 1;
  const visibility = ADMIN_VISIBILITY[adminState.tab];

  const { data, error, count } = await supabase
    .from("lists")
    .select("id, title, description, tags, owner_id, visibility, rejection_reason, created_at, updated_at", { count: "exact" })
    .eq("visibility", visibility)
    .order(adminState.sort, { ascending: false })
    .range(from, to);

  // Update all three count badges
  updateAdminCounts();

  container.innerHTML = "";

  if (error) {
    container.innerHTML = `<p class="placeholder" style="grid-column:1/-1;color:#ff8080;">⚠️ ${error.message}</p>`;
    return;
  }

  adminState.total = count ?? 0;
  updateAdminPagination();

  if (!data?.length) {
    container.innerHTML = `<p class="placeholder" style="grid-column:1/-1;padding:20px 0;">No lists here.</p>`;
    return;
  }

  // Batch fetch items + owner usernames
  const ids      = data.map(l => l.id);
  const ownerIds = [...new Set(data.map(l => l.owner_id))];

  const [itemsRes, profilesRes] = await Promise.all([
    supabase.from("list_items").select("list_id, rank, content").in("list_id", ids).order("rank", { ascending: true }),
    supabase.from("profiles").select("id, username").in("id", ownerIds),
  ]);

  const itemsByList = {};
  (itemsRes.data || []).forEach(i => {
    if (!itemsByList[i.list_id]) itemsByList[i.list_id] = [];
    itemsByList[i.list_id].push(i);
  });

  const profileMap = {};
  (profilesRes.data || []).forEach(p => { profileMap[p.id] = p.username; });

  data.forEach(list => {
    const items     = itemsByList[list.id] || [];
    const ownerName = profileMap[list.owner_id] || list.owner_id;
    container.appendChild(renderAdminCard(list, items, ownerName));
  });
}

async function updateAdminCounts() {
  const [pending, published, rejected] = await Promise.all([
    supabase.from("lists").select("id", { count: "exact", head: true }).eq("visibility", "PENDING"),
    supabase.from("lists").select("id", { count: "exact", head: true }).eq("visibility", "PUBLISHED"),
    supabase.from("lists").select("id", { count: "exact", head: true }).eq("visibility", "PRIVATE"),
  ]);
  const p = document.getElementById("count-pending");
  const pub = document.getElementById("count-published");
  const r = document.getElementById("count-rejected");
  if (p)   p.textContent   = pending.count   ?? 0;
  if (pub) pub.textContent = published.count ?? 0;
  if (r)   r.textContent   = rejected.count  ?? 0;
}

function updateAdminPagination() {
  const totalPages = Math.max(1, Math.ceil(adminState.total / ADMIN_PAGE_SIZE));
  const current    = adminState.page + 1;
  const info       = document.getElementById("adminPageInfo");
  if (info) info.textContent = `Page ${current} of ${totalPages}`;
  const prev = document.getElementById("adminPrevPage");
  const next = document.getElementById("adminNextPage");
  if (prev) prev.disabled = adminState.page <= 0;
  if (next) next.disabled = current >= totalPages;
}

// ── RENDER CARD ───────────────────────────────────────────────────────────────
function renderAdminCard(list, items, ownerName) {
  const card = document.createElement("div");
  card.className = "admin-card";

  const title = document.createElement("h3");
  title.className = "admin-card-title";
  title.textContent = list.title;
  card.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "admin-card-meta";
  meta.textContent = `by ${ownerName} · ${new Date(list.created_at).toLocaleDateString()}`;
  card.appendChild(meta);

  if (list.description) {
    const desc = document.createElement("p");
    desc.style.cssText = "margin:0;font-size:0.88rem;color:var(--muted);";
    desc.textContent = list.description;
    card.appendChild(desc);
  }

  // Tags
  const tagList = Array.isArray(list.tags)
    ? list.tags
    : typeof list.tags === "string" && list.tags
      ? list.tags.split(",").map(t => t.trim()).filter(Boolean)
      : [];

  if (tagList.length) {
    const tagsEl = document.createElement("div");
    tagsEl.style.cssText = "display:flex;flex-wrap:wrap;gap:5px;margin-top:2px;";
    tagList.forEach(tag => {
      const chip = document.createElement("span");
      chip.style.cssText = `
        padding:3px 10px;border-radius:999px;font-size:0.75rem;font-weight:700;
        background:rgba(0,255,247,0.08);color:var(--accent);
        border:1px solid rgba(0,255,247,0.18);
      `;
      chip.textContent = tag;
      tagsEl.appendChild(chip);
    });
    card.appendChild(tagsEl);
  } else {
    const noTag = document.createElement("span");
    noTag.style.cssText = "font-size:0.75rem;color:var(--muted);font-style:italic;";
    noTag.textContent = "No tags";
    card.appendChild(noTag);
  }

  if (items.length) {
    const itemsEl = document.createElement("div");
    itemsEl.className = "admin-card-items";
    itemsEl.textContent = items.map(i => `${i.rank}. ${i.content}`).join("\n");
    card.appendChild(itemsEl);
  }

  if (list.rejection_reason) {
    const note = document.createElement("div");
    note.className = "admin-rejection-note";
    note.textContent = `Rejection reason: ${list.rejection_reason}`;
    card.appendChild(note);
  }

  const actions = document.createElement("div");
  actions.className = "admin-card-actions";
  card.appendChild(actions);

  if (adminState.tab === "adminPending") {
    // Tag button only if list has no tags
    const hasTags = tagList.length > 0;
    actions.append(
      makeBtn("✏️ Edit",    null,          () => openAdminEditor(list, items)),
      makeBtn("✅ Approve", "approve-btn", () => adminApprove(list.id)),
      makeBtn("❌ Reject",  "reject-btn",  () => openRejectModal(list.id)),
    );
    if (!hasTags) {
      actions.appendChild(makeBtn("🏷️ Add Tags", "tag-btn", () => openTagModal(list.id)));
    }
  }

  if (adminState.tab === "adminPublished") {
    const hasTags = tagList.length > 0;
    if (!hasTags) {
      actions.appendChild(makeBtn("🏷️ Add Tags", "tag-btn", () => openTagModal(list.id)));
    }
    actions.append(
      makeBtn("🗑 Delete", "danger-btn", () => adminDeleteForever(list.id)),
    );
  }

  if (adminState.tab === "adminRejected") {
    actions.append(
      makeBtn("↩️ Undo",   null,         () => adminUndoReject(list.id)),
      makeBtn("🗑 Delete", "danger-btn", () => adminDeleteForever(list.id)),
    );
  }

  return card;
}

function makeBtn(label, className, onClick) {
  const btn = document.createElement("button");
  btn.textContent = label;
  if (className) btn.className = className;
  btn.addEventListener("click", onClick);
  return btn;
}

// ── ACTIONS ───────────────────────────────────────────────────────────────────
async function adminApprove(id) {
  const { error } = await supabase.from("lists").update({
    visibility:       "PUBLISHED",
    rejection_reason: null,
    reviewed_at:      new Date().toISOString(),
    reviewed_by:      user.id,
  }).eq("id", id);
  if (error) { alert(error.message); return; }
  loadAdminTab();
}

let pendingRejectId = null;

function openRejectModal(id) {
  pendingRejectId = id;
  document.getElementById("rejectReasonInput").value = "";
  document.getElementById("rejectModalStatus").textContent = "";
  document.getElementById("adminRejectModal").style.display = "flex";
}

function closeRejectModal() {
  pendingRejectId = null;
  document.getElementById("adminRejectModal").style.display = "none";
}

async function confirmReject() {
  const reason    = document.getElementById("rejectReasonInput").value.trim();
  const statusEl  = document.getElementById("rejectModalStatus");
  const confirmBtn = document.getElementById("confirmReject");

  if (!reason) {
    statusEl.textContent = "Please provide a reason.";
    statusEl.style.color = "#ff8080";
    return;
  }

  confirmBtn.disabled    = true;
  confirmBtn.textContent = "Rejecting…";

  const { error } = await supabase.from("lists").update({
    visibility:       "PRIVATE",
    rejection_reason: reason,
    reviewed_at:      new Date().toISOString(),
    reviewed_by:      user.id,
  }).eq("id", pendingRejectId);

  confirmBtn.disabled    = false;
  confirmBtn.textContent = "Reject";

  if (error) {
    statusEl.textContent = error.message;
    statusEl.style.color = "#ff8080";
    return;
  }

  closeRejectModal();
  loadAdminTab();
}

async function adminUndoReject(id) {
  const { error } = await supabase.from("lists").update({
    visibility:       "PENDING",
    rejection_reason: null,
    reviewed_at:      null,
    reviewed_by:      null,
  }).eq("id", id);
  if (error) { alert(error.message); return; }
  loadAdminTab();
}

async function adminDeleteForever(id) {
  if (!confirm("Permanently delete this list? This cannot be undone.")) return;
  await supabase.from("list_items").delete().eq("list_id", id);
  const { error } = await supabase.from("lists").delete().eq("id", id);
  if (error) { alert(error.message); return; }
  loadAdminTab();
}

// ── EDIT MODAL ────────────────────────────────────────────────────────────────
let adminEditId = null;

// ── TAG TAXONOMY ─────────────────────────────────────────────────────────────
const TAG_TAXONOMY = {
  "Entertainment": ["Movies","TV Shows","Anime","Documentaries","Streaming","Comedy","Drama","Horror","Sci-Fi"],
  "Music":         ["Pop","Hip-Hop","Rock","Jazz","Classical","Electronic","R&B","Metal","Indie"],
  "Sports":        ["Football","Cricket","Basketball","Tennis","Formula 1","Baseball","Boxing","Olympics"],
  "Technology":    ["AI","Gadgets","Software","Gaming","Apps","Cybersecurity","Programming","Startups"],
  "Food & Drink":  ["Restaurants","Street Food","Desserts","Cocktails","Vegan","Fast Food","Coffee","World Cuisines"],
  "Travel":        ["Asia","Europe","Americas","Africa","Middle East","Beach","Adventure","Budget Travel","Luxury"],
  "Books":         ["Fiction","Non-Fiction","Sci-Fi","Mystery","Self-Help","Biography","Fantasy","History"],
  "Gaming":        ["PC","PlayStation","Xbox","Nintendo","Mobile","RPG","FPS","Strategy","Indie Games"],
  "Fashion":       ["Streetwear","Luxury","Sneakers","Accessories","Vintage","Athleisure","Sustainable Fashion"],
  "Lifestyle":     ["Health","Fitness","Mindfulness","Productivity","Home Decor","Relationships","Finance","Education"],
  "Cars & Bikes":  ["Supercars","SUVs","EVs","Motorcycles","Classic Cars","Off-Road","Trucks"],
  "Science":       ["Space","Biology","Physics","Climate","Medicine","Psychology","Engineering"],
};

// Current tag state for the open editor
let _adminPrimaryTag   = null;
let _adminSecondaryTag = null;

function buildTagPicker(existingTags) {
  // Parse existing tags — index 0 = primary, index 1 = secondary
  const existing = Array.isArray(existingTags)
    ? existingTags
    : typeof existingTags === "string" && existingTags
      ? existingTags.split(",").map(t => t.trim()).filter(Boolean)
      : [];

  _adminPrimaryTag   = existing[0] || null;
  _adminSecondaryTag = existing[1] || null;

  renderPrimaryPicker();
  renderSelectedTagsDisplay();
}

function renderPrimaryPicker() {
  const container = document.getElementById("adminPrimaryTags");
  container.innerHTML = "";

  Object.keys(TAG_TAXONOMY).forEach(category => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = category;
    btn.style.cssText = `
      padding:6px 12px;border-radius:999px;border:1px solid var(--panel-border);
      background:${_adminPrimaryTag === category ? "var(--accent-2)" : "var(--glass)"};
      color:${_adminPrimaryTag === category ? "#fff" : "var(--text)"};
      cursor:pointer;font-size:0.82rem;font-weight:700;font-family:inherit;
      transition:background 0.15s;
    `;

    btn.addEventListener("click", () => {
      // Toggle off if already selected
      if (_adminPrimaryTag === category) {
        _adminPrimaryTag   = null;
        _adminSecondaryTag = null;
        document.getElementById("adminSecondaryWrap").style.display = "none";
      } else {
        _adminPrimaryTag   = category;
        _adminSecondaryTag = null;
        renderSecondaryPicker(category);
        document.getElementById("adminSecondaryWrap").style.display = "block";
      }
      renderPrimaryPicker();
      renderSelectedTagsDisplay();
    });

    container.appendChild(btn);
  });

  // If a primary is already set, show the secondary picker
  if (_adminPrimaryTag && TAG_TAXONOMY[_adminPrimaryTag]) {
    renderSecondaryPicker(_adminPrimaryTag);
    document.getElementById("adminSecondaryWrap").style.display = "block";
  }
}

function renderSecondaryPicker(category) {
  const container = document.getElementById("adminSecondaryTags");
  container.innerHTML = "";

  (TAG_TAXONOMY[category] || []).forEach(tag => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = tag;
    btn.style.cssText = `
      padding:5px 11px;border-radius:999px;border:1px solid var(--panel-border);
      background:${_adminSecondaryTag === tag ? "rgba(0,255,247,0.15)" : "var(--glass)"};
      color:${_adminSecondaryTag === tag ? "var(--accent)" : "var(--muted)"};
      cursor:pointer;font-size:0.78rem;font-weight:600;font-family:inherit;
      border-color:${_adminSecondaryTag === tag ? "rgba(0,255,247,0.35)" : "var(--panel-border)"};
      transition:background 0.15s;
    `;

    btn.addEventListener("click", () => {
      _adminSecondaryTag = _adminSecondaryTag === tag ? null : tag;
      renderSecondaryPicker(category);
      renderSelectedTagsDisplay();
    });

    container.appendChild(btn);
  });
}

function renderSelectedTagsDisplay() {
  const el = document.getElementById("adminTagsSelected");
  if (!el) return;
  el.innerHTML = "";

  const tags = [_adminPrimaryTag, _adminSecondaryTag].filter(Boolean);

  if (!tags.length) {
    const hint = document.createElement("span");
    hint.style.cssText = "font-size:0.75rem;color:var(--muted);font-style:italic;";
    hint.textContent = "No tags selected";
    el.appendChild(hint);
    return;
  }

  const labels = ["Primary", "Secondary"];
  tags.forEach((tag, i) => {
    const chip = document.createElement("span");
    chip.style.cssText = `
      display:inline-flex;align-items:center;gap:5px;
      padding:4px 12px;border-radius:999px;font-size:0.78rem;font-weight:700;
      background:rgba(0,255,247,0.08);color:var(--accent);
      border:1px solid rgba(0,255,247,0.2);
    `;
    chip.innerHTML = `
      <span style="font-size:0.68rem;opacity:0.6;">${labels[i]}</span>
      ${tag}
    `;
    el.appendChild(chip);
  });
}

// ── EDITOR ───────────────────────────────────────────────────────────────────
function openAdminEditor(list, items) {
  adminEditId = list.id;
  document.getElementById("adminEditTitle").value         = list.title       || "";
  document.getElementById("adminEditDesc").value          = list.description || "";
  document.getElementById("adminModalStatus").textContent = "";

  // Build the tag picker with existing tags pre-selected
  buildTagPicker(list.tags);

  const itemsEl = document.getElementById("adminEditItems");
  itemsEl.innerHTML = "";
  (items.length ? items : [{ content: "" }]).forEach(i => adminAddItemRow(i.content));

  document.getElementById("adminEditModal").style.display = "flex";
}

function closeEditModal() {
  adminEditId        = null;
  _adminPrimaryTag   = null;
  _adminSecondaryTag = null;
  document.getElementById("adminEditModal").style.display = "none";
}

// ── TAG-ONLY MODAL ────────────────────────────────────────────────────────────
// Only accessible when list has no tags. Admin-only. Saves primary + secondary.

let _tagModalListId = null;
let _tagModalPrimary   = null;
let _tagModalSecondary = null;

function openTagModal(listId) {
  _tagModalListId    = listId;
  _tagModalPrimary   = null;
  _tagModalSecondary = null;
  document.getElementById("tagModalStatus").textContent   = "";
  document.getElementById("tagModalSecondaryWrap").style.display = "none";

  renderTagModalPrimary();
  renderTagModalSelected();

  document.getElementById("adminTagModal").style.display = "flex";
}

function closeTagModal() {
  _tagModalListId    = null;
  _tagModalPrimary   = null;
  _tagModalSecondary = null;
  document.getElementById("adminTagModal").style.display = "none";
}

function renderTagModalPrimary() {
  const container = document.getElementById("tagModalPrimary");
  container.innerHTML = "";

  Object.keys(TAG_TAXONOMY).forEach(category => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = category;
    btn.style.cssText = `
      padding:6px 12px;border-radius:999px;border:1px solid var(--panel-border);
      background:${_tagModalPrimary === category ? "var(--accent-2)" : "var(--glass)"};
      color:${_tagModalPrimary === category ? "#fff" : "var(--text)"};
      cursor:pointer;font-size:0.82rem;font-weight:700;font-family:inherit;
    `;
    btn.addEventListener("click", () => {
      if (_tagModalPrimary === category) {
        _tagModalPrimary   = null;
        _tagModalSecondary = null;
        document.getElementById("tagModalSecondaryWrap").style.display = "none";
      } else {
        _tagModalPrimary   = category;
        _tagModalSecondary = null;
        renderTagModalSecondary(category);
        document.getElementById("tagModalSecondaryWrap").style.display = "block";
      }
      renderTagModalPrimary();
      renderTagModalSelected();
    });
    container.appendChild(btn);
  });
}

function renderTagModalSecondary(category) {
  const container = document.getElementById("tagModalSecondary");
  container.innerHTML = "";

  (TAG_TAXONOMY[category] || []).forEach(tag => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = tag;
    btn.style.cssText = `
      padding:5px 11px;border-radius:999px;border:1px solid var(--panel-border);
      background:${_tagModalSecondary === tag ? "rgba(0,255,247,0.15)" : "var(--glass)"};
      color:${_tagModalSecondary === tag ? "var(--accent)" : "var(--muted)"};
      border-color:${_tagModalSecondary === tag ? "rgba(0,255,247,0.35)" : "var(--panel-border)"};
      cursor:pointer;font-size:0.78rem;font-weight:600;font-family:inherit;
    `;
    btn.addEventListener("click", () => {
      _tagModalSecondary = _tagModalSecondary === tag ? null : tag;
      renderTagModalSecondary(category);
      renderTagModalSelected();
    });
    container.appendChild(btn);
  });
}

function renderTagModalSelected() {
  const el = document.getElementById("tagModalSelected");
  if (!el) return;
  el.innerHTML = "";

  const tags = [_tagModalPrimary, _tagModalSecondary].filter(Boolean);
  if (!tags.length) {
    const hint = document.createElement("span");
    hint.style.cssText = "font-size:0.75rem;color:var(--muted);font-style:italic;";
    hint.textContent = "No tags selected yet";
    el.appendChild(hint);
    return;
  }

  const labels = ["Primary", "Secondary"];
  tags.forEach((tag, i) => {
    const chip = document.createElement("span");
    chip.style.cssText = `
      display:inline-flex;align-items:center;gap:5px;
      padding:4px 12px;border-radius:999px;font-size:0.78rem;font-weight:700;
      background:rgba(0,255,247,0.08);color:var(--accent);
      border:1px solid rgba(0,255,247,0.2);
    `;
    chip.innerHTML = `<span style="font-size:0.68rem;opacity:0.6;">${labels[i]}</span> ${tag}`;
    el.appendChild(chip);
  });
}

async function saveTagModal() {
  if (!_tagModalListId) return;

  const statusEl = document.getElementById("tagModalStatus");

  if (!_tagModalPrimary) {
    statusEl.textContent = "Please select a primary category.";
    statusEl.style.color = "#ff8080";
    return;
  }

  const saveBtn = document.getElementById("tagModalSave");
  saveBtn.disabled    = true;
  saveBtn.textContent = "Saving…";
  statusEl.textContent = "";

  const tags = [_tagModalPrimary, _tagModalSecondary].filter(Boolean);

  const { error } = await supabase
    .from("lists")
    .update({ tags, updated_at: new Date().toISOString() })
    .eq("id", _tagModalListId);

  saveBtn.disabled    = false;
  saveBtn.textContent = "💾 Save Tags";

  if (error) {
    statusEl.textContent = error.message;
    statusEl.style.color = "#ff8080";
    return;
  }

  closeTagModal();
  loadAdminTab();
}

function adminAddItemRow(value) {
  const itemsEl = document.getElementById("adminEditItems");
  const row     = document.createElement("div");
  row.className = "admin-item-row";

  const num = document.createElement("span");
  num.textContent = itemsEl.children.length + 1;

  const input = document.createElement("input");
  input.type        = "text";
  input.value       = value;
  input.placeholder = `Item ${itemsEl.children.length + 1}`;

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", () => {
    row.remove();
    [...itemsEl.children].forEach((r, i) => { r.querySelector("span").textContent = i + 1; });
  });

  row.append(num, input, removeBtn);
  itemsEl.appendChild(row);
}

async function adminSaveList(approve) {
  if (!adminEditId) return;

  const title       = document.getElementById("adminEditTitle").value.trim();
  const description = document.getElementById("adminEditDesc").value.trim();
  // Read tags from picker state — [primaryTag, secondaryTag] filtered of nulls
  const tags        = [_adminPrimaryTag, _adminSecondaryTag].filter(Boolean);
  const statusEl    = document.getElementById("adminModalStatus");

  if (!title) {
    statusEl.textContent = "Title is required.";
    statusEl.style.color = "#ff8080";
    return;
  }

  const inputs = document.querySelectorAll("#adminEditItems input");
  const items  = [...inputs]
    .map((inp, i) => ({ rank: i + 1, content: inp.value.trim() }))
    .filter(x => x.content);

  if (!items.length) {
    statusEl.textContent = "At least 1 item is required.";
    statusEl.style.color = "#ff8080";
    return;
  }

  const saveBtn = document.getElementById(approve ? "adminSaveApprove" : "adminSaveDraft");
  saveBtn.disabled    = true;
  saveBtn.textContent = approve ? "Approving…" : "Saving…";
  statusEl.textContent = "";

  const payload = {
    title,
    description: description || null,
    tags:        tags.length ? tags : null,
    updated_at:  new Date().toISOString(),
  };

  if (approve) {
    payload.visibility       = "PUBLISHED";
    payload.rejection_reason = null;
    payload.reviewed_at      = new Date().toISOString();
    payload.reviewed_by      = user.id;
  }

  const { error: listErr } = await supabase
    .from("lists").update(payload).eq("id", adminEditId);

  if (listErr) {
    statusEl.textContent = listErr.message;
    statusEl.style.color = "#ff8080";
    saveBtn.disabled    = false;
    saveBtn.textContent = approve ? "✅ Save & Approve" : "💾 Save only";
    return;
  }

  // Replace items
  await supabase.from("list_items").delete().eq("list_id", adminEditId);
  const rows = items.map(x => ({ list_id: adminEditId, rank: x.rank, content: x.content }));
  const { error: itemsErr } = await supabase.from("list_items").insert(rows);

  saveBtn.disabled    = false;
  saveBtn.textContent = approve ? "✅ Save & Approve" : "💾 Save only";

  if (itemsErr) {
    statusEl.textContent = itemsErr.message;
    statusEl.style.color = "#ff8080";
    return;
  }

  closeEditModal();
  loadAdminTab();
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
initAdminIfNeeded();