import { type Section } from "./uiTypes";
import { LayoutDashboard, UserRound, PackageSearch, FolderKanban, LineChart, ClipboardCheck, Gauge } from "lucide-react";

export const navItems: { section: Section; icon: typeof LayoutDashboard }[] = [
  { section: "Dashboard", icon: LayoutDashboard },
  { section: "Suppliers", icon: UserRound },
  { section: "Products & Drawings", icon: PackageSearch },
  { section: "Sourcing Workbench", icon: FolderKanban },
  { section: "Pricing", icon: LineChart },
  { section: "QC Inspections", icon: ClipboardCheck },
  { section: "Reports", icon: Gauge },
];
