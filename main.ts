// Solmar City — an original top-down open-world crime game.
//
// This is the entrypoint that hands the game in to the make.fun scorer: it
// copies this repository's game/ and screenshots/ folders into the output
// directory, then writes the scorer's dossier.json. It runs under Node 22
// with no flags, no install and no network, and writes byte-identical output
// on every run (no timestamps, randomness, or absolute paths are embedded).

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The directory this file lives in (the repository root).
const here = dirname(fileURLToPath(import.meta.url));

// Where the output goes: MAKEFUN_OUTPUT_DIR when set, /output otherwise.
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// Copy every entry of `src` into `dest`, creating `dest` first. Copying the
// entries (not the directory itself) keeps the destination layout exact and
// independent of whether `dest` already exists.
function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    cpSync(join(src, entry), join(dest, entry), { recursive: true, dereference: true });
  }
}

mkdirSync(outputDir, { recursive: true });

// The playable game, as static files, at output/game.
copyDir(join(here, 'game'), join(outputDir, 'game'));

// The screenshots at output/screenshots; the output folder is created even
// when the source screenshots folder is absent, but is only filled when it is.
const screenshotsSrc = join(here, 'screenshots');
const screenshotsDest = join(outputDir, 'screenshots');
mkdirSync(screenshotsDest, { recursive: true });
if (existsSync(screenshotsSrc)) {
  copyDir(screenshotsSrc, screenshotsDest);
}

// The dossier the scorer checks against, as canonical JSON bytes.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
// Assembles the final game deliverable for the make.fun scorer.
