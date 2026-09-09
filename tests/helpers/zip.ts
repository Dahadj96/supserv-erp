import { deflateRawSync } from "node:zlib";

/**
 * A ZIP, written by hand, for tests.
 *
 * Shared because three test files need it and none of them can get what they
 * need from a zip tool: an entry named `../../.env`, a central directory that
 * understates a file by three orders of magnitude, an archive holding an
 * archive, and a .docx built part by part. Only the parts yauzl reads — a local
 * header and a payload per entry, then a central directory and an end record.
 * No zip64, no data descriptors.
 */

/** CRC-32, because a zip carries one per entry and yauzl checks it. */
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export type BuildEntry = {
  name: string;
  body: Buffer;
  /** 0 stored, 8 deflate. Deflate is how a bomb gets small. */
  method?: 0 | 8;
  /** Overrides the size written into both headers — the lie a bomb tells. */
  declaredSize?: number;
};

export function buildZip(entries: BuildEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? 0;
    const name = Buffer.from(entry.name, "utf8");
    const payload = method === 8 ? deflateRawSync(entry.body) : entry.body;
    const declared = entry.declaredSize ?? entry.body.byteLength;
    const crc = crc32(entry.body);

    const local = Buffer.alloc(30 + name.byteLength);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.byteLength, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28); // extra
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.byteLength);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.byteLength, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, payload);
    centrals.push(central);
    offset += local.byteLength + payload.byteLength;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}
