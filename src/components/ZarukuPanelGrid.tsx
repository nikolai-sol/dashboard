import type { ReactNode } from "react";
import {
  panelGridClass,
  type ZarukuPanelDefinition,
} from "@/components/zaruku-panel-layout";

export default function ZarukuPanelGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid min-w-0 grid-cols-1 gap-[var(--gap-section)] xl:grid-cols-12 ${className}`}>
      {children}
    </div>
  );
}

export function ZarukuPanelSlot({
  panel,
  children,
}: {
  panel: ZarukuPanelDefinition;
  children: ReactNode;
}) {
  return (
    <div
      data-panel-id={panel.panelId}
      data-panel-size={panel.defaultSize}
      data-panel-height={panel.height}
      className={panelGridClass(panel.defaultSize)}
    >
      {children}
    </div>
  );
}
