// Copies onnxruntime-node for one platform into <out>/runtime/<platform>-<arch>/node_modules/.
// usage: node scripts/stage-runtime.mjs <node_modules dir with onnxruntime-node> <out> <platform> <arch>
import fs from "node:fs";
import path from "node:path";

const [, , nm, out, platform, arch] = process.argv;
const base = path.join(out, "runtime", `${platform}-${arch}`, "node_modules");
const copy = (from, to, filter) => fs.cpSync(from, to, { recursive: true, filter });
fs.rmSync(base, { recursive: true, force: true });
const node = path.join(nm, "onnxruntime-node");
copy(node, path.join(base, "onnxruntime-node"), (p) => {
  const rel = path.relative(node, p).split(path.sep).join("/");
  if (rel.startsWith("bin/napi-v6/")) return rel === "bin/napi-v6" || rel.startsWith(`bin/napi-v6/${platform}`) && (rel === `bin/napi-v6/${platform}` || rel.startsWith(`bin/napi-v6/${platform}/${arch}`));
  return !rel.startsWith("script") && !rel.endsWith(".map");
});
copy(path.join(nm, "onnxruntime-common"), path.join(base, "onnxruntime-common"), (p) => !p.endsWith(".map"));
console.log("staged runtime", platform, arch);
