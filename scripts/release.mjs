import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);
const readJSON = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const manifest = await readJSON("public/manifest.json");
const pkg = await readJSON("package.json");
if (manifest.version !== pkg.version)
  throw new Error("Release versions differ.");
const sources = await readJSON("store/dependency-sources.json");
const lock = await readJSON("package-lock.json");
const production = Object.entries(lock.packages)
  .filter(([name, info]) => name && !info.dev && !info.optional)
  .map(([name]) => name);
if (
  production.length !== sources.length ||
  sources.some(
    (p) => lock.packages[`node_modules/${p.name}`]?.version !== p.version,
  )
) {
  throw new Error(
    "Update store/dependency-sources.json for the locked dependencies.",
  );
}
for (const dependency of sources) {
  const installed = await readJSON(
    `node_modules/${dependency.name}/package.json`,
  );
  if (installed.version !== dependency.version)
    throw new Error("Run npm ci first.");
}
execFileSync(process.execPath, ["build.mjs"], { stdio: "inherit" });
await fs.mkdir("release", { recursive: true });
await fs.mkdir(".source-cache", { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "matrix-stats-release-"));
try {
  const source = path.join(temp, "source");
  await fs.mkdir(source);
  for (const file of [
    "src",
    "public",
    "scripts",
    "tests",
    "store",
    "build.mjs",
    "package.json",
    "package-lock.json",
    "playwright.config.js",
    "README.md",
    "FUNCTIONS.md",
    "LICENSE",
  ]) {
    await fs.cp(file, path.join(source, file), {
      recursive: true,
      filter: (file) => path.basename(file) !== ".DS_Store",
    });
  }
  await fs.mkdir(path.join(source, "upstream"));
  for (const dependency of sources) {
    const filename = `${dependency.name}-${dependency.version}.tar.gz`;
    const cached = path.join(".source-cache", filename);
    let data;
    try {
      data = await fs.readFile(cached);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const response = await fetch(dependency.url, {
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok)
        throw new Error(
          `Source download failed: ${dependency.name} (${response.status})`,
        );
      data = Buffer.from(await response.arrayBuffer());
    }
    const hash = createHash("sha256").update(data).digest("hex");
    if (hash !== dependency.sha256)
      throw new Error(`Source checksum mismatch: ${dependency.name}`);
    await fs.writeFile(cached, data);
    await fs.writeFile(path.join(source, "upstream", filename), data);
    await fs.cp(
      `node_modules/${dependency.name}`,
      path.join(source, "node_modules", dependency.name),
      { recursive: true },
    );
  }
  await fs.writeFile(
    path.join(source, "SOURCE.md"),
    `# Source for Matrix & Stats Calculator ${manifest.version}\n\nThis archive includes the extension source, build scripts, tests, locked production packages, and upstream source archives. Dependency versions, source revisions and checksums are in store/dependency-sources.json. Upstream archives include original source and build files; installed packages are retained so the extension can be rebuilt using the exact published inputs. Dependencies are unmodified.\n\nUse Node.js 22 or newer and npm. From this directory run npm ci --ignore-scripts, then npm run build. Load dist at chrome://extensions with Developer mode enabled. npm test runs numerical and model tests; npx playwright install chromium and npm run test:ui run browser tests. npm run release also requires the zip command and network access to the pinned source archives (or a populated .source-cache).\n\nThe extension is GPL-3.0-only, provided without warranty. See LICENSE and dependency license files. This release includes the custom calculator UI and formula extensions; see src.\n`,
  );
  const sourceZip = path.join(root, "dist", "source.zip");
  execFileSync("zip", ["-q", "-r", sourceZip, "."], { cwd: source });
  const index = await fs.readFile("dist/index.html", "utf8");
  const close = '<form method="dialog"><button>Close</button></form>';
  if (index.split(close).length !== 2)
    throw new Error("Cannot locate Shortcuts dialog.");
  await fs.writeFile(
    "dist/index.html",
    index.replace(
      close,
      `<p>GPL-3.0-only. No warranty. <a href="LICENSE" target="_blank">License</a> · <a href="source.zip" download="matrix-stats-calculator-source-${manifest.version}.zip">Download source</a> · <a href="privacy.html" target="_blank">Privacy</a></p>\n        ${close}`,
    ),
  );
  const zip = path.resolve(
    "release",
    `matrix-stats-calculator-${manifest.version}.zip`,
  );
  await fs.rm(zip, { force: true });
  execFileSync("zip", ["-q", "-r", zip, "."], { cwd: path.join(root, "dist") });
  await fs.copyFile(
    sourceZip,
    path.join(
      "release",
      `matrix-stats-calculator-source-${manifest.version}.zip`,
    ),
  );
  const hash = createHash("sha256")
    .update(await fs.readFile(zip))
    .digest("hex");
  await fs.writeFile(`${zip}.sha256`, `${hash}  ${path.basename(zip)}\n`);
  console.log(`Upload package: ${zip}`);
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
