// index.js — Listroh search page

(function () {
  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');
  const quicks = document.querySelectorAll('.quick');
  const themeBtn = document.getElementById('themeToggle');

  function goSearch(q) {
    if (!q) return;
    const url = `results.html?q=${encodeURIComponent(q.trim())}`;
    window.location.href = url;
  }

  btn.addEventListener('click', () => goSearch(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') goSearch(input.value);
  });

  quicks.forEach(b => b.addEventListener('click', () => goSearch(b.dataset.q)));

  // Theme toggle
  const root = document.documentElement;
  const stored = localStorage.getItem('listem_theme');

  if (stored) root.setAttribute('data-theme', stored);

  function updateThemeIcon() {
    themeBtn.textContent =
      root.getAttribute('data-theme') === 'dark' ? '☀️' : '🌑';
  }

  updateThemeIcon();

  themeBtn.addEventListener('click', () => {
    const newTheme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', newTheme);
    localStorage.setItem('listem_theme', newTheme);
    updateThemeIcon();
  });
})();
