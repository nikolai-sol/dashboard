import type { ReactNode } from "react";
import type { ZarukuDatasetMeta } from "@/lib/types";

type SectionPanel = {
  meta: ZarukuDatasetMeta;
  hasRows: boolean;
};

type Props = {
  panels: SectionPanel[];
  children?: ReactNode;
};

function isPanelEmptyOrHidden({ meta, hasRows }: SectionPanel): boolean {
  return meta.state === "empty"
    || meta.state === "hidden"
    || meta.state === "unavailable"
    || !hasRows;
}

export default function ZarukuSectionState({ panels, children }: Props) {
  if (panels.length > 0 && panels.every(isPanelEmptyOrHidden)) {
    return (
      <section className="card-surface zaruku-panel" aria-label="Состояние раздела">
        <p role="status" className="zaruku-panel-body text-sm text-slate-500">
          Нет данных за выбранный период.
        </p>
      </section>
    );
  }

  return <>{children}</>;
}
