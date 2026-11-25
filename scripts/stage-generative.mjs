// Copies the writing model (Qwen2.5-0.5B-Instruct, 4-bit ONNX) into <out>/models-gen/<id>/.
// usage: node scripts/stage-generative.mjs <dir with the model files> <out>
// The source dir holds: onnx/model_q4.onnx, tokenizer.json, tokenizer_config.json, config.json, generation_config.json.
import fs from "node:fs";
import path from "node:path";

const [, , src, out] = process.argv;
const id = "qwen2.5-0.5b-instruct";
const to = path.join(out, "models-gen", id);
fs.mkdirSync(to, { recursive: true });
fs.copyFileSync(path.join(src, "onnx", "model_q4.onnx"), path.join(to, "model_q4.onnx"));
for (const f of ["tokenizer.json", "tokenizer_config.json", "config.json", "generation_config.json"]) fs.copyFileSync(path.join(src, f), path.join(to, f));
fs.copyFileSync(path.join("models-gen-src", id, "model.json"), path.join(to, "model.json"));
console.log("staged", id);
