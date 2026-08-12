/**
 * Gzip/zlib helpers built on the platform's CompressionStream. Schematic files
 * are gzipped in practice, but plenty of tools emit them raw, so reads sniff
 * the header instead of trusting the extension.
 */

function toBlobPart(bytes: Uint8Array): BlobPart {
  return bytes.slice().buffer as ArrayBuffer;
}

async function run(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const piped = new Blob([toBlobPart(bytes)])
    .stream()
    .pipeThrough(stream as ReadableWritablePair<Uint8Array, Uint8Array>);
  const out = await new Response(piped).arrayBuffer();
  return new Uint8Array(out);
}

export type Compression = "gzip" | "deflate" | "none";

/** Identifies the wrapper around an NBT payload from its first two bytes. */
export function sniffCompression(bytes: Uint8Array): Compression {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return "gzip";
  // zlib: low nibble of byte 0 is 8 (deflate) and the two bytes form a
  // multiple of 31. A raw NBT stream starts with 0x0a, so there is no overlap.
  if (bytes.length >= 2 && (bytes[0] & 0x0f) === 0x08 && ((bytes[0] << 8) | bytes[1]) % 31 === 0) {
    return "deflate";
  }
  return "none";
}

export async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
  const kind = sniffCompression(bytes);
  if (kind === "none") return bytes;
  return run(bytes, new DecompressionStream(kind));
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return run(bytes, new CompressionStream("gzip"));
}
