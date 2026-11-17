import React from "react";

interface SidebarProps {
  open?: boolean;
  children: React.ReactNode;
}

const Sidebar: React.FC<SidebarProps> = ({ open = true, children }) => {
  if (!open) return null;
  return (
    <aside
      aria-label="工作区侧栏"
      className="hidden h-full w-[288px] shrink-0 border-r border-slate-200 bg-white md:block"
    >
      {children}
    </aside>
  );
};

export default Sidebar;
