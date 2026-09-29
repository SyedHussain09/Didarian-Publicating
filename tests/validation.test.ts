import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MIME_TYPES, searchText, validateFile } from '../src/lib/validation';
describe('manuscript input validation', () => {
  it.each(Object.entries(MIME_TYPES))('accepts %s with matching MIME', (ext, type) => {
    expect(validateFile({ name: `paper.${ext}`, type, size: 1024 })).toBe(type);
  });
  it('normalizes an uppercase extension and missing browser MIME', () => {
    expect(validateFile({ name: 'paper.DOCX', type: '', size: 1024 })).toBe(MIME_TYPES.docx);
  });
  it.each(['paper.html', 'paper.docm', 'paper.exe', 'paper.pdf.exe'])(
    'rejects unsupported %s',
    (name) => {
      expect(() => validateFile({ name, type: '', size: 1024 })).toThrow();
    },
  );
  it('rejects mismatched declared MIME', () => {
    expect(() => validateFile({ name: 'paper.pdf', type: 'text/html', size: 1024 })).toThrow(
      'does not match',
    );
  });
  it.each([0, MAX_FILE_BYTES + 1])('rejects invalid size %s', (size) => {
    expect(() => validateFile({ name: 'paper.pdf', type: 'application/pdf', size })).toThrow(
      '20 MB',
    );
  });
  it('accepts exactly the configured upload maximum', () => {
    expect(validateFile({ name: 'paper.pdf', type: 'application/pdf', size: MAX_FILE_BYTES })).toBe(
      MIME_TYPES.pdf,
    );
  });
  it('bounds search and removes PostgREST filter metacharacters', () => {
    expect(searchText('a%,b_(c)\\')).toBe('a  b  c  ');
    expect(searchText('a'.repeat(300))).toHaveLength(120);
  });
});
