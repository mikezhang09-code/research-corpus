// Copy pdf.js's runtime data files into public/pdfjs so the viewer can load
// them from our own origin. Runs before `next dev` / `next build` (see
// package.json), so the copy always matches the installed pdfjs-dist.
//
//   cmaps/          predefined Adobe CMaps — without them, text in PDFs that
//                   use non-embedded CJK fonts (e.g. UniGB-UCS2-H) does not
//                   render at all.
//   standard_fonts/ Symbol / ZapfDingbats when a PDF doesn't embed them.
//   wasm/           OpenJPEG (JPEG 2000), JBIG2 and qcms (ICC colour)
//                   decoders — without them, scanned pages built from
//                   JPX/JBIG2 images render blank.
//   iccs/           ICC profiles used by qcms.
//
// The output is gitignored; it is a build artefact of node_modules.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");

if (!existsSync(src)) {
  console.error("copy-pdfjs-assets: pdfjs-dist is not installed — run npm install first.");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "iccs"]) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
// wasm/: the decoders and their no-wasm fallbacks, but not quickjs — that is
// only for PDF scripting, which the viewer does not enable.
mkdirSync(join(dest, "wasm"));
for (const f of readdirSync(join(src, "wasm"))) {
  if (f.startsWith("quickjs")) continue;
  cpSync(join(src, "wasm", f), join(dest, "wasm", f));
}
console.log("copy-pdfjs-assets: public/pdfjs ready");
