# Abstractive summaries: plan (not built)

Extractive summaries (0.42.0) pick the author's own sentences. Abstractive summaries write new sentences, so they need a small generative model. This is the plan, written 2026-10-27 before any building. Nothing here has been measured on this machine yet.

## Recommendation

Run **Qwen2.5-1.5B-Instruct (4-bit ONNX)** inside the plugin with the `onnxruntime-node` engine that is already shipped, and offer **Qwen2.5-0.5B-Instruct** as the fast choice. Ship them as a separate optional pack, not in the main zip.

Why this route:
- No new runtime, no new native code, no new licence: the engine, the tokenizer library and the "no network" guarantee stay as they are.
- It keeps one engine to support and test, and it runs in Obsidian's own process like the embedding models already do.
- The cost is that Booker must write the generation loop itself (feed tokens, carry the key/value cache, pick the next token). That is the main build risk.

## The options

| Option | Model files | Licence | Speed | Fit |
|---|---|---|---|---|
| **A. ONNX generation loop on onnxruntime-node (recommended)** | Qwen2.5-0.5B q4 786 MB, int8 512 MB; Qwen2.5-1.5B q4 1.79 GB, int8 1.58 GB (onnx-community conversions) | Qwen2.5 0.5B and 1.5B are Apache-2.0 | Not measured. My guess: 1.5B in the tens of tokens a second, 0.5B several times faster | Same engine as search. Needs the loop written |
| B. node-llama-cpp with GGUF | Qwen2.5-1.5B Q4_K_M 1.12 GB; SmolLM2-1.7B Q4_K_M 1.06 GB | node-llama-cpp is MIT; both models Apache-2.0 | Fastest (llama.cpp, Apple GPU) | The library's docs say it must run in Electron's **main process** and crashes in a renderer, which is where plugins run. It would need a helper process, and whether Obsidian allows that is untested. Adds a second native engine |
| C. Phi-3.5-mini ONNX (Microsoft) | about 2 GB or more at 4-bit | MIT | Slower (3.8B) | I found no Node.js binding for its runtime, so it would also need the loop from A, with a bigger model |
| D. Summarisation-only models (T5, BART families) | not researched | not researched | | Would need its own loop too, and writes less flexibly |

Left out on purpose: **Qwen2.5-3B** (its licence is "qwen-research", not open for this use) and **Llama 3.2** (its community licence has conditions; I did not verify it, so I would not ship it).

## What I confirmed and what I did not

Confirmed from the pages themselves: Qwen2.5-1.5B-Instruct GGUF is apache-2.0; the SmolLM2-1.7B-Instruct GGUF is apache-2.0; Qwen2.5-3B-Instruct is qwen-research; the file sizes in the table; node-llama-cpp's Electron main-process rule; Phi-3.5-mini ONNX is MIT.

Not confirmed: the licence field of the onnx-community Qwen2.5 conversions (the pages I read did not show one, the base model is Apache-2.0, so read the cards before shipping); the 0.5B model's own licence page; any speed number; summary quality on your writing.

## Design

- **A separate pack.** `models-gen/<id>/` in the plugin folder: model file, tokenizer files, a small `model.json`. A pack zip adds 0.8 to 1.8 GB, so it is never in the main zip. Without a pack the summary window offers only extractive, as now.
- **Long texts.** Pick the 20 or so most central sentences with the existing extractive step, then have the model write from those. That keeps the prompt short and fast, and it reuses what is built.
- **Honesty in the interface.** Abstractive output is labelled as written by the model, shown next to the sentences it came from, and never inserted without the label. Extractive stays the default because it cannot invent anything.
- **Output control.** Greedy decoding at low temperature, a length limit, and the instruction to use only the given text.
- **Licences.** Add the model and its licence text to `THIRD_PARTY_NOTICES.md` and the pack's own folder.

## Steps and the gate

1. **Measure.** Download the two ONNX models once on this machine (about 0.8 GB and 1.8 GB) and time a plain generation script outside Obsidian, then inside the isolated Obsidian. Gate: 1.5B writes a 150-word summary in well under half a minute and the result is usable. If not, 0.5B only, or reconsider option B.
2. Write and test the generation loop (pure parts unit-tested).
3. Add the mode to the summary window, with the labelling above.
4. Pack script (`scripts/stage-generative.mjs`) and a pack zip; Mac only.
5. Notices, guide text, version, rebuild the Mac packages.
