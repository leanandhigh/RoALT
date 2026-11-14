import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "../styles/thai.css";
import "../theme.css";
import "./web.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { installWebIpc } from "./ipc";
import { ACCENT_KEY, BRAND_ACCENT, THEME_KEY, applyAccent } from "../app/theme";
import { loadLastLang, t } from "../i18n";
import { queryClient } from "../data";
import { installReactive, installReducedMotion, MotionRoot } from "../ui/motion";
import { Toaster } from "../ui/Toast";
import { TooltipHost } from "../ui/Tooltip";
import { Icon } from "../ui/Icon";
import { ProgressView } from "../features/progress/ProgressView";
import { RunScript } from "./RunScript";

const TOKEN = (window as { __MTWIN_WEB_TOKEN__?: string }).__MTWIN_WEB_TOKEN__ ?? "";

(window as { __MTWIN_WEB__?: boolean }).__MTWIN_WEB__ = true;
installWebIpc();

function applyTheme(theme: "dark" | "light") {
  const root = document.documentElement;
  root.dataset.theme = theme;
  let accent = BRAND_ACCENT;
  try {
    const stored = localStorage.getItem(ACCENT_KEY);
    if (stored && /^#[0-9a-f]{6}$/i.test(stored)) accent = stored;
  } catch {
    // No storage: MTwin red.
  }
  applyAccent(accent, theme);
}
const stored = (() => {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
})();
const initial: "dark" | "light" = stored === "light" || stored === "dark" ? stored : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
applyTheme(initial);
installReducedMotion();
installReactive();
await loadLastLang();

/** The website: a slim bar (the mark, the light/dark switch) over the app's own Progress page. */
function Web() {
  const [theme, setTheme] = useState(initial);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Kept for this visit only.
    }
  }, [theme]);
  return (
    <div className="web">
      <header className="web-bar">
        <img className="web-mark" src="/logo.png" alt="" width={24} height={24} />
        <b>MTwin Progress</b>
        <span className="web-sp" />
        {TOKEN && (
          <button type="button" className="btn btn-ghost btn-md" onClick={() => setRunning(true)}>
            <Icon name="terminal" size={16} />
            Run script
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-md" aria-label={t("settings.theme")} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
        </button>
      </header>
      <ProgressView accounts={[]} />
      {TOKEN && <RunScript open={running} onClose={() => setRunning(false)} token={TOKEN} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionRoot>
        <Web />
        <Toaster />
        <TooltipHost />
      </MotionRoot>
    </QueryClientProvider>
  </StrictMode>,
);
