export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
export function validateFile(file: Pick<File, 'name' | 'size' | 'type'>): string {
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  if (!(extension in MIME_TYPES))
    throw new Error('Choose a PDF, DOC, or DOCX file. Macro-enabled formats are not supported.');
  if (file.size < 16 || file.size > MAX_FILE_BYTES)
    throw new Error('The manuscript must be at least 16 bytes and no larger than 20 MB.');
  if (file.type && file.type !== MIME_TYPES[extension])
    throw new Error(
      'The file type does not match its extension. Export the document again and retry.',
    );
  return MIME_TYPES[extension];
}
export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'object' && value && 'message' in value && typeof value.message === 'string')
    return value.message;
  return 'This action could not be completed. Please try again.';
}
export function searchText(value: string): string {
  return value
    .trim()
    .replace(/[%_,()\\]/g, ' ')
    .slice(0, 120);
}
