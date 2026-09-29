// A bounded structural exception for PDF Content Credentials (C2PA/JUMBF).
// This does not authenticate the signer or replace malware scanning.
const decodeName = (name: string) => name.replace(/#([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
const namePattern = /\/[^\s\x00()[\]<>/%]+/g;
const uuidTail = [0x00, 0x11, 0x00, 0x10, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];

function isManifestStore(bytes: Uint8Array): boolean {
  if (bytes.length < 64 || bytes.length > 4 * 1024 * 1024) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  let count = 0;
  type Box = { start: number; end: number; type: string; children: Box[] };
  const read = (start: number, limit: number, depth: number): Box | undefined => {
    if (++count > 4096 || depth > 16 || start + 8 > limit) return;
    const size = view.getUint32(start);
    // Extended/unspecified lengths are deliberately outside this exception.
    if (size < 8 || start + size > limit) return;
    const box: Box = { start, end: start + size, type: text(start + 4, 4), children: [] };
    if (box.type === 'jumb') {
      let position = start + 8;
      while (position < box.end) {
        const child = read(position, box.end, depth + 1);
        if (!child) return;
        box.children.push(child);
        position = child.end;
      }
      if (box.children[0]?.type !== 'jumd' || box.children[0].end - box.children[0].start < 25) return;
    }
    return box;
  };
  const hasUuid = (description: Box, prefix: string) =>
    text(description.start + 8, 4) === prefix &&
    uuidTail.every((value, index) => bytes[description.start + 12 + index] === value);
  const store = read(0, bytes.length, 0);
  if (!store || store.type !== 'jumb' || store.end !== bytes.length || store.children.length < 2) return false;
  const description = store.children[0];
  if (!hasUuid(description, 'c2pa') || description.end - description.start !== 30 ||
    bytes[description.start + 24] !== 3 || text(description.start + 25, 5) !== 'c2pa\0') return false;
  return store.children.slice(1).every(manifest => manifest.type === 'jumb' &&
    ['c2ma', 'c2cm', 'c2um'].some(prefix => hasUuid(manifest.children[0], prefix)));
}

export function hasUnsupportedPdfContent(bytes: Uint8Array, content: string): boolean {
  const embeddedNames: number[] = [];
  for (const token of content.matchAll(namePattern)) {
    const name = decodeName(token[0]);
    if (/^\/(JavaScript|JS|Launch|RichMedia|OpenAction|AA)$/.test(name)) return true;
    if (name === '/EmbeddedFile') embeddedNames.push(token.index!);
  }
  if (!embeddedNames.length) return false;
  if (embeddedNames.length > 16) return true;
  const permitted = new Set<number>();
  // Only direct, unfiltered streams with an unambiguous length are supported.
  // Other embedded files retain the existing rejection behavior.
  const streams = /(?:^|[\r\n])\d+[ \t]+\d+[ \t]+obj\s*<<([^<>]{1,2048})>>[ \t\r\n]*stream(?:\r\n|\n|\r)/g;
  for (const match of content.matchAll(streams)) {
    const tokens = match[1].trim().split(/\s+/).map(decodeName);
    if (tokens.length !== 6) continue;
    const fields = new Map<string, string>();
    for (let index = 0; index < tokens.length; index += 2) fields.set(tokens[index], tokens[index + 1]);
    if (fields.size !== 3 || fields.get('/Type') !== '/EmbeddedFile' ||
      fields.get('/Subtype') !== '/application/c2pa' || !/^\d+$/.test(fields.get('/Length') || '')) continue;
    const length = Number(fields.get('/Length'));
    const start = match.index! + match[0].length;
    const end = start + length;
    if (end > bytes.length || !/^(?:\r\n|\n|\r)endstream\s+endobj\b/.test(content.slice(end, end + 80)) ||
      !isManifestStore(bytes.subarray(start, end))) continue;
    const dictionaryStart = match.index! + match[0].indexOf('<<') + 2;
    for (const token of match[1].matchAll(namePattern)) {
      if (decodeName(token[0]) === '/EmbeddedFile') permitted.add(dictionaryStart + token.index!);
    }
  }
  return embeddedNames.some(position => !permitted.has(position));
}
