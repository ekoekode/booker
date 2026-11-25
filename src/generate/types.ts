/** What a model folder in models-gen/ says about itself (model.json plus the numbers read from its config.json). */
export interface GenInfo {
  id: string;
  label: string;
  /** the model file inside the folder, e.g. model_q4.onnx */
  file: string;
  license: string;
  /** end-of-text token ids */
  eos: number[];
  layers: number;
  kvHeads: number;
  headDim: number;
  /** words the model reads comfortably in one go */
  chunkWords: number;
  /** measured on a Mac with Apple silicon; used to estimate the time of a job */
  promptTokensPerSec: number;
  outputTokensPerSec: number;
}
