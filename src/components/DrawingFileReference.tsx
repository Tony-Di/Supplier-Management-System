import { type DrawingSet } from "../types";
import { FileReference } from "./FileReference";

export function DrawingFileReference({ drawingItem, drawingSet }: { drawingItem?: DrawingSet["drawingItems"][number]; drawingSet?: DrawingSet }) {
  if (!drawingItem) return <span className="muted">-</span>;
  if (drawingSet?.packageFileId) return <FileReference fileId={drawingSet.packageFileId} />;
  if (drawingItem.drawingSource === "Package PDF" && drawingSet?.packageFileName) return <span>{drawingSet.packageFileName}</span>;
  if (drawingItem.fileId) return <FileReference fileId={drawingItem.fileId} />;
  return <span>{drawingItem.fileName ?? "-"}</span>;
}
