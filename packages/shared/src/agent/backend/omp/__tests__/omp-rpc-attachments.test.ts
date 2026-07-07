import { describe, expect, it } from 'bun:test';

import { IMAGE_LIMITS, type FileAttachment } from '../../../../utils/files.ts';
import {
  OmpAttachmentError,
  prepareOmpPrompt,
} from '../omp-rpc-attachments.ts';

function attachment(overrides: Partial<FileAttachment>): FileAttachment {
  return {
    type: 'image',
    path: 'image.png',
    name: 'image.png',
    mimeType: 'image/png',
    size: 3,
    ...overrides,
  };
}

describe('prepareOmpPrompt', () => {
  it('transports base64 images outside prompt text', () => {
    const prepared = prepareOmpPrompt('describe this', [attachment({ base64: 'AQID' })]);
    expect(prepared.message).toBe('describe this');
    expect(prepared.images).toEqual([{ type: 'image', data: 'AQID', mimeType: 'image/png' }]);
    expect(prepared.message).not.toContain('AQID');
  });

  it('normalizes data URLs and uses their image MIME type', () => {
    const prepared = prepareOmpPrompt('describe', [attachment({
      mimeType: 'application/octet-stream',
      base64: 'data:image/jpeg;base64,AQID',
    })]);
    expect(prepared.images).toEqual([{ type: 'image', data: 'AQID', mimeType: 'image/jpeg' }]);
  });

  it('loads a path-only image through the injected reader', () => {
    const prepared = prepareOmpPrompt('describe', [attachment({ base64: undefined, storedPath: 'C:\\safe\\image.png' })], {
      readFile: (path) => {
        expect(path).toBe('C:\\safe\\image.png');
        return Buffer.from([1, 2, 3]);
      },
    });
    expect(prepared.images?.[0]?.data).toBe('AQID');
  });

  it('degrades an unreadable path-only image with an explicit warning', () => {
    const prepared = prepareOmpPrompt('continue', [attachment({ base64: undefined, storedPath: 'missing.png' })], {
      readFile: () => { throw new Error('missing'); },
    });
    expect(prepared.images).toBeUndefined();
    expect(prepared.warnings).toHaveLength(1);
    expect(prepared.message).toContain('Image attachment unavailable');
    expect(prepared.message).toContain('missing.png');
  });

  it('rejects malformed and oversized supplied image data', () => {
    expect(() => prepareOmpPrompt('x', [attachment({ base64: 'not base64!' })]))
      .toThrow(OmpAttachmentError);
    const oversized = Buffer.alloc(IMAGE_LIMITS.MAX_RAW_SIZE + 1).toString('base64');
    expect(() => prepareOmpPrompt('x', [attachment({ base64: oversized })]))
      .toThrow('too large');
  });

  it('describes every non-image attachment strategy', () => {
    const prepared = prepareOmpPrompt('question', [
      attachment({ type: 'text', name: 'a.txt', mimeType: 'text/plain', text: 'hello' }),
      attachment({ type: 'pdf', name: 'b.pdf', mimeType: 'application/pdf', storedPath: 'b.pdf' }),
      attachment({ type: 'office', name: 'c.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', markdownPath: 'c.md' }),
      attachment({ type: 'audio', name: 'd.mp3', mimeType: 'audio/mpeg', storedPath: 'd.mp3' }),
      attachment({ type: 'unknown', name: 'e.bin', mimeType: 'application/octet-stream', storedPath: 'e.bin' }),
    ]);
    expect(prepared.message).toContain('hello');
    expect(prepared.message).toContain('PDF attachment: b.pdf');
    expect(prepared.message).toContain('Path: c.md');
    expect(prepared.message).toContain('Audio attachment: d.mp3');
    expect(prepared.message).toContain('File attachment: e.bin');
  });
});
