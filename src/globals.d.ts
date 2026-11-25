declare module "*.ttf" {
  const data: Uint8Array;
  export default data;
}

declare module "d3-scale" {
  export function scaleLinear(): {
    domain(d: [number, number]): { ticks(count?: number): number[] };
  };
}

declare module "*.wasm" {
  const data: Uint8Array;
  export default data;
}

declare module "*.woff" {
  const data: Uint8Array;
  export default data;
}

declare module "*.css" {
  const text: string;
  export default text;
}

declare module "maplibre-worker-source" {
  const source: string;
  export default source;
}

declare module "*.png" {
  const data: Uint8Array;
  export default data;
}
