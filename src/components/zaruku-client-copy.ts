export type ZarukuCopyVerdict = "client" | "technical";

export type ZarukuCopyAuditItem = {
  id: string;
  surface: string;
  text: string;
  verdict: ZarukuCopyVerdict;
};

export const ZARUKU_CLIENT_COPY = {
  emptyPeriod: "Нет данных за выбранный период.",
  disabledCalendar: "На этой вкладке период выбирается по неделям.",
  technicalTail: {
    label: "Что входит в технический хвост",
    title: "Технический хвост",
    description: "Служебные и нераспознанные источники не считаются отдельным каналом привлечения.",
    importance: "Они показаны отдельно, чтобы можно было проверить полноту данных.",
  },
  contentMap: {
    label: "Информация по карте разделов",
    title: "Карта разделов сайта",
  },
  northStarCorrelation: "Показатели помогают отслеживать направление изменений, но сами по себе не доказывают причину.",
  emptyAiVisibility: "Данные об AI-видимости пока не готовы.",
  emptySemanticGroups: "Данные по тематическим группам пока не готовы.",
  emptySearchWeek: "Нет данных для выбранной недели.",
  emptyMapCities: "Нет данных по городам для /map за выбранный период.",
  emptyPages: "Нет страниц для выбранных периодов.",
  emptyQueries: "По выбранному фильтру запросов нет.",
  workUnavailable: "Данные по работам и задачам временно недоступны. Повторите попытку позже.",
  visibilityUnavailable: "SEO-видимость временно недоступна. Повторите попытку позже.",
} as const;

export const ZARUKU_NORTH_STAR_TOOLTIP_COPY = {
  noise: {
    title: "Что такое шум",
    description: "Доля показов по чужим брендам лабораторий и организаций, где портал виден не за счёт собственных медицинских тем.",
    importance: "Почему важно: если шум высокий, основная видимость уходит в нерелевантную конкуренцию, а показы хуже превращаются в целевой спрос.",
  },
  medicalIntent: {
    title: "Что такое медицинский интент",
    description: "Доля показов по запросам, где пользователь ищет медицинскую информацию, маршрутизацию или помощь по онкологическим темам.",
    importance: "Почему важно: рост этой доли показывает, что SEO приводит целевой органический трафик, а не просто увеличивает общий объём показов.",
  },
  aiVisibility: {
    title: "Что такое Алиса AI",
    description: "Доля проверенных AI-сценариев, где портал «За руку» присутствует в ответе Алисы или связанном источнике.",
    importance: "Почему важно: присутствие в ИИ-ответах становится отдельным каналом видимости до клика и влияет на то, какие источники пользователь увидит первыми.",
  },
  approveRate: {
    title: "Что такое доля принятия",
    description: "Доля SEO-возможностей, которые прошли отбор и были приняты в работу среди принятых и отклонённых решений недели.",
    importance: "Почему важно: это скорость превращения выводов SEO OS в реальные задачи без перегруза команды нерелевантными рекомендациями.",
  },
} as const;

export function formatZarukuCompleteness(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  const date = year && month && day ? `${day}.${month}.${year}` : value;
  return `Данные полные по ${date}.`;
}

const client = (id: string, surface: string, text: string): ZarukuCopyAuditItem => ({ id, surface, text, verdict: "client" });
const technical = (id: string, surface: string, text: string): ZarukuCopyAuditItem => ({ id, surface, text, verdict: "technical" });

export const ZARUKU_COPY_AUDIT: ZarukuCopyAuditItem[] = [
  client("empty-period", "Панели и секции", ZARUKU_CLIENT_COPY.emptyPeriod),
  client("calendar-week-mode", "Отключённый календарь", ZARUKU_CLIENT_COPY.disabledCalendar),
  client("technical-tail-label", "ⓘ Технический хвост", ZARUKU_CLIENT_COPY.technicalTail.label),
  client("technical-tail-title", "ⓘ Технический хвост", ZARUKU_CLIENT_COPY.technicalTail.title),
  client("technical-tail-description", "ⓘ Технический хвост", ZARUKU_CLIENT_COPY.technicalTail.description),
  client("technical-tail-importance", "ⓘ Технический хвост", ZARUKU_CLIENT_COPY.technicalTail.importance),
  client("content-map-label", "ⓘ Карта разделов", ZARUKU_CLIENT_COPY.contentMap.label),
  client("content-map-title", "ⓘ Карта разделов", ZARUKU_CLIENT_COPY.contentMap.title),
  client("north-star-correlation", "ⓘ Основные показатели", ZARUKU_CLIENT_COPY.northStarCorrelation),
  client("data-complete", "Частично доступные данные", formatZarukuCompleteness("2026-07-19")),
  client("empty-ai", "AI-видимость", ZARUKU_CLIENT_COPY.emptyAiVisibility),
  client("empty-semantic", "Тематические группы", ZARUKU_CLIENT_COPY.emptySemanticGroups),
  client("empty-search-week", "Поисковая диагностика", ZARUKU_CLIENT_COPY.emptySearchWeek),
  client("empty-map", "Карта городов", ZARUKU_CLIENT_COPY.emptyMapCities),
  client("empty-pages", "Сравнение страниц", ZARUKU_CLIENT_COPY.emptyPages),
  client("empty-queries", "Сравнение запросов", ZARUKU_CLIENT_COPY.emptyQueries),
  client("work-unavailable", "Работы", ZARUKU_CLIENT_COPY.workUnavailable),
  client("visibility-unavailable", "SEO-видимость", ZARUKU_CLIENT_COPY.visibilityUnavailable),
  ...Object.entries(ZARUKU_NORTH_STAR_TOOLTIP_COPY).flatMap(([key, copy]) => [
    client(`north-star-${key}-title`, "ⓘ Основные показатели", copy.title),
    client(`north-star-${key}-description`, "ⓘ Основные показатели", copy.description),
    client(`north-star-${key}-importance`, "ⓘ Основные показатели", copy.importance),
  ]),
  technical("north-star-details", "ⓘ Основные показатели · детали", "Период, контрольное значение и служебное имя источника."),
  technical("quality-refresh-details", "Качество · технические детали", "Служебное имя процесса, ритм обновления, прочитанные и записанные строки, последняя ошибка."),
];
