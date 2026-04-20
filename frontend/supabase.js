import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

let supabaseClient = null;

async function fetchConfig(retries = 3, delayMs = 1200) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch("/config");
      if (res.ok) return res.json();
      throw new Error(`Config request failed (HTTP ${res.status})`);
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
}

export async function getSupabase() {
  if (supabaseClient) return supabaseClient;

  try {
    const cfg = await fetchConfig();

    if (!cfg?.supabaseUrl || !cfg?.supabaseAnonKey) {
      throw new Error("Invalid config received from server.");
    }

    supabaseClient = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return supabaseClient;
  } catch (err) {
    // Show a visible error banner instead of a blank page
    document.body.innerHTML = `
      <div style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        min-height:100vh;font-family:system-ui,sans-serif;background:#0a0a0f;color:#f3f6f8;
        gap:16px;padding:24px;text-align:center;
      ">
        <p style="font-size:2rem;">⚠️</p>
        <h2 style="margin:0;color:#00fff7;">Unable to connect</h2>
        <p style="color:#9aa0a6;max-width:400px;">
          The server is taking too long to respond. This sometimes happens on a cold start.
          Please wait a moment and try again.
        </p>
        <button onclick="location.reload()" style="
          margin-top:8px;padding:12px 24px;border-radius:12px;border:none;
          background:#00fff7;color:#001;font-weight:700;cursor:pointer;font-size:1rem;
        ">Retry</button>
        <p style="color:#555;font-size:0.8rem;">${err.message}</p>
      </div>
    `;
    throw err;
  }
}