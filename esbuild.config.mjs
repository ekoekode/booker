import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

// Booker makes no network calls. sql.js ships an Emscripten loader that can fetch its wasm over HTTP; the wasm is
// always handed to it as bytes (src/scripture/sqlite.ts), so the fetch and XHR branches are replaced with a throw.
const noNetwork = {
  name: "no-network",
  setup(build) {
    build.onLoad({ filter: /sql\.js[\\/]dist[\\/]sql-wasm\.js$/ }, async (args) => {
      const { readFile } = await import("node:fs/promises");
      const src = await readFile(args.path, "utf8");
      const off = '(()=>{throw new Error("Booker makes no network requests")})';
      const out = src.replace(/new XMLHttpRequest/g, `${off}()`).replace(/\bfetch\(/g, `${off}(`);
      return { contents: out, loader: "js" };
    });
  },
};

// MapLibre (the Map tab) can load tiles and styles over HTTP and starts its worker from a URL. Booker gives it all its data directly
// (a GeoJSON basemap and the pins), so the fetch and XHR branches are replaced with a throw, and the worker's source is bundled as a
// string that the Map tab turns into a blob URL. `maplibre-worker-source` is that string.
const maplibre = {
  name: "maplibre",
  setup(build) {
    const off = '(()=>{throw new Error("Booker makes no network requests")})';
    const quiet = (src) => src.replace(/new XMLHttpRequest/g, `${off}()`).replace(/\bfetch\(/g, `${off}(`).replace(/import\.meta\.url/g, '""');
    build.onLoad({ filter: /maplibre-gl[\\/]dist[\\/]maplibre-gl\.mjs$/ }, async (args) => {
      const { readFile } = await import("node:fs/promises");
      return { contents: quiet(await readFile(args.path, "utf8")), loader: "js" };
    });
    build.onResolve({ filter: /^maplibre-worker-source$/ }, () => ({ path: "maplibre-worker-source", namespace: "maplibre-worker" }));
    build.onLoad({ filter: /.*/, namespace: "maplibre-worker" }, async () => {
      const { readFile } = await import("node:fs/promises");
      const src = await readFile("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "utf8");
      return { contents: `export default ${JSON.stringify(quiet(src))};`, loader: "js" };
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtins],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  outfile: "main.js",
  plugins: [noNetwork, maplibre],
  loader: { ".ttf": "binary", ".woff2": "binary", ".woff": "binary", ".png": "binary", ".wasm": "binary", ".css": "text" },
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
