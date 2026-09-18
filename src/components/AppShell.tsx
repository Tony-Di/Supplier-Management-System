import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { navItems } from "../navigation";
import type { Section } from "../uiTypes";

export function AppShell({ section, onSectionChange, children }: { section: Section; onSectionChange: (section: Section) => void; children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  return (
    <div className={sidebarCollapsed ? "appShell sidebarCollapsed" : "appShell"}>
      <aside className="sidebar">
        <div className="brandBlock">
          <div className="brandMark">SEG</div>
          <div>
            <strong>Supplier Management</strong>
            <span>Supplier workbench</span>
          </div>
        </div>

        <nav className="navList" aria-label="Main navigation">
          {navItems.map(({ section: item, icon: Icon }) => (
            <button
              className={section === item ? "navButton active" : "navButton"}
              key={item}
              onClick={() => onSectionChange(item)}
              type="button"
              title={item}
            >
              <Icon size={18} />
              <span>{item}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="mainArea">
        <header className="topbar">
          <div>
            <h1>{section}</h1>
          </div>
          <button
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="sidebarToggle"
            onClick={() => setSidebarCollapsed((current) => !current)}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            type="button"
          >
            <Menu size={20} />
          </button>
        </header>

        {children}
      </main>
    </div>
  );
}
