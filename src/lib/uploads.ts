import { type UploadedFileRecord } from "../types";
import { uploadFile } from "../api";
import { maxOtherSupplierFiles } from "../constants";

export async function uploadOptionalFormFile(
  form: FormData,
  fieldName: string,
  purpose: UploadedFileRecord["purpose"],
  linkedRecordType?: string,
) {
  const [file] = chosenFiles(form, fieldName);
  return file ? uploadSelectedFile(file, purpose, linkedRecordType) : undefined;
}

export async function uploadMultipleFormFiles(
  form: FormData,
  fieldName: string,
  purpose: UploadedFileRecord["purpose"],
  linkedRecordType?: string,
) {
  return Promise.all(chosenFiles(form, fieldName).map((file) => uploadSelectedFile(file, purpose, linkedRecordType)));
}

type Upload = (file: File, purpose: UploadedFileRecord["purpose"], linkedRecordType?: string) => Promise<{ id: string }>;

/**
 * Uploads the supplier documents chosen in a create or edit form and links them
 * in `patch`. The other-document limit is checked before anything uploads, so a
 * refused save leaves no stray file behind.
 */
export async function attachSupplierUploads(form: FormData, patch: Record<string, unknown>, upload: Upload = uploadSelectedFile) {
  const keptFileIds = patch.otherFileIds as string[];
  const otherFiles = chosenFiles(form, "otherFiles");
  if (keptFileIds.length + otherFiles.length > maxOtherSupplierFiles) {
    throw new Error(`A supplier can have at most ${maxOtherSupplierFiles} other documents. Remove one before adding another.`);
  }

  const [w9File] = chosenFiles(form, "w9File");
  if (w9File) {
    patch.w9FileId = (await upload(w9File, "Supplier W9", "supplier")).id;
    patch.hasW9 = true;
  }
  const [paymentInfoFile] = chosenFiles(form, "paymentInfoFile");
  if (paymentInfoFile) {
    patch.paymentInfoFileId = (await upload(paymentInfoFile, "Supplier Payment Info", "supplier")).id;
    patch.hasPaymentInfo = true;
  }
  if (otherFiles.length > 0) {
    const uploaded = await Promise.all(otherFiles.map((file) => upload(file, "Other", "supplier")));
    patch.otherFileIds = [...keptFileIds, ...uploaded.map((file) => file.id)];
  }
}

// An untouched file input still submits an empty, nameless file.
function chosenFiles(form: FormData, fieldName: string) {
  return form.getAll(fieldName).filter((file): file is File => file instanceof File && file.size > 0);
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
