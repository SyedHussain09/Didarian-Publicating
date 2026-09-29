import { Inflate } from 'npm:fflate@0.8.3';
import { HttpError } from './http.ts';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MEDIA_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function validateFileMetadata(filename: string, mediaType: string, byteSize: number): string {
  const extension = filename.split('.').pop()?.toLowerCase() || '';
  if (!MEDIA_TYPES[extension] || MEDIA_TYPES[extension] !== mediaType) throw new HttpError(400, 'Select a PDF, DOC or DOCX with a matching file type.');
  if (!Number.isSafeInteger(byteSize) || byteSize < 16 || byteSize > MAX_FILE_BYTES) throw new HttpError(400, 'Manuscripts must be between 16 bytes and 20 MB.');
  if (filename.length > 180 || /[\x00-\x1f\x7f/\\]/.test(filename)) throw new HttpError(400, 'The filename contains unsupported characters.');
  return extension;
}

const invalid = (message = 'The file structure does not match its extension.') => { throw new HttpError(400, message); };

function validateDocx(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) invalid();
  // Inspect the central directory before decompression to reject zip bombs and ZIP64.
  let end = -1;
  for (let position = bytes.length - 22; position >= Math.max(0, bytes.length - 65_557); position--) {
    if (view.getUint32(position, true) === 0x06054b50) { end = position; break; }
  }
  if (end < 0) invalid();
  const count = view.getUint16(end + 10, true);
  let position = view.getUint32(end + 16, true);
  if (!count || count > 4096 || position >= end || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0 || view.getUint16(end + 8, true) !== count || position + view.getUint32(end + 12, true) !== end) invalid();
  if (end >= 20 && view.getUint32(end - 20, true) === 0x07064b50) invalid('ZIP64 documents are not supported.');
  const centralStart = position;
  const names = new Set<string>();
  const contents = new Map<string, { offset: number; compressed: number; uncompressed: number; method: number }>();
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) invalid();
    const compressed = view.getUint32(position + 20, true);
    const uncompressed = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const recordEnd = position + 46 + nameLength + view.getUint16(position + 30, true) + view.getUint16(position + 32, true);
    if (recordEnd > end) invalid();
    const name = new TextDecoder().decode(bytes.subarray(position + 46, position + 46 + nameLength));
    if (names.has(name) || name.includes('..') || name.startsWith('/') || name.includes('\\')) invalid();
    names.add(name);
    total += uncompressed;
    if (uncompressed > 32 * 1024 * 1024 || total > 80 * 1024 * 1024 || uncompressed > Math.max(compressed * 250, 1024 * 1024)) invalid('The document archive expands beyond safe limits.');
    const flags = view.getUint16(position + 8, true);
    const method = view.getUint16(position + 10, true);
    if ((flags & 1) !== 0 || /vba|macros|activex|embeddings/i.test(name)) invalid('Encrypted documents, macros and embedded executable content are not supported.');
    if (![0, 8].includes(method)) invalid('Unsupported ZIP compression method.');
    const local = view.getUint32(position + 42, true);
    if (local + 30 > centralStart || view.getUint32(local, true) !== 0x04034b50) invalid();
    const localNameLength = view.getUint16(local + 26, true);
    const offset = local + 30 + localNameLength + view.getUint16(local + 28, true);
    if (offset + compressed > centralStart || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method ||
      new TextDecoder().decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name) invalid();
    if ((flags & 8) === 0 && (view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== uncompressed)) invalid();
    if (method === 0 && compressed !== uncompressed) invalid();
    contents.set(name, { offset, compressed, uncompressed, method });
    position = recordEnd;
  }
  if (position !== end) invalid();
  if (!names.has('[Content_Types].xml') || !names.has('word/document.xml') || !names.has('_rels/.rels')) invalid();
  const extract = (name: string, limit: number): string => {
    const entry = contents.get(name)!;
    if (entry.uncompressed > limit) invalid('Document XML exceeds safe limits.');
    const compressedBytes = bytes.subarray(entry.offset, entry.offset + entry.compressed);
    if (entry.method === 0) return new TextDecoder().decode(compressedBytes);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      const inflater = new Inflate((chunk) => {
        size += chunk.length;
        if (size > entry.uncompressed || size > limit) invalid('The document expands beyond its declared size.');
        chunks.push(chunk);
      });
      // Small compressed chunks cap each decoder allocation even if a malicious
      // stream lies about central/local sizes or contains a huge expansion.
      for (let start = 0; start < compressedBytes.length; start += 1024) inflater.push(compressedBytes.subarray(start, start + 1024), start + 1024 >= compressedBytes.length);
      if (size !== entry.uncompressed) invalid('The document has inconsistent archive sizes.');
    } catch (error) { if (error instanceof HttpError) throw error; invalid('The DOCX archive is damaged.'); }
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(output);
  };
  const types = extract('[Content_Types].xml', 1024 * 1024);
  const document = extract('word/document.xml', 32 * 1024 * 1024);
  if (!types.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') || /macroEnabled/i.test(types) || !/<(?:\w+:)?document[\s>]/.test(document)) invalid();
}

