import { useState, useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { menuPosition } from "../lib/menuPosition";

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
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ReturnType<typeof menuPosition> | null>(null);

  useEffect(() => {
    function closeOtherMenus(event: Event) {
      if (event instanceof CustomEvent && event.detail !== menuId) setOpen(false);
    }
    window.addEventListener("record-menu-open", closeOtherMenus);
    return () => window.removeEventListener("record-menu-open", closeOtherMenus);
  }, [menuId]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    setPosition(menuPosition(triggerRef.current.getBoundingClientRect(), menuRef.current.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
  }, [open]);

  useLayoutEffect(() => {
    if (open && position) menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    function isInside(target: EventTarget | null) {
      return target instanceof Node && (triggerRef.current?.contains(target) || menuRef.current?.contains(target));
    }
    function closeOutside(event: Event) {
      if (!isInside(event.target)) setOpen(false);
    }
    function closeOnScroll(event: Event) {
      // Scrolling the popup itself is allowed on short screens.
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    function closeOnResize() { setOpen(false); }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    document.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      document.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [open]);

  function runAction(action: () => void) {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
    action();
  }

  function handleMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
      return;
    }
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (index + 1) % buttons.length
      : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length
      : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : undefined;
    if (next !== undefined) { event.preventDefault(); buttons[next]?.focus(); }
  }

  return (
    <div className="recordMenu">
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        aria-label={`Actions for ${label}`}
        className="recordMenuTrigger"
        onClick={() => {
          window.dispatchEvent(new CustomEvent("record-menu-open", { detail: menuId }));
          setPosition(null);
          setOpen((current) => !current);
        }}
        title={`Actions for ${label}`}
        type="button"
      >
        <MoreHorizontal size={17} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${label}`}
          className="recordMenuList"
          style={{ ...position, visibility: position ? "visible" : "hidden" }}
          onKeyDown={handleMenuKey}
        >
          {onView && <button role="menuitem" onClick={() => runAction(onView)} type="button">View</button>}
          <button role="menuitem" onClick={() => runAction(onEdit)} type="button">Edit</button>
          <button role="menuitem" onClick={() => runAction(onVoid)} type="button">Void</button>
          {canDelete && <button role="menuitem" className="dangerMenuItem" onClick={() => runAction(onDelete)} type="button">Delete</button>}
        </div>, document.body,
      )}
    </div>
  );
}
