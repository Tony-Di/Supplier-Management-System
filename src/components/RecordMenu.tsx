import { useState, useEffect } from "react";
import { MoreHorizontal } from "lucide-react";

export function RecordMenu({
  canDelete,
  label,
  onDelete,
  onEdit,
  onHistory,
  onView,
  onVoid,
}: {
  canDelete: boolean;
  label: string;
  onDelete: () => void;
  onEdit: () => void;
  onHistory?: () => void;
  onView?: () => void;
  onVoid: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuId] = useState(() => `record-menu-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    function closeOtherMenus(event: Event) {
      if (event instanceof CustomEvent && event.detail !== menuId) setOpen(false);
    }
    window.addEventListener("record-menu-open", closeOtherMenus);
    return () => window.removeEventListener("record-menu-open", closeOtherMenus);
  }, [menuId]);

  function runAction(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="recordMenu">
      <button
        aria-expanded={open}
        aria-label={`Actions for ${label}`}
        className="recordMenuTrigger"
        onClick={() => {
          window.dispatchEvent(new CustomEvent("record-menu-open", { detail: menuId }));
          setOpen((current) => !current);
        }}
        title={`Actions for ${label}`}
        type="button"
      >
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div className="recordMenuList">
          {onView && <button onClick={() => runAction(onView)} type="button">View</button>}
          <button onClick={() => runAction(onEdit)} type="button">Edit</button>
          <button onClick={() => runAction(onVoid)} type="button">Void</button>
          {canDelete && <button className="dangerMenuItem" onClick={() => runAction(onDelete)} type="button">Delete</button>}
        </div>
      )}
    </div>
  );
}
