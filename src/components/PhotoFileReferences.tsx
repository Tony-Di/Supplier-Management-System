import { type SampleInspection } from "../types";
import { FileReference } from "./FileReference";

export function PhotoFileReferences({ inspection }: { inspection: SampleInspection }) {
  if (!inspection.photoFileIds?.length) return <span>{inspection.problemPhotos} uploaded</span>;
  return (
    <div className="fileStack">
      {inspection.photoFileIds.map((fileId) => <FileReference fileId={fileId} key={fileId} />)}
    </div>
  );
}
