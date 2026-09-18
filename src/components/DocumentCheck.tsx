import { FileReference } from "./FileReference";

export function DocumentCheck({ fileId, label, ok }: { fileId?: string; label: string; ok: boolean }) {
  return (
    <span className={ok ? "checkLabel ok" : "checkLabel"}>
      {label}
      {fileId && (
        <>
          {": "}
          <FileReference fileId={fileId} />
        </>
      )}
    </span>
  );
}
