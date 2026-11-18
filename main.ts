// NEON HARBOR - the program that hands the game in (Node 22, standard library only).
//
// The game itself is the plain static site in game/ (open game/index.html in a browser and
// play; no build step, no network). This program copies game/ and screenshots/ into the
// output directory and writes dossier.json there with buildDossier from the vendored
// make.fun library, which is the summary the scorer checks and the judge reads.
//
// In the grader the output directory is /output; anywhere else MAKEFUN_OUTPUT_DIR names it:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Running it twice writes the same bytes both times: the copies are plain file copies and
// the dossier is a pure function of the files it summarises.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Copy the playable game exactly as it sits in the repository.
mkdirSync(join(outputDir, 'game'), { recursive: true });
cpSync(join(repoDir, 'game'), join(outputDir, 'game'), { recursive: true });

// Copy the screenshots the same way; the folder may hold 3 or 4 images, first by name is
// the cover the judge sees large.
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoDir, 'screenshots'))) {
  cpSync(join(repoDir, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

// The caps below are the scorer's own (see the kit's gate reference): the text budget is
// the only one that shapes bytes; the rest make this program refuse, here and now, an
// entry the scorer would refuse anyway - too many or too heavy screenshots, too many
// files under game/, or a path under game/ longer than the limit.
const dossierText = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossierText);
