import { CircleHelp } from "lucide-react";

export function Panel({ actions, title, children, help }: { actions?: React.ReactNode; title: React.ReactNode; children: React.ReactNode; help?: string }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <div className="toolbarTitle">
          <h2>{title}</h2>
          {help && (
            <span className="helpIcon" data-help={help}>
              <CircleHelp size={16} />
            </span>
          )}
        </div>
        {actions && <div className="panelHeaderActions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
