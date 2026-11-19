// Solmar City — open-world crime game, gta6-01 entry.
// Entrypoint (Node 22, standard library only, no build step, no dependencies):
// copies game/ and screenshots/ from beside this file into the output directory
// (MAKEFUN_OUTPUT_DIR, or /output), then writes dossier.json there with the
// vendored make.fun library, and prints the output directory.
//
// Outside the grader's container:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node --experimental-strip-types main.ts
// (Node 22.18+ runs .ts directly without the flag; the flag keeps it explicit.)

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The directory this file lives in, so paths hold wherever the process runs.
const here = dirname(fileURLToPath(import.meta.url));

// Where the entry lands: the grader's /output, or MAKEFUN_OUTPUT_DIR outside it.
const out = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// Copy a directory's contents recursively into dest (which may not exist yet).
// Symlinks are followed; every entry becomes a plain file or directory, as the
// platform counts game/ as plain files and directories only.
function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    if (statSync(from).isDirectory()) {
      copyTree(from, to);
    } else {
      copyFileSync(from, to);
    }
  }
}

// 1. game/ always comes along: the playable game, static files a desktop browser
// loads offline (game/index.html and its modules, assets, any vendored library).
copyTree(join(here, 'game'), join(out, 'game'));

// 2. screenshots/ comes along when the maker took them; skip silently if absent.
if (existsSync(join(here, 'screenshots'))) {
  copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
}

// 3. The dossier the judge reads: buildDossier summarizes game/ and screenshots/
// in the copied output directory. The caps are the bounty's own gate limits —
// only text_max_bytes shapes the bytes; the rest refuse an entry the scorer
// would refuse. The function returns canonical JSON bytes, written verbatim.
const dossierBytes = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(out, 'dossier.json'), dossierBytes);

// 4. One short line naming the output directory.
console.log(`built ${out}`);
