import { useAppData } from "../AppDataContext";
import { fileRecord, fileUrl } from "../lib/lookups";
import { formatFileSize } from "../lib/format";

export function FileReference({ fileId }: { fileId?: string }) {
  const { data: appData } = useAppData();
  const file = fileRecord(appData, fileId);
  if (!file) return <span className="muted">-</span>;
  return (
    <a className="fileLink" href={fileUrl(file)} rel="noreferrer" target="_blank" title={`${file.fileName} (${formatFileSize(file.size)})`}>
      {file.fileName}
    </a>
  );
}
