// Execute the actual Edge TypeScript source after transpilation; no verifier mocks.
import ts from 'typescript';
import { zipSync, strToU8 } from 'fflate';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory = path.resolve('.tools/edge-validation');
await mkdir(directory, { recursive: true });
for (const name of ['http', 'file-validation']) {
  const source = (await readFile(`supabase/functions/_shared/${name}.ts`, 'utf8'))
    .replace(/npm:@supabase\/supabase-js@[\d.]+/g, '@supabase/supabase-js')
    .replace(/npm:fflate@[\d.]+/g, 'fflate')
    .replace("'./http.ts'", "'./http.mjs'");
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true },
  });
  await writeFile(path.join(directory, `${name}.mjs`), result.outputText);
}
const { validateFileBytes, validateFileMetadata } = await import(
  pathToFileURL(path.join(directory, 'file-validation.mjs'))
);
const checks = [];
function test(name, run) {
  run();
  checks.push({ name, status: 'passed' });
  console.log('PASS ' + name);
}
test('Metadata refuses mismatched MIME, macro extension, path traversal and oversize', () => {
  assert.equal(validateFileMetadata('paper.doc', 'application/msword', 81920), 'doc');
  for (const args of [
    ['paper.pdf', 'application/msword', 100],
    ['paper.docm', 'application/msword', 100],
    ['../paper.pdf', 'application/pdf', 100],
    ['paper.pdf', 'application/pdf', 20971521],
  ])
    assert.throws(() => validateFileMetadata(...args));
});
for (const extension of ['doc', 'docx']) {
  const data = await readFile(`public/resources/Didarian_Research_Template.${extension}`);
  test(`Genuine ${extension.toUpperCase()} template bytes accepted`, () =>
    validateFileBytes(data, extension));
}
test('PDF rejects disguised text and active content', () => {
  assert.throws(() =>
    validateFileBytes(strToU8('This text is pretending to be a PDF file.'), 'pdf'),
  );
  assert.throws(() => validateFileBytes(strToU8('%PDF-1.4\n/JavaScript (alert)\n%%EOF'), 'pdf'));
});
const parts = {
  '[Content_Types].xml': strToU8(
    '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  ),
  '_rels/.rels': strToU8('<Relationships/>'),
  'word/document.xml': strToU8('<w:document xmlns:w="urn:word"><w:body/></w:document>'),
};
const macro = zipSync({ ...parts, 'word/vbaProject.bin': new Uint8Array(32) });
await writeFile(path.join(directory, 'macro-test.docx'), macro);
test('DOCX rejects macro entry and unrelated ZIP files', () => {
  assert.throws(() => validateFileBytes(macro, 'docx'));
  assert.throws(() =>
    validateFileBytes(zipSync({ 'note.txt': strToU8('Not a Word document') }), 'docx'),
  );
});
test('DOCX rejects mismatched archive directory counts', () => {
  const bytes = zipSync(parts);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(bytes.length - 22 + 8, 1, true);
  assert.throws(() => validateFileBytes(bytes, 'docx'));
});
test('DOCX rejects compressed output larger than lying local and central sizes', () => {
  const bytes = zipSync({
    ...parts,
    'word/document.xml': strToU8('<w:document>' + 'a'.repeat(50000) + '</w:document>'),
  });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let central = view.getUint32(bytes.length - 22 + 16, true);
  for (let i = 0; i < 3; i++) {
    const len = view.getUint16(central + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(central + 46, central + 46 + len));
    if (name === 'word/document.xml') {
      const local = view.getUint32(central + 42, true);
      view.setUint32(central + 24, 100, true);
      view.setUint32(local + 22, 100, true);
    }
    central += 46 + len + view.getUint16(central + 30, true) + view.getUint16(central + 32, true);
  }
  assert.throws(() => validateFileBytes(bytes, 'docx'), /expands|size/);
});
test('Forged legacy DOC compound signature is rejected', () => {
  const bytes = new Uint8Array(4096);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.throws(() => validateFileBytes(bytes, 'doc'));
});
await writeFile(
  'docs/evidence/file-validation-results.json',
  JSON.stringify(
    {
      executedAt: new Date().toISOString(),
      source:
        'Actual Edge TypeScript transpiled with installed TypeScript; same pinned fflate dependency',
      checks,
    },
    null,
    2,
  ),
);
