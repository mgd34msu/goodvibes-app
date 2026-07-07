// Minimal store-only (uncompressed) ZIP writer — docs/GAPS.md §11 row 5
// ("Reviewer handoff ZIP archives"). No dependency, no deflate: every entry
// is written with compression method 0 ("store"). This is a fully valid ZIP
// — any unzip tool opens it — the only cost is size, and every entry this
// view writes is markdown/JSON text for a handful of document versions, so
// that cost is negligible. Deliberately not implementing DEFLATE keeps this
// file small and dependency-free, which is the explicit trade-off the task
// brief calls for ("store-only is fine and say so").

export interface ZipEntryInput {
  /** Path within the archive (forward slashes, no leading slash). */
  name: string;
  /** UTF-8 text content — this writer only handles text entries. */
  content: string;
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    const tableEntry = CRC_TABLE[(crc ^ byte) & 0xff] ?? 0;
    crc = tableEntry ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Pinned to the ArrayBuffer-backed overload (never SharedArrayBuffer) so
// these values are directly usable as a Blob part without a cast.
function u16(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value & 0xffff, true);
  return out;
}

function u32(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** DOS date/time fields ZIP headers require (local time, 2-second resolution). */
function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((Math.floor(date.getSeconds() / 2)) & 0x1f);
  const dosDate =
    (((Math.max(0, date.getFullYear() - 1980)) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, date: dosDate };
}

const VERSION_NEEDED = 20; // 2.0 — plain store + long-ish filenames
const UTF8_FLAG = 0x0800; // general purpose bit 11: filenames are UTF-8

/** Builds a store-only ZIP archive as a Blob (application/zip). */
export function createZip(entries: readonly ZipEntryInput[]): Blob {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(new Date());
  const localParts: Uint8Array<ArrayBuffer>[] = [];
  const centralParts: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = encoder.encode(entry.content);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const localHeader = concatBytes([
      u32(0x04034b50),
      u16(VERSION_NEEDED),
      u16(UTF8_FLAG),
      u16(0), // method: store
      u16(time),
      u16(date),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0), // extra field length
    ]);
    localParts.push(localHeader, nameBytes, dataBytes);

    const centralHeader = concatBytes([
      u32(0x02014b50),
      u16(VERSION_NEEDED), // version made by
      u16(VERSION_NEEDED), // version needed
      u16(UTF8_FLAG),
      u16(0), // method: store
      u16(time),
      u16(date),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0), // extra field length
      u16(0), // file comment length
      u16(0), // disk number start
      u16(0), // internal file attributes
      u32(0), // external file attributes
      u32(offset), // relative offset of local header
    ]);
    centralParts.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + dataBytes.length;
  }

  const centralDirOffset = offset;
  const centralDirBytes = concatBytes(centralParts);

  const endRecord = concatBytes([
    u32(0x06054b50),
    u16(0), // disk number
    u16(0), // disk with central directory start
    u16(entries.length), // entries on this disk
    u16(entries.length), // total entries
    u32(centralDirBytes.length),
    u32(centralDirOffset),
    u16(0), // comment length
  ]);

  return new Blob([...localParts, centralDirBytes, endRecord], { type: "application/zip" });
}

/** Triggers a browser download of a Blob (no native save dialog needed). */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