function validateDoc(bytes: Uint8Array) {
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (!signature.every((byte, index) => bytes[index] === byte) || bytes.length < 512) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectorSize = 2 ** view.getUint16(30, true);
  if (![512, 4096].includes(sectorSize) || view.getUint16(28, true) !== 0xfffe) invalid();
  const sectorCount = Math.floor(bytes.length / sectorSize) - 1;
  const sectorOffset = (sector: number) => {
    if (sector < 0 || sector >= sectorCount) invalid();
    return (sector + 1) * sectorSize;
  };
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) { const sector = view.getUint32(76 + i * 4, true); if (sector < 0xfffffffa) fatSectors.push(sector); }
  let difat = view.getUint32(68, true);
  const seenDifat = new Set<number>();
  while (difat < 0xfffffffa) {
    if (seenDifat.has(difat) || seenDifat.size > sectorCount) invalid();
    seenDifat.add(difat);
    const offset = sectorOffset(difat);
    for (let i = 0; i < sectorSize / 4 - 1; i++) { const sector = view.getUint32(offset + i * 4, true); if (sector < 0xfffffffa) fatSectors.push(sector); }
    difat = view.getUint32(offset + sectorSize - 4, true);
  }
  if (fatSectors.length !== view.getUint32(44, true) || fatSectors.length > sectorCount) invalid();
  const next = (sector: number) => {
    const fatIndex = Math.floor(sector / (sectorSize / 4));
    if (fatIndex >= fatSectors.length) invalid();
    return view.getUint32(sectorOffset(fatSectors[fatIndex]) + (sector % (sectorSize / 4)) * 4, true);
  };
  let directory = view.getUint32(48, true);
  const seen = new Set<number>();
  let hasWord = false;
  let hasTable = false;
  while (directory < 0xfffffffa) {
    if (seen.has(directory) || seen.size > sectorCount) invalid();
    seen.add(directory);
    const offset = sectorOffset(directory);
    for (let i = 0; i < sectorSize; i += 128) {
      const length = view.getUint16(offset + i + 64, true);
      if (length < 2 || length > 64 || length % 2) continue;
      const name = new TextDecoder('utf-16le').decode(bytes.subarray(offset + i, offset + i + length - 2));
      if (/vba|macros|_vba_project|^project$/i.test(name)) invalid('Macro-enabled Word files are not supported.');
      if (name === '0Table' || name === '1Table') hasTable = true;
      if (name === 'WordDocument') {
        if (view.getUint8(offset + i + 66) !== 2) invalid();
        const size = view.getUint32(offset + i + 120, true);
        if (size < 4096) invalid('This legacy Word variant is unsupported. Save it as DOCX or PDF.');
        const stream = sectorOffset(view.getUint32(offset + i + 116, true));
        if (view.getUint16(stream, true) !== 0xa5ec || (view.getUint16(stream + 10, true) & 0x8100) !== 0) invalid('Encrypted Word documents are not supported.');
        hasWord = true;
      }
    }
    directory = next(directory);
  }
  if (!hasWord || !hasTable) invalid();
}

export function validateFileBytes(bytes: Uint8Array, extension: string) {
  if (bytes.length < 16 || bytes.length > MAX_FILE_BYTES) invalid();
  if (extension === 'docx') return validateDocx(bytes);
  if (extension === 'doc') return validateDoc(bytes);
  const start = new TextDecoder('latin1').decode(bytes.subarray(0, 8));
  const ending = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
  if (!/^%PDF-[12]\.[0-9]/.test(start) || !ending.includes('%%EOF')) invalid();
  // This is structural screening, not malware scanning. Serve all files as attachments.
  const content = new TextDecoder('latin1').decode(bytes);
  if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|OpenAction|AA)\b/.test(content)) invalid('PDFs with active or embedded content are not supported.');
}
