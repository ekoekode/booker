// Copies the int8 models into <out>/models/<id>/ with their tokenizer files and model.json.
// usage: node scripts/stage-models.mjs <dir holding the model folders> <out>
// The source dir needs, per model: <srcName>/onnx/model_quantized.onnx, tokenizer.json, tokenizer_config.json.
import fs from "node:fs";
import path from "node:path";

const [, , src, out] = process.argv;
const MAP = { "bge-micro-v2": "TaylorAI/bge-micro-v2", "all-MiniLM-L6-v2": "Xenova/all-MiniLM-L6-v2", "bge-small-en-v1.5": "Xenova/bge-small-en-v1.5" };
for (const [id, rel] of Object.entries(MAP)) {
  const to = path.join(out, "models", id);
  fs.mkdirSync(to, { recursive: true });
  const from = path.join(src, rel);
  fs.copyFileSync(path.join(from, "onnx", "model_quantized.onnx"), path.join(to, "model_quantized.onnx"));
  for (const f of ["tokenizer.json", "tokenizer_config.json"]) fs.copyFileSync(path.join(from, f), path.join(to, f));
  fs.copyFileSync(path.join("models-src", id, "model.json"), path.join(to, "model.json"));
  console.log("staged", id);
}
