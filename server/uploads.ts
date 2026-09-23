import { extname } from "node:path";
import type { Response } from "express";

/**
 * Uploaded files are served from the app's own origin, so a stored HTML or SVG
 * file would run as a page with the signed-in user's session. Only the types
 * the workflow needs are accepted, and the stored extension and MIME type come
 * from this list rather than from the client.
 */
const ALLOWED_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
};

export const acceptedUploadExtensions = Object.keys(ALLOWED_TYPES);

// Types a browser can display without running anything. Everything else,
// including files stored before this list existed, is sent as a download.
const INLINE_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export class UploadRejectedError extends Error {
  status = 400;
}

export function uploadFileType(fileName: string): { extension: string; mimeType: string } {
  const extension = extname(fileName).toLowerCase();
  const mimeType = ALLOWED_TYPES[extension];
  if (!mimeType) {
    throw new UploadRejectedError(
      `${fileName} cannot be uploaded. Accepted file types: ${acceptedUploadExtensions.join(", ")}.`,
    );
  }
  return { extension, mimeType };
}

/** `setHeaders` hook for the static handler that serves `/uploads`. */
export function setUploadHeaders(response: Response, filePath: string): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (!INLINE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    response.setHeader("Content-Disposition", "attachment");
  }
}
