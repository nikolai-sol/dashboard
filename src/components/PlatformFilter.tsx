"use client";

import { PLATFORM_COLORS } from "@/lib/platform-colors";

type PlatformFilterProps = {
  selected: string[];
  onToggle: (platformId: string) => void;
  onSelectAll: () => void;
};

export default function PlatformFilter({
  selected,
  onToggle,
  onSelectAll,
}: PlatformFilterProps) {
  const allEnabled = selected.length === Object.keys(PLATFORM_COLORS).length;

  return (
    <section className="card-surface mb-6 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSelectAll}
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
            allEnabled
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
          }`}
        >
          All
        </button>

        {Object.entries(PLATFORM_COLORS).map(([platformId, meta]) => {
          const active = selected.includes(platformId);
          return (
            <button
              key={platformId}
              type="button"
              onClick={() => onToggle(platformId)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                active
                  ? "border-slate-300 bg-white text-slate-900 shadow-sm"
                  : "border-slate-200 bg-slate-50 text-slate-400"
              }`}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: meta.hex }}
              />
              {meta.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
