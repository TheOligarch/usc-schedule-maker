import { defineConfig } from "vite";

// Content script and background service worker. Content scripts cannot be ES modules,
// so each is bundled on its own as a single self-contained file.
const entries: Record<string, { entry: string; fileName: string }> = {
  content: { entry: "src/content/content.ts", fileName: "content.js" },
  background: { entry: "src/background/background.ts", fileName: "background.js" },
};

export default defineConfig(({ mode }) => {
  const target = entries[mode];
  if (!target) throw new Error(`Unknown script build mode "${mode}"`);
  return {
    publicDir: false,
    build: {
      outDir: "dist",
      emptyOutDir: false,
      target: "es2022",
      lib: { entry: target.entry, formats: ["iife"], name: `usm_${mode}`, fileName: () => target.fileName },
    },
  };
});
