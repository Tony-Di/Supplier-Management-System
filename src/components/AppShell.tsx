import { useState, type ReactNode } from "react";
import { Menu, X, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { navItems } from "../navigation";
import type { Section } from "../uiTypes";
import segLogo from "../assets/seg-logo-white.svg";
import { useSession } from "../SessionContext";

const sectionLabels: Record<Section, string> = {
  Dashboard: "Overview",
  Suppliers: "Master data",
  "Products & Drawings": "Product library",
  "Sourcing Workbench": "Supplier development",
  Pricing: "Commercial insights",
  "QC Inspections": "Quality assurance",
  Reports: "Supplier performance",
  Admin: "Administration",
};

export function AppShell({ section, onSectionChange, children }: { section: Section; onSectionChange: (section: Section) => void; children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, signOut } = useSession();
  return (
    <div className={sidebarCollapsed ? "appShell sidebarCollapsed" : "appShell"}>
      <aside className="sidebar">
        <div className="brandBlock">
          <div className="brandHeader">
            <img className="brandLogo" src={segLogo} alt="SEG Solar" />
            <button
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!sidebarCollapsed}
              aria-controls="main-navigation"
              className="sidebarToggle"
              onClick={() => setSidebarCollapsed((current) => !current)}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              type="button"
            >
              {sidebarCollapsed ? <PanelLeftOpen className="desktopToggleIcon" size={18} /> : <PanelLeftClose className="desktopToggleIcon" size={18} />}
              {sidebarCollapsed ? <Menu className="mobileToggleIcon" size={20} /> : <X className="mobileToggleIcon" size={20} />}
            </button>
          </div>
          <div className="brandCaption">
            <strong>Global Sourcing</strong>
            <span>Packaging Supply Chain</span>
          </div>
        </div>

        <nav id="main-navigation" className="navList" aria-label="Main navigation">
          {navItems.filter(({ section: item }) => item !== "Admin" || user?.role === "admin").map(({ section: item, icon: Icon }) => (
            <button
              className={section === item ? "navButton active" : "navButton"}
              aria-current={section === item ? "page" : undefined}
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
        {user && (
          <div className="sidebarIdentity">
            <div className="sidebarUser">
              <span className="sidebarUserName">{user.name}</span>
              <span className="sidebarUserEmail">{user.email}</span>
            </div>
            <button className="sidebarSignOut" onClick={() => void signOut()} type="button">
              Sign out
            </button>
          </div>
        )}
      </aside>

      <main className="mainArea">
        <header className="topbar">
          <div>
            <p className="eyebrow">{sectionLabels[section]}</p>
            <h1>{section}</h1>
          </div>

        </header>

        {children}
      </main>
    </div>
  );
}
