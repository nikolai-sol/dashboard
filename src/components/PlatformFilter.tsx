"use client";

type FilterOption = {
  id: string;
  name: string;
  color: string;
};

type PlatformFilterProps = {
  options: FilterOption[];
  selected: string[];
  onToggle: (optionId: string) => void;
  onSelectAll: () => void;
  mode?: "platform" | "channel";
  onModeChange?: (mode: "platform" | "channel") => void;
  filterScope?: "both" | "platform" | "channel";
  className?: string;
};

export default function PlatformFilter({
  options,
  selected,
  onToggle,
  onSelectAll,
  mode = "platform",
  onModeChange,
  filterScope = "both",
  className,
}: PlatformFilterProps) {
  const availablePlatformIds = options.map((platform) => platform.id);
  const allEnabled =
    availablePlatformIds.length > 0 &&
    availablePlatformIds.every((platformId) => selected.includes(platformId));

  return (
    <section className={`card-surface mb-6 p-4 ${className ?? ""}`.trim()}>
      {filterScope === "both" ? (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">Filter by</span>
          <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => onModeChange?.("platform")}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                mode === "platform" ? "bg-slate-900 text-white" : "text-slate-600"
              }`}
            >
              Platforms
            </button>
            <button
              type="button"
              onClick={() => onModeChange?.("channel")}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                mode === "channel" ? "bg-slate-900 text-white" : "text-slate-600"
              }`}
            >
              Channels
            </button>
          </div>
        </div>
      ) : null}
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

        {options.map((platform) => {
          const platformId = platform.id;
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
                style={{ backgroundColor: platform.color }}
              />
              {platform.name}
            </button>
          );
        })}
      </div>
    </section>
  );
}
