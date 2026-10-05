// Copies the page's static files (HTML, CSS) next to its compiled scripts in dist/page.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const from = new URL("../src/page/", import.meta.url).pathname;
const to = new URL("../dist/page/", import.meta.url).pathname;
mkdirSync(to, { recursive: true });
for (const name of readdirSync(from)) {
  if (/\.(html|css)$/.test(name)) copyFileSync(join(from, name), join(to, name));
}
