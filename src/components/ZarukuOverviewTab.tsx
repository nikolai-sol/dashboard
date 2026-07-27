import { Children, type ReactNode } from "react";
import ZarukuPanelGrid, { ZarukuPanelSlot } from "@/components/ZarukuPanelGrid";
import { resolveZarukuPanels } from "@/components/zaruku-panel-layout";
import type { ZarukuSeoData } from "@/lib/types";

type Props = {
  data: ZarukuSeoData;
  children: ReactNode;
};

export default function ZarukuOverviewTab({ data, children }: Props) {
  void data;
  const panels = resolveZarukuPanels("overview");
  const panelChildren = Children.toArray(children);

  return (
    <ZarukuPanelGrid className="zaruku-overview-grid">
      {panels.map((panel, index) => (
        <ZarukuPanelSlot key={panel.panelId} panel={panel}>
          {panelChildren[index] ?? null}
        </ZarukuPanelSlot>
      ))}
    </ZarukuPanelGrid>
  );
}
