// index.js
// Home page:
// - Search redirects to results.html
// - Theme toggle
// - Supabase auth login/register
// - Redirect to dashboard if already logged in

import { getSupabase } from "./supabase.js";

const supabase = await getSupabase();

const authOpen = document.getElementById("authOpen");
const authClose = document.getElementById("authClose");
const authPanel = document.getElementById("authPanel");
const authOverlay = document.getElementById("authOverlay");
const switchAuth = document.getElementById("switchAuth");
const authTitle = document.getElementById("authTitle");
const authPrimaryBtn = document.getElementById("authPrimaryBtn");
const authForm = document.getElementById("authForm");
const authStatus = document.getElementById("authStatus");

const authEmail      = document.getElementById("authEmail");
const authPassword   = document.getElementById("authPassword");
const comingSoonView = document.getElementById("comingSoonView");
const switchWrap     = document.getElementById("switchWrap");

let isLogin = true;

// ---------------- UI OPEN/CLOSE ----------------
authOpen.onclick = () => {
  authPanel.classList.add("open");
  authOverlay.classList.add("open");
};

authClose.onclick = closeAuth;
authOverlay.onclick = closeAuth;

function closeAuth() {
  authPanel.classList.remove("open");
  authOverlay.classList.remove("open");
  authStatus.textContent = "";
  // Always reset to login view on close
  if (!isLogin) showLoginView();
}

// ---------------- COMING SOON SWITCH ----------------
// Registration is not open yet — show Coming Soon instead of a register form.

function showLoginView() {
  isLogin = true;
  authTitle.textContent        = "Welcome back";
  authForm.style.display       = "flex";
  comingSoonView.style.display = "none";
  switchWrap.style.display     = "block";
  switchAuth.textContent       = "Create one";
  authStatus.textContent       = "";
}

function showComingSoonView() {
  isLogin = false;
  authTitle.textContent        = "Coming soon";
  authForm.style.display       = "none";
  comingSoonView.style.display = "flex";
  switchWrap.style.display     = "block";
  switchAuth.textContent       = "← Back to login";
  authStatus.textContent       = "";
}

switchAuth.onclick = () => {
  isLogin ? showComingSoonView() : showLoginView();
};

// ---------------- SEARCH ----------------
(function () {
  const input = document.getElementById("searchInput");
  const btn = document.getElementById("searchBtn");
  const quicks = document.querySelectorAll(".quick");
  const themeBtn = document.getElementById("themeToggle");

  function goSearch(q) {
    if (!q) return;
    const url = `results.html?q=${encodeURIComponent(q.trim())}`;
    window.location.href = url;
  }

  btn.addEventListener("click", () => goSearch(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") goSearch(input.value);
  });

  quicks.forEach((b) =>
    b.addEventListener("click", () => goSearch(b.dataset.q))
  );

  // Theme toggle
  const root = document.documentElement;
  const stored = localStorage.getItem("listem_theme");

  if (stored) root.setAttribute("data-theme", stored);

  function updateThemeIcon() {
    themeBtn.textContent =
      root.getAttribute("data-theme") === "dark" ? "☀️" : "🌑";
  }

  updateThemeIcon();

  themeBtn.addEventListener("click", () => {
    const newTheme =
      root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", newTheme);
    localStorage.setItem("listem_theme", newTheme);
    updateThemeIcon();
  });
})();

// ---------------- AUTH SUBMIT ----------------
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  // Registration is not open — only login allowed
  if (!isLogin) return;

  const email    = authEmail.value.trim();
  const password = authPassword.value;

  if (!email || !password) return;

  authPrimaryBtn.disabled = true;
  authStatus.textContent  = "Logging in…";

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) throw error;

    authStatus.textContent = "Logged in!";
    window.location.href   = "dashboard.html";
  } catch (err) {
    console.error(err);
    authStatus.textContent  = err.message || "Auth failed.";
    authStatus.style.color  = "#ff7070";
  } finally {
    authPrimaryBtn.disabled = false;
  }
});

// ---------------- AUTO REDIRECT IF LOGGED IN ----------------
(async function () {
  const { data } = await supabase.auth.getSession();
  if (data?.session) {
    authOpen.textContent = "Dashboard";
    authOpen.onclick = () => (window.location.href = "dashboard.html");
  }
})();