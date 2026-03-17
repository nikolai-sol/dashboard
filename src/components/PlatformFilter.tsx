"use client";

type PlatformOption = {
  id: string;
  name: string;
  color: string;
};

type PlatformFilterProps = {
  platforms: PlatformOption[];
  selected: string[];
  onToggle: (platformId: string) => void;
  onSelectAll: () => void;
  className?: string;
};

export default function PlatformFilter({
  platforms,
  selected,
  onToggle,
  onSelectAll,
  className,
}: PlatformFilterProps) {
  const availablePlatformIds = platforms.map((platform) => platform.id);
  const allEnabled =
    availablePlatformIds.length > 0 &&
    availablePlatformIds.every((platformId) => selected.includes(platformId));

  return (
    <section className={`card-surface mb-6 p-4 ${className ?? ""}`.trim()}>
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

        {platforms.map((platform) => {
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
