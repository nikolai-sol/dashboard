"use client";

import { useEffect, useState } from "react";
import type { PlatformMeta } from "@/lib/admin-ui-types";

export default function AdminPlatformsPage() {
  const [platforms, setPlatforms] = useState<PlatformMeta[]>([]);

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/admin/platforms");
      const json = await res.json();
      setPlatforms(json.platforms ?? []);
    }
    void load();
  }, []);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Platforms (read-only)</h1>
      <ul className="space-y-2 text-sm text-slate-700">
        {platforms.map((platform) => (
          <li key={platform.id} className="rounded-lg border border-slate-100 px-3 py-2">
            <p className="font-medium">{platform.display_name}</p>
            <p className="text-xs text-slate-500">
              {platform.id} - {platform.source} - {platform.schema_file}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
