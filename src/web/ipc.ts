// The Progress website (`web.html`, served by MTwin Manager's progress server) is the app's own
// Progress page in a browser. Its backend calls go to the server over HTTP instead of Tauri's IPC:
// the Progress commands to `/api/invoke`, the plugins to the browser's own clipboard and tabs.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const params = new URLSearchParams(location.search);
/** The shared link's key (a phone on the network); the page this PC serves has none. */
const key = params.get("key");
/** Given only to the page this PC serves: what may change things (`progress::WEB_WRITES`). */
const token = (window as { __MTWIN_WEB_TOKEN__?: string }).__MTWIN_WEB_TOKEN__ ?? "";

/** Read-only on a shared link; the server refuses the rest without the token. */
const COMMANDS = new Set([
  "progress_state",
  "progress_games",
  "progress_images",
  "progress_headshots",
  "progress_remove",
  "progress_catalog_save",
  "progress_collector_save",
  "progress_auto_delete",
  "progress_game_add",
  "progress_game_remove",
]);

async function call(cmd: string, args: unknown) {
  const r = await fetch(`/api/invoke${key ? `?key=${encodeURIComponent(key)}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Exec-Token": token } : {}) },
    body: JSON.stringify({ cmd, args: args ?? {} }),
  });
  const text = await r.text();
  const body = text ? JSON.parse(text) : null;
  // Errors arrive as the app's own AppError shape, so its messages show as in the app.
  if (!r.ok) throw body ?? { kind: "internal", message: `HTTP ${r.status}` };
  return body;
}

export function installWebIpc() {
  mockWindows("main");
  mockIPC(async (cmd, args) => {
    if (COMMANDS.has(cmd)) return call(cmd, args);
    const a = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "plugin:clipboard-manager|write_text":
        await navigator.clipboard.writeText(String(a.text ?? ""));
        return null;
      case "plugin:opener|open_url":
        window.open(String(a.url), "_blank", "noopener");
        return null;
      case "plugin:event|listen":
        return 0;
      case "plugin:event|unlisten":
      case "plugin:event|emit":
        return null;
      // No accounts of this PC on the website: the page shows what the reporters send.
      case "accounts_list":
      case "accounts_headshots":
      case "groups_list":
        return [];
      case "debug_log":
      case "ui_heartbeat":
        return null;
      default:
        console.debug("website: no", cmd);
        return null;
    }
  });
}
