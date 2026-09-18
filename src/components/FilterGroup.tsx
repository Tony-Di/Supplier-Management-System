import { Dispatch, SetStateAction } from "react";
import { MultiSelectDropdown } from "./MultiSelectDropdown";

export function FilterGroup({
  items,
  label,
  selectedIds,
  setSelectedIds,
}: {
  items: { id: string; label: string }[];
  label: string;
  selectedIds: string[];
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
}) {
  return <MultiSelectDropdown items={items} label={label} selectedIds={selectedIds} setSelectedIds={setSelectedIds} />;
}
