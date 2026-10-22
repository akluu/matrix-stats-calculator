import { build } from "esbuild";
import fs from "node:fs/promises";
await fs.rm("dist", { recursive: true, force: true });
await fs.mkdir("dist", { recursive: true });
await fs.cp("public", "dist", { recursive: true });
const result = await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  outfile: "dist/app.js",
  format: "iife",
  target: ["chrome102"],
  minify: true,
  legalComments: "eof",
  metafile: true,
});
await fs.writeFile("build-meta.json", JSON.stringify(result.metafile));
await fs.mkdir("dist/licenses", { recursive: true });
const packages = new Set(
  Object.keys(result.metafile.inputs)
    .filter((p) => p.startsWith("node_modules/"))
    .map((p) =>
      p
        .split("/")
        .slice(1, p.split("/")[1].startsWith("@") ? 3 : 2)
        .join("/"),
    ),
);
for (const name of packages) {
  const files = (await fs.readdir(`node_modules/${name}`)).filter((f) =>
    /^(license|notice)(\.|$)/i.test(f),
  );
  for (const file of files)
    await fs.copyFile(
      `node_modules/${name}/${file}`,
      `dist/licenses/${name.replaceAll("/", "-")}-${file}`,
    );
}
await fs.copyFile("LICENSE", "dist/LICENSE");
console.log("Extension built in extension/dist");
