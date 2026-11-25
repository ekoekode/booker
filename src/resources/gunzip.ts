/** Gunzip in memory. Node only (desktop app); kept in its own file so the bundler turns zlib into a require. */
import { gunzipSync } from "zlib";

export const gunzip = (bytes: Uint8Array): Uint8Array => gunzipSync(bytes);
