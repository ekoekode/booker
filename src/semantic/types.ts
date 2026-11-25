/** Turns text into vectors. Two vectors that point the same way mean the texts say similar things. */
export interface Embedder {
  /** the model it runs, e.g. "bge-micro-v2" */
  readonly model: string;
  readonly dim: number;
  /** "native" (onnxruntime-node) or "wasm" */
  readonly backend: "native" | "wasm";
  /** Vectors are unit length, one per text, in the order given. */
  embed(texts: string[], progress?: (done: number, total: number) => void): Promise<Float32Array[]>;
  dispose(): Promise<void>;
}

export type Pooling = "mean" | "cls";

/** What a model folder says about itself (model.json). */
export interface ModelInfo {
  id: string;
  label: string;
  dim: number;
  pooling: Pooling;
  /** the longest text the model reads, in tokens */
  maxTokens: number;
  /** text put before a search query (some models want it) */
  queryPrefix: string;
  /** the model file inside the folder */
  file: string;
  license: string;
  /** bump to throw away saved vectors when the way text is prepared changes */
  version: number;
}
