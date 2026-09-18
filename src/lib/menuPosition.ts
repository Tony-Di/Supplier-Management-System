type AnchorRect = { right: number; top: number; bottom: number };

/** Place a viewport-fixed menu without depending on a table's overflow or stacking. */
export function menuPosition(anchor: AnchorRect, menu: { width: number; height: number }, viewport: { width: number; height: number }) {
  const margin = 8;
  const gap = 4;
  const maxHeight = Math.max(0, viewport.height - margin * 2);
  const height = Math.min(menu.height, maxHeight);
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - height;
  const top = below + height <= viewport.height - margin ? below : above;
  return {
    left: Math.max(margin, Math.min(anchor.right - menu.width, viewport.width - margin - menu.width)),
    top: Math.max(margin, Math.min(top, viewport.height - margin - height)),
    maxHeight,
  };
}
