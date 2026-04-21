import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

let supabaseClient = null;

// Render free tier cold starts can take 10-30 seconds.
// Retry up to 5 times with increasing delays (2s, 4s, 6s, 8s, 10s = 30s total).
async function fetchConfig(retries = 5, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch("/config");

      // Server returned a config error (e.g. missing env vars)
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Server configuration incomplete.");
      }

      if (res.ok) {
        const cfg = await res.json();
        return cfg;
      }

      throw new Error(`Config request failed (HTTP ${res.status})`);
    } catch (err) {
      if (attempt === retries) throw err;
      // Show a countdown so the user knows something is happening
      updateRetryMessage(attempt, retries, delayMs * attempt);
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
}

function updateRetryMessage(attempt, total, waitMs) {
  const el = document.getElementById("_supabase_retry_msg");
  if (el) {
    el.textContent = `Connecting… attempt ${attempt} of ${total}. Retrying in ${waitMs / 1000}s.`;
  }
}

export async function getSupabase() {
  if (supabaseClient) return supabaseClient;

  try {
    const cfg = await fetchConfig();

    if (!cfg?.supabaseUrl || !cfg?.supabaseAnonKey) {
      throw new Error(
        "Invalid config: SUPABASE_URL or SUPABASE_ANON_KEY is missing. " +
        "Check your environment variables in the Render dashboard."
      );
    }

    supabaseClient = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return supabaseClient;
  } catch (err) {
    // Show a clear, actionable error page instead of a blank screen
    document.body.innerHTML = `
      <div style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        min-height:100vh;font-family:system-ui,sans-serif;background:#0a0a0f;color:#f3f6f8;
        gap:16px;padding:24px;text-align:center;
      ">
        <p style="font-size:2.5rem;margin:0;">⚠️</p>
        <h2 style="margin:0;color:#00fff7;">Unable to connect</h2>
        <p style="color:#9aa0a6;max-width:440px;line-height:1.6;">
          ${
            err.message.includes("SUPABASE") || err.message.includes("configuration")
              ? "The server is missing its configuration. Make sure <strong style='color:#f3f6f8;'>SUPABASE_URL</strong> and <strong style='color:#f3f6f8;'>SUPABASE_ANON_KEY</strong> are set in your Render environment variables."
              : "The server is taking too long to respond. This can happen on a cold start — please wait a moment and try again."
          }
        </p>
        <button onclick="location.reload()" style="
          margin-top:4px;padding:12px 28px;border-radius:12px;border:none;
          background:#00fff7;color:#001;font-weight:700;cursor:pointer;font-size:1rem;
        ">Retry</button>
        <p style="color:#444;font-size:0.78rem;max-width:400px;">${err.message}</p>
      </div>
    `;
    throw err;
  }
}