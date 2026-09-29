import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.19';
import { zipSync, strToU8 } from 'npm:fflate@0.8.3';
import { MAX_FILE_BYTES, validateFileBytes, validateFileMetadata } from './file-validation.ts';

Deno.test('file metadata enforces supported extensions, MIME match and 20 MB', () => {
  assertEquals(validateFileMetadata('paper.pdf','application/pdf',100),'pdf');
  assertThrows(() => validateFileMetadata('paper.pdf','application/msword',100));
  assertThrows(() => validateFileMetadata('paper.docm','application/msword',100));
  assertThrows(() => validateFileMetadata('../paper.pdf','application/pdf',100));
  assertThrows(() => validateFileMetadata('paper.pdf','application/pdf',MAX_FILE_BYTES+1));
});
Deno.test('PDF verification rejects disguised bytes and active content', () => {
  validateFileBytes(strToU8('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'),'pdf');
  assertThrows(() => validateFileBytes(strToU8('This is definitely not a real PDF document.'),'pdf'));
  assertThrows(() => validateFileBytes(strToU8('%PDF-1.4\n/JavaScript (alert)\n%%EOF'),'pdf'));
});
Deno.test('DOCX structure requires a Word document and rejects macro assets', () => {
  const parts = {
    '[Content_Types].xml': strToU8('<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships/>'),
    'word/document.xml': strToU8('<w:document xmlns:w="urn:word"><w:body/></w:document>'),
  };
  validateFileBytes(zipSync(parts),'docx');
  assertThrows(() => validateFileBytes(zipSync({ ...parts, 'word/vbaProject.bin': new Uint8Array(30) }),'docx'));
  assertThrows(() => validateFileBytes(zipSync({ 'unrelated.txt': strToU8('This archive is not a Word file') }),'docx'));
});
Deno.test('legacy DOC rejects a forged compound-file header', () => {
  const bytes = new Uint8Array(4096);
  bytes.set([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);
  assertThrows(() => validateFileBytes(bytes,'doc'));
});
