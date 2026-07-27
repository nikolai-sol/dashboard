import type { ReactNode } from "react";

export type ZarukuTableFrameMode = "compact" | "standard" | "operational" | "comparison";

type Props = {
  mode: ZarukuTableFrameMode;
  label: string;
  children?: ReactNode;
  className?: string;
};

const MODE_CLASS: Record<ZarukuTableFrameMode, string> = {
  compact: "overflow-x-auto",
  standard: "overflow-x-auto",
  operational: "zaruku-table-frame-bounded max-h-[30rem] overflow-auto",
  comparison: "zaruku-table-frame-bounded max-h-[42rem] overflow-auto",
};

export default function ZarukuTableFrame({
  mode,
  label,
  children,
  className = "",
}: Props) {
  return (
    <div
      data-table-mode={mode}
      className={`w-full max-w-full min-w-0 rounded-lg border border-slate-200 ${MODE_CLASS[mode]} ${className}`}
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
