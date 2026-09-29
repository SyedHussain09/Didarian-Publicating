// Execute the actual Edge TypeScript source after transpilation; no verifier mocks.
import ts from 'typescript';
import { zipSync, strToU8 } from 'fflate';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory = path.resolve('.tools/edge-validation');
await mkdir(directory, { recursive: true });
for (const name of ['http', 'pdf-content-credentials', 'file-validation']) {
  const source = (await readFile(`supabase/functions/_shared/${name}.ts`, 'utf8'))
    .replace(/npm:@supabase\/supabase-js@[\d.]+/g, '@supabase/supabase-js')
    .replace(/npm:fflate@[\d.]+/g, 'fflate')
    .replace("'./http.ts'", "'./http.mjs'")
    .replace("'./pdf-content-credentials.ts'", "'./pdf-content-credentials.mjs'");
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
// Synthetic metadata only; private author manuscripts never become test fixtures.
const box = (type, ...parts) => {
  const data = Buffer.concat([Buffer.alloc(8), ...parts]);
  data.writeUInt32BE(data.length, 0);
  data.write(type, 4, 4, 'ascii');
  return data;
};
const description = (prefix, label) =>
  box(
    'jumd',
    Buffer.from(prefix, 'ascii'),
    Buffer.from('00110010800000aa00389b71', 'hex'),
    Buffer.from([3]),
    Buffer.from(label + '\0'),
  );
const manifest = box(
  'jumb',
  description('c2ma', 'urn:c2pa:test'),
  box('cbor', Buffer.from([0xa0])),
);
const credentials = box('jumb', description('c2pa', 'c2pa'), manifest);
const credentialPdf = (data = credentials, options = {}) =>
  Buffer.concat([
    Buffer.from(
      '%PDF-1.4\n1 0 obj << /Type /Catalog /AF [3 0 R] >> endobj\n2 0 obj\n<< ' +
        (options.dictionary ||
          `/Length ${data.length} /Type /EmbeddedFile /Subtype /application#2Fc2pa`) +
        '\n>>\nstream\n',
    ),
    data,
    Buffer.from(
      '\nendstream\nendobj\n3 0 obj << /Type /Filespec /AFRelationship /C2PA_Manifest /EF << /F 2 0 R >> >> endobj\n' +
        (options.extra || '') +
        '\n%%EOF',
    ),
  ]);
test('PDF accepts bounded C2PA Content Credentials without changing the original bytes', () => {
  const bytes = credentialPdf();
  const original = Buffer.from(bytes);
  validateFileBytes(bytes, 'pdf');
  assert.deepEqual(bytes, original);
  validateFileBytes(
    credentialPdf(credentials, {
      dictionary: `/Subtype /application#2fc2pa /Length ${credentials.length} /Type /Embedded#46ile`,
    }),
    'pdf',
  );
});
test('PDF still rejects ordinary attachments and forged C2PA MIME labels', () => {
  assert.throws(() =>
    validateFileBytes(credentialPdf(Buffer.from('arbitrary attachment bytes')), 'pdf'),
  );
  assert.throws(() =>
    validateFileBytes(
      credentialPdf(credentials, {
        dictionary: `/Length ${credentials.length} /Type /EmbeddedFile /Subtype /text#2Fplain`,
      }),
      'pdf',
    ),
  );
  assert.throws(() =>
    validateFileBytes(
      credentialPdf(credentials, {
        extra: '4 0 obj << /Type /EmbeddedFile /Length 4 >> stream\nevil\nendstream\nendobj',
      }),
      'pdf',
    ),
  );
});
test('PDF rejects malformed C2PA boxes, UUIDs, lengths and ambiguous stream dictionaries', () => {
  const brokenSize = Buffer.from(credentials);
  brokenSize.writeUInt32BE(0xffffffff, 0);
  const brokenUuid = Buffer.from(credentials);
  brokenUuid[16] = 0;
  const brokenChild = Buffer.from(credentials);
  brokenChild.writeUInt32BE(0, 38);
  for (const data of [
    brokenSize,
    brokenUuid,
    brokenChild,
    credentials.subarray(0, -1),
    Buffer.concat([credentials, Buffer.from('trailing attachment')]),
  ]) {
    assert.throws(() => validateFileBytes(credentialPdf(data), 'pdf'));
  }
  for (const dictionary of [
    `/Length ${credentials.length - 1} /Type /EmbeddedFile /Subtype /application#2Fc2pa`,
    `/Length ${credentials.length + 1} /Type /EmbeddedFile /Subtype /application#2Fc2pa`,
    '/Length 5 0 R /Type /EmbeddedFile /Subtype /application#2Fc2pa',
    `/Length ${credentials.length} /Type /EmbeddedFile /Subtype /application#2Fc2pa /Filter /FlateDecode`,
    `/Length ${credentials.length} /Type /EmbeddedFile /Subtype /application#2Fc2pa /Subtype /text#2Fplain`,
  ])
    assert.throws(() => validateFileBytes(credentialPdf(credentials, { dictionary }), 'pdf'));
});
test('PDF rejects active actions alongside valid C2PA, including escaped PDF names', () => {
  for (const action of [
    'JavaScript',
    'JS',
    'Launch',
    'RichMedia',
    'OpenAction',
    'AA',
    'Java#53cript',
    '#4aS',
  ]) {
    assert.throws(() =>
      validateFileBytes(
        credentialPdf(credentials, {
          extra: `4 0 obj << /S /${action} >> endobj`,
        }),
        'pdf',
      ),
    );
  }
});
test('PDF bounds C2PA nesting and embedded metadata count', () => {
  let nested = box('cbor', Buffer.from([0xa0]));
  for (let i = 0; i < 20; i++) nested = box('jumb', description('c2ma', 'nested'), nested);
  assert.throws(() =>
    validateFileBytes(credentialPdf(box('jumb', description('c2pa', 'c2pa'), nested)), 'pdf'),
  );
  assert.throws(() =>
    validateFileBytes(credentialPdf(credentials, { extra: '/EmbeddedFile '.repeat(17) }), 'pdf'),
  );
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
