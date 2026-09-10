import type { DashboardReadModel } from "../lib/read-model.ts";
export function Search({ id, model }: Readonly<{ id: string; model: DashboardReadModel }>) { return <section id={id}><h2>Поиск и индексация</h2><p>Клики: {model.gsc.summary?.clicks ?? "нет данных"}</p><p>Индексация: {model.indexing.state}</p></section>; }
