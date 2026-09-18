import { CircleHelp, Plus } from "lucide-react";

export function TableToolbar({
  action,
  extraActions,
  help,
  onAction,
  title,
}: {
  action?: string;
  extraActions?: React.ReactNode;
  help?: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <div className="tableToolbar">
      <div className="toolbarTitle">
        <h2>{title}</h2>
        {help && (
          <span className="helpIcon" data-help={help}>
            <CircleHelp size={16} />
          </span>
        )}
      </div>
      <div className="toolbarActions">
        {extraActions}
        {onAction && action && (
          <button onClick={onAction} type="button">
            <Plus size={16} />
            {action}
          </button>
        )}
      </div>
    </div>
  );
}
