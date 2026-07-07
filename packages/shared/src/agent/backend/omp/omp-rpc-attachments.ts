import { readFileSync } from 'node:fs';

import {
  getMimeType,
  IMAGE_LIMITS,
  type FileAttachment,
} from '../../../utils/files.ts';
import type { OmpRpcImageContent } from './omp-rpc-protocol.ts';

export interface OmpPreparedPrompt {
  message: string;
  images?: OmpRpcImageContent[];
  warnings: string[];
}

export interface OmpAttachmentConversionOptions {
  readFile?: (path: string) => Buffer;
}

export class OmpAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OmpAttachmentError';
  }
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function usablePath(attachment: FileAttachment): string | undefined {
  const candidate = attachment.storedPath ?? attachment.markdownPath ?? attachment.path;
  if (!candidate || candidate === 'clipboard') return undefined;
  return candidate;
}

function resolveImageMimeType(attachment: FileAttachment, dataUrlMime?: string): string {
  const supplied = dataUrlMime ?? attachment.mimeType;
  if (supplied?.startsWith('image/')) return supplied;
  const path = usablePath(attachment) ?? attachment.name;
  const inferred = getMimeType(path);
  if (inferred.startsWith('image/')) return inferred;
  throw new OmpAttachmentError(`Image attachment "${attachment.name}" has an unsupported MIME type: ${supplied || inferred}`);
}

function normalizeBase64(
  attachment: FileAttachment,
  raw: string,
): { data: string; dataUrlMime?: string } {
  const trimmed = raw.trim();
  const dataUrl = /^data:([^;,]+);base64,(.*)$/is.exec(trimmed);
  const dataUrlMime = dataUrl?.[1];
  const data = (dataUrl?.[2] ?? trimmed).replace(/\s+/g, '');
  if (!data || data.length % 4 !== 0 || !BASE64_PATTERN.test(data)) {
    throw new OmpAttachmentError(`Image attachment "${attachment.name}" contains malformed base64 data`);
  }

  const decodedBytes = Buffer.from(data, 'base64').byteLength;
  if (decodedBytes === 0) {
    throw new OmpAttachmentError(`Image attachment "${attachment.name}" is empty`);
  }
  if (decodedBytes > IMAGE_LIMITS.MAX_RAW_SIZE) {
    const sizeMb = (decodedBytes / 1024 / 1024).toFixed(1);
    throw new OmpAttachmentError(
      `Image attachment "${attachment.name}" is too large (${sizeMb}MB; maximum ${(
        IMAGE_LIMITS.MAX_RAW_SIZE / 1024 / 1024
      ).toFixed(1)}MB)`,
    );
  }
  return { data, dataUrlMime };
}

function imageFromAttachment(
  attachment: FileAttachment,
  options: OmpAttachmentConversionOptions,
): { image?: OmpRpcImageContent; warning?: string; fallbackText?: string } {
  if (attachment.base64) {
    const normalized = normalizeBase64(attachment, attachment.base64);
    return {
      image: {
        type: 'image',
        data: normalized.data,
        mimeType: resolveImageMimeType(attachment, normalized.dataUrlMime),
      },
    };
  }

  const path = usablePath(attachment);
  if (!path) {
    const warning = `Image attachment "${attachment.name}" has no image bytes or readable local path`;
    return { warning, fallbackText: `[Image attachment unavailable: ${attachment.name}]` };
  }

  try {
    const buffer = (options.readFile ?? readFileSync)(path);
    const normalized = normalizeBase64(attachment, buffer.toString('base64'));
    return {
      image: {
        type: 'image',
        data: normalized.data,
        mimeType: resolveImageMimeType(attachment),
      },
    };
  } catch (error) {
    if (error instanceof OmpAttachmentError) throw error;
    const warning = `Could not read image attachment "${attachment.name}" from ${path}`;
    return {
      warning,
      fallbackText: `[Image attachment unavailable: ${attachment.name}]\n[Path: ${path}]`,
    };
  }
}

function nonImageText(attachment: FileAttachment): string {
  if (attachment.type === 'text' && attachment.text) {
    return `[Attached text file: ${attachment.name}]\n${attachment.text}`;
  }

  const path = attachment.type === 'office'
    ? attachment.markdownPath ?? attachment.storedPath ?? attachment.path
    : attachment.storedPath ?? attachment.markdownPath ?? attachment.path;
  const label = attachment.type === 'pdf'
    ? 'PDF attachment'
    : attachment.type === 'office'
      ? 'Office attachment'
      : attachment.type === 'audio'
        ? 'Audio attachment'
        : attachment.type === 'text'
          ? 'Text attachment'
          : 'File attachment';
  return [
    `[${label}: ${attachment.name}]`,
    `[MIME type: ${attachment.mimeType || 'unknown'}]`,
    path ? `[Path: ${path}]` : '[No readable local path]',
  ].join('\n');
}

export function prepareOmpPrompt(
  message: string,
  attachments?: FileAttachment[],
  options: OmpAttachmentConversionOptions = {},
): OmpPreparedPrompt {
  if (!attachments?.length) return { message, warnings: [] };

  const textParts: string[] = [];
  const images: OmpRpcImageContent[] = [];
  const warnings: string[] = [];

  for (const attachment of attachments) {
    if (attachment.type !== 'image') {
      textParts.push(nonImageText(attachment));
      continue;
    }

    const converted = imageFromAttachment(attachment, options);
    if (converted.image) images.push(converted.image);
    if (converted.warning) warnings.push(converted.warning);
    if (converted.fallbackText) textParts.push(converted.fallbackText);
  }

  return {
    message: [...textParts, message].filter(Boolean).join('\n\n'),
    ...(images.length > 0 ? { images } : {}),
    warnings,
  };
}
