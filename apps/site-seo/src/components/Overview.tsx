import type { DashboardReadModel } from "../lib/read-model.ts";
export function Overview({ id, model }: Readonly<{ id: string; model: DashboardReadModel }>) { return <section id={id}><h2>Обзор</h2><p>Google Search Console: {model.gsc.meta.state}</p></section>; }
