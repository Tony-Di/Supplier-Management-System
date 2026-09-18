import { Dispatch, SetStateAction, useRef, useEffect } from "react";

export function MultiSelectDropdown<T extends string>({
  items,
  label,
  selectedIds,
  setSelectedIds,
}: {
  items: { id: T; label: string }[];
  label: string;
  selectedIds: T[];
  setSelectedIds: Dispatch<SetStateAction<T[]>>;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      const details = detailsRef.current;
      if (!details?.open) return;
      if (event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && detailsRef.current?.open) {
        detailsRef.current.open = false;
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function toggle(id: T) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]));
  }

  return (
    <div className="multiSelectField">
      <span>{label}</span>
      <details className="multiSelectDropdown" ref={detailsRef}>
        <summary>
          {selectedIds.length === 0 ? "None selected" : `${selectedIds.length} selected`}
        </summary>
        <div className="multiSelectMenu">
          <div className="multiSelectQuickActions">
            <button onClick={() => setSelectedIds(items.map((item) => item.id))} type="button">Select all</button>
            <button onClick={() => setSelectedIds([])} type="button">Clear</button>
          </div>
          {items.map((item) => (
            <label key={item.id}>
              <input checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} type="checkbox" />
              {item.label}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
