import { type UploadedFileRecord } from "../types";
import { uploadFile } from "../api";

export async function uploadOptionalFormFile(
  form: FormData,
  fieldName: string,
  purpose: UploadedFileRecord["purpose"],
  linkedRecordType?: string,
) {
  const file = form.get(fieldName);
  if (!(file instanceof File) || file.size === 0) return undefined;
  return uploadSelectedFile(file, purpose, linkedRecordType);
}

export async function uploadMultipleFormFiles(
  form: FormData,
  fieldName: string,
  purpose: UploadedFileRecord["purpose"],
  linkedRecordType?: string,
) {
  const selectedFiles = form.getAll(fieldName).filter((file): file is File => file instanceof File && file.size > 0);
  return Promise.all(selectedFiles.map((file) => uploadSelectedFile(file, purpose, linkedRecordType)));
}

export async function uploadSelectedFile(file: File, purpose: UploadedFileRecord["purpose"], linkedRecordType?: string) {
  const contentBase64 = await fileToBase64(file);
  return uploadFile({
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    contentBase64,
    purpose,
    linkedRecordType,
  });
}

export function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.split(",")[1] : value);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}
