// Packs dist/ into release/usc-schedule-maker.zip (the installable, committed build).
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const OUT = join(ROOT, "release", "usc-schedule-maker.zip");
// Fixed timestamp so rebuilding identical sources gives an identical zip.
const MTIME = new Date("2026-01-01T00:00:00Z");

if (!existsSync(join(DIST, "manifest.json"))) {
  console.error("dist/manifest.json missing - run `npm run build` first.");
  process.exit(1);
}

const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files[relative(DIST, full).split(sep).join("/")] = [readFileSync(full), { mtime: MTIME }];
  }
};
walk(DIST);

for (const required of ["manifest.json", "index.html", "content.js", "background.js"]) {
  if (!files[required]) {
    console.error(`dist/${required} missing - the build is incomplete.`);
    process.exit(1);
  }
}

mkdirSync(dirname(OUT), { recursive: true });
const zip = zipSync(files, { level: 9 });
writeFileSync(OUT, zip);
console.log(`${relative(ROOT, OUT)}: ${Object.keys(files).length} files, ${(zip.length / 1024).toFixed(1)} KiB`);
