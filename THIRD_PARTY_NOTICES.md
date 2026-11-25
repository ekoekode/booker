# Third-party notices

Booker is MIT licensed (see `LICENSE`). The built `main.js` bundles the following
components. Each is used under its permissive license. The release zips carry the full license texts in the `LICENSES/` folder; they are also in the upstream repositories.

| Component | Version | License | Use |
|---|---|---|---|
| [docx](https://github.com/dolanmiu/docx) | 9.14.0 | MIT | Word export |
| [JSZip](https://github.com/Stuk/jszip) | 3.10.2 | MIT (used under the MIT option of "MIT OR GPL-3.0-or-later") | ePub packaging, docx container |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT | PDF export |
| [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) | 1.1.1 | MIT | Font embedding and metrics for PDF |
| [pako](https://github.com/nodeca/pako) (via the above) | 1.0.11 | MIT and Zlib | Compression |
| [d3-scale](https://github.com/d3/d3-scale) and its d3 dependencies (d3-array, d3-format, d3-interpolate, d3-time, d3-time-format, d3-color) | 4.0.2 | ISC | Timeline axis ticks |
| @pdf-lib/standard-fonts, @pdf-lib/upng | 1.0.0 / 1.0.1 | MIT | PDF fonts and PNG decoding |
| tslib | 2.8.1 | 0BSD | TypeScript runtime helpers |
| [sql.js](https://github.com/sql-js/sql.js) | 1.x | MIT | Reading e-Sword, MySword and library databases (SQLite compiled to WebAssembly) |
| [stemmer](https://github.com/words/stemmer) | 3.x | MIT | Fuzzy word search |
| [@huggingface/tokenizers](https://github.com/huggingface/tokenizers.js) | 0.2.0 | Apache-2.0 | Reads each model's own tokenizer file (no network code is used) |
| [Literata](https://github.com/googlefonts/literata) | 3.x (Latin subset) | SIL Open Font License 1.1 | Embedded typeface in ePub and PDF |
| [IM Fell Double Pica](https://github.com/google/fonts/tree/main/ofl/imfelldoublepica) (Igino Marini) | unmodified | SIL Open Font License 1.1 | Chapter opening letter |
| [Jacquard 24](https://github.com/scfried/soft-type-jacquard) (The Soft Type Project Authors) | unmodified | SIL Open Font License 1.1 | Chapter opening letter |
| [Cinzel Decorative](https://github.com/google/fonts/tree/main/ofl/cinzeldecorative) (Natanael Gama) | unmodified | SIL Open Font License 1.1 | Chapter opening letter |

## Shipped beside the plugin (not inside `main.js`)

These sit in the plugin folder, in `runtime/`, `models/`, `dictionaries/` and (optional) `models-gen/`. They are used only on your computer. Booker goes online only when you press a Download button or check for updates (see Privacy in the README); none of these components makes network calls of its own.

| Component | Version | License | Use |
|---|---|---|---|
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) (`onnxruntime-node`, `onnxruntime-common`) | 1.31.1 | MIT | Runs the models natively on the CPU |
| [bge-micro-v2](https://huggingface.co/TaylorAI/bge-micro-v2) (TaylorAI), int8 ONNX | | MIT (stated on its model card) | Default model for searching by meaning. Distilled from bge-small-en-v1.5 |
| [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) (sentence-transformers; ONNX conversion by Xenova), int8 | | Apache-2.0 (stated on the conversion's model card) | Optional model |
| [bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5) (BAAI; ONNX conversion by Xenova), int8 | | MIT ("FlagEmbedding is licensed under the MIT License"; the conversion has no licence field of its own) | Optional model |
| [Open English WordNet](https://github.com/globalwordnet/english-wordnet) 2025 edition (`dictionaries/oewn-2025.tar.gz`: its four data files) | 2025 | CC BY 4.0 (Open English WordNet team), derived from Princeton WordNet under the WordNet licence | The English dictionary and thesaurus. Attribution to both, see below |
| [Moby Thesaurus II](https://www.gutenberg.org/ebooks/3202) (Grady Ward; `dictionaries/moby-thesaurus.txt.gz`, compressed and otherwise unchanged) | II | Public domain, by grant from the author | More synonyms for the Dictionary card and word suggestions |
| [Natural Earth](https://www.naturalearthdata.com) 1:10m and 1:50m land, lakes, rivers and borders (`basemap/natural-earth-10m.json.gz` and `natural-earth-50m.json.gz`: properties removed, coordinates rounded, compressed) | 5.1.2 | Public domain | The world map in the Map tab |
| [Leaflet](https://leafletjs.com) | 1.9.4 | BSD-2-Clause | Draws drawn maps and the real-world map when WebGL is not available (bundled in `main.js`) |
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) | 6.18.0 | BSD-3-Clause | Draws the Map tab (bundled in `main.js`; its source is patched so it makes no network requests) |
| [Qwen2.5-0.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct) (Alibaba Cloud Qwen team; ONNX conversion by onnx-community), 4-bit | | Apache-2.0 (stated on the original model card) | Optional writing-model pack: written summaries. Shipped as a separate zip in `models-gen/` |

The all-MiniLM-L6-v2 model is under the Apache License 2.0 (<https://www.apache.org/licenses/LICENSE-2.0>). The int8 files are quantized conversions of the original weights; no other changes were made. Licences were read from the model cards on 2026-10-27; check the cards again if you add or replace a model.

Development-only tools (not shipped): TypeScript, esbuild, vitest, yaml, marked.

## Literata

Copyright 2017 The Literata Project Authors. Licensed under the SIL Open Font License,
Version 1.1. The license text is in `assets/fonts/OFL.txt`. The font files in this
repository are Latin-only subsets of the original fonts, and are not sold on their
own. Documents you export with Booker embed the font, which the OFL permits.

## Open English WordNet and Princeton WordNet (shipped in `dictionaries/`)

The English dictionary and thesaurus is Open English WordNet, 2025 edition, which Booker adds to your library the first time it starts. Open English WordNet is Copyright (c) 2019-present, The Open English WordNet Team, and is licensed under the Creative Commons Attribution 4.0 International Licence (<http://creativecommons.org/licenses/by/4.0/>). It is derived from Princeton WordNet, which is Copyright 2011 by Princeton University (all rights reserved) and is used under the WordNet licence; the full text of both licences is in `dictionaries/LICENSES/` (`Open-English-WordNet-LICENSE.md` and `Princeton-WordNet-LICENSE.txt`) and must stay with the data. Princeton and the Open English WordNet team make no representations or warranties, and the name of Princeton University may not be used in advertising or publicity pertaining to distribution of the database. Booker reads the four data files (`data.noun`, `data.verb`, `data.adj`, `data.adv`) and keeps the first six senses of each word; the data itself is not changed. Booker also includes a short built-in list of richer words that is its own.

The older Princeton WordNet 3.0 can still be downloaded from the Resource manager (Copyright 2006 by Princeton University; the same WordNet licence and notice apply). When both are present Booker uses Open English WordNet.

## Moby Thesaurus II (shipped in `dictionaries/`)

Moby Thesaurus II, by Grady Ward, is "Public Domain material by grant from the author, January, 2001" (from its documentation notes, Project Gutenberg eBook #3202, <https://www.gutenberg.org/ebooks/3202>). The file `dictionaries/moby-thesaurus.txt.gz` is the unabridged main thesaurus file, compressed and otherwise unchanged. Its notice is in `dictionaries/LICENSES/Moby-Thesaurus-NOTICE.txt`.

## Natural Earth (shipped in `basemap/`)

The world map in the Map tab is drawn from Natural Earth (<https://www.naturalearthdata.com>), 1:10m physical and cultural vectors (land, lakes, rivers, country and state borders), version 5.1.2 from <https://github.com/nvkelso/natural-earth-vector>. Natural Earth is in the public domain; no permission or credit is required, and the notice is kept in `basemap/LICENSES/Natural-Earth-NOTICE.txt`. Booker removes the feature properties, rounds coordinates to 0.01 degree and compresses the result; `scripts/stage-basemap.mjs` checks each download against a pinned SHA-256.

## Leaflet (bundled)

Drawn maps, and the real-world map when WebGL is not available, are drawn with Leaflet 1.9.4, Copyright (c) 2010-2023, Volodymyr Agafonkin, and (c) 2010-2011, CloudMade. It is under the 2-Clause BSD licence (<https://github.com/Leaflet/Leaflet/blob/main/LICENSE>). No tile layers are used and nothing goes online.

## MapLibre GL JS (bundled)

The Map tab is drawn with MapLibre GL JS 6.18.0, Copyright (c) MapLibre contributors, under the 3-Clause BSD licence (<https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt>). Booker's build replaces its network code (`fetch` and `XMLHttpRequest`) with a throw, because every map file is read from the plugin folder.

## GeoNames place data (optional download)

If you press Download under "Maps" in the Resource manager, Booker fetches GeoNames data (<https://www.geonames.org>): `cities15000`, `admin1CodesASCII`, `countryInfo` and the postal-code file, licensed under Creative Commons Attribution 4.0 (<https://creativecommons.org/licenses/by/4.0/>). Booker uses them only on your computer, to turn a typed city, region or zip into coordinates. Credit: GeoNames, <https://www.geonames.org>.

## Not used

No code was copied from Templater (AGPL) or any GPL/AGPL plugin.
