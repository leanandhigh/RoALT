import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri expects a fixed port and must not have its output cleared.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  // Two pages: the app, and the Progress website the progress server serves (src/web).
  build: { target: "es2022", rollupOptions: { input: { main: "index.html", web: "web.html" } } },
  // One version, from package.json, for the About row and the footer.
  define: { "import.meta.env.APP_VERSION": JSON.stringify(JSON.parse(readFileSync("package.json", "utf8")).version) },
});
