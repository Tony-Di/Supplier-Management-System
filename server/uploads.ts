import { extname } from "node:path";

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

/** Where the frontend links to a stored file: its ID plus the lower-cased extension of its name. */
export function storagePath(id: string, fileName: string): string {
  return `uploads/${id}${extname(fileName).toLowerCase()}`;
}

/** The file ID in a download path's last segment, such as `file-1004` for `file-1004.pdf`. */
export function fileIdFromStoredName(name: string): string | undefined {
  return /^(file-\d+)\.[a-z0-9]+$/.exec(name)?.[1];
}

/**
 * Headers for sending a stored file. The type comes from the server's own
 * list, PDFs and images open in the browser, and anything else downloads.
 * Content never changes under an ID and IDs are never reused, so the browser
 * may keep its copy.
 */
export function downloadHeaders(file: { fileName: string; mimeType: string }): Record<string, string> {
  const disposition = INLINE_EXTENSIONS.has(extname(file.fileName).toLowerCase()) ? "inline" : "attachment";
  return {
    "Content-Type": file.mimeType,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${disposition}; ${fileNameParameters(file.fileName)}`,
    "Cache-Control": "private, max-age=31536000, immutable",
  };
}

// RFC 6266: an ASCII fallback for old clients, then the exact name as UTF-8 (RFC 5987).
function fileNameParameters(fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
