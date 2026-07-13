import { BadRequestException } from '@nestjs/common';

import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/** Common MIME whitelists, reusable across restaurant-scoped upload endpoints. */
export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export const DOCUMENT_MIME_TYPES = [
  ...IMAGE_MIME_TYPES,
  'application/pdf',
] as const;

export const MEDIA_MIME_TYPES = [...IMAGE_MIME_TYPES, 'video/mp4'] as const;

export const IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export const DOCUMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export const MEDIA_MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB — accommodates short gallery videos

/**
 * Builds `FileInterceptor` options that enforce a MIME whitelist and a size cap — no upload
 * endpoint in the codebase validated either before ERPH-1 (confirmed repo-wide: every
 * `FileInterceptor('file')` call site passed no options). Restaurant-scoped upload endpoints
 * (logo, banner, documents, media) and the user avatar upload (LH1-08) all use this; menu item
 * image upload is unchanged and shares the same gap today — noted as follow-up work rather than
 * touched here.
 */
export function createUploadInterceptorOptions(
  allowedMimeTypes: readonly string[],
  maxSizeBytes: number,
): MulterOptions {
  return {
    limits: { fileSize: maxSizeBytes },

    fileFilter: (_req, file, callback) => {
      if (!allowedMimeTypes.includes(file.mimetype)) {
        callback(
          new BadRequestException(
            `Unsupported file type "${file.mimetype}". Allowed: ${allowedMimeTypes.join(', ')}.`,
          ),
          false,
        );
        return;
      }

      callback(null, true);
    },
  };
}
