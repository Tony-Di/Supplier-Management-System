import { FileReference } from "./FileReference";
import { CircleCheck, CircleAlert } from "lucide-react";

export function DocumentCheck({ fileId, label, ok }: { fileId?: string; label: string; ok: boolean }) {
  return (
    <span className={ok ? "checkLabel ok" : "checkLabel"}>
      {ok ? <CircleCheck size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
      {label}{!ok && " missing"}
      {fileId && (
        <>
          {": "}
          <FileReference fileId={fileId} />
        </>
      )}
    </span>
  );
}
