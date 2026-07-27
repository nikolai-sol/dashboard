import type { ReactNode } from "react";
import type { ZarukuDatasetMeta, ZarukuDatasetState } from "@/lib/types";

type Props = {
  meta: ZarukuDatasetMeta;
  hasRows: boolean;
  children?: ReactNode;
};

export default function ZarukuPanelState({ meta, hasRows, children }: Props) {
  if (!isZarukuDatasetVisible(meta.state)) return null;

  if (meta.state === "empty" || !hasRows) {
    return (
      <p role="status" className="py-2 text-sm text-slate-500">Нет данных за период.</p>
    );
  }

  return (
    <>
      {children}
      {meta.state === "partial" ? (
        <p role="status" className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
          {meta.message ?? `Данные полные по ${meta.period.to}.`}
        </p>
      ) : null}
    </>
  );
}

export function isZarukuDatasetVisible(state: ZarukuDatasetState): boolean {
  return state !== "hidden" && state !== "unavailable";
}
