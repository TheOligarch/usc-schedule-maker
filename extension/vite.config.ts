import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The React app. `npm run dev` serves it as a standalone page; `npm run build` emits
// dist/index.html, which the extension loads both as a full tab (toolbar icon) and
// inside the frame the content script mounts in WebReg.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 900,
  },
  // Import the schedule engine and the pure course-interest helpers from source.
  server: { port: 5173, fs: { allow: [".", "../engine", "../supabase/functions/_shared"] } },
});
