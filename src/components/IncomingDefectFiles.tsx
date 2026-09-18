import { type IncomingDefectRecord } from "../types";
import { FileReference } from "./FileReference";

export function IncomingDefectFiles({ defect }: { defect: IncomingDefectRecord }) {
  const fileIds = [...(defect.photoFileIds ?? []), ...(defect.attachmentFileIds ?? [])];
  if (fileIds.length === 0) return <span className="muted">-</span>;
  return (
    <div className="fileStack">
      {fileIds.map((fileId) => <FileReference fileId={fileId} key={fileId} />)}
    </div>
  );
}
