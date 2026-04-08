export type DashboardLanguage = "en" | "ru";

export type DashboardI18n = {
  language: DashboardLanguage;
  locale: string;
  metrics: Record<string, string>;
  sections: {
    platformPerformance: string;
    platformPerformancePlanFact: string;
    channelPerformance: string;
    channelPerformancePlanFact: string;
    trendByDay: string;
    comparison: string;
    promopages: string;
    spendByPlatform: string;
    channelMix: string;
    manualData: string;
  };
  filter: {
    filterBy: string;
    platforms: string;
    channels: string;
    all: string;
  };
  header: {
    to: string;
    apply: string;
    updating: string;
    compare: string;
    compareApply: string;
    compareClose: string;
    compareTitle: string;
    compareCurrent: string;
    comparePrevious: string;
    compareMonth: string;
    compareWeek: string;
    compareYear: string;
    compareCustom: string;
    compareFrom: string;
    compareTo: string;
    exportPdf: string;
    exportExcel: string;
  };
  common: {
    total: string;
    trend: string;
    platform: string;
    channel: string;
    instrument: string;
    buyType: string;
    noDataForSelectedPlatforms: string;
    loadingDashboard: string;
    demoMode: string;
  };
  aiSummary: {
    title: string;
    subtitle: string;
    watchout: string;
    unavailableTitle: string;
    unavailableBody: string;
    errorTitle: string;
    errorBody: string;
  };
  planFact: {
    noRows: string;
    planOnlyTitle: string;
    fact: string;
    plan: string;
    completion: string;
    status: string;
    onTrack: string;
    watch: string;
    offTrack: string;
    noStatus: string;
  };
  spend: {
    shareOfTotal: string;
    totalSpend: string;
    spend: string;
    impressions: string;
    clicks: string;
  };
  channelTable: {
    noRows: string;
  };
};

const DICTIONARY: Record<DashboardLanguage, Omit<DashboardI18n, "language" | "locale">> = {
  en: {
    metrics: {
      impressions: "Impressions",
      clicks: "Clicks",
      ctr: "CTR",
      cpm: "CPM",
      cpc: "CPC",
      spend: "Spend",
      views: "Views",
      cpv: "CPV",
      conversions: "Conversions",
      cpa: "CPA",
      roas: "ROAS",
      reach: "Reach",
      frequency: "Frequency",
      sessions: "Sessions",
      cr: "CR",
    },
    sections: {
      platformPerformance: "Platform Performance",
      platformPerformancePlanFact: "Platform Performance Plan / Fact",
      channelPerformance: "Channel Performance",
      channelPerformancePlanFact: "Channel Performance Plan / Fact",
      trendByDay: "Trend by Day",
      comparison: "Period Comparison",
      promopages: "Promopages",
      spendByPlatform: "Spend by Platform",
      channelMix: "Channel Mix",
      manualData: "Additional Sources",
    },
    filter: {
      filterBy: "Filter by",
      platforms: "Platforms",
      channels: "Channels",
      all: "All",
    },
    header: {
      to: "to",
      apply: "Apply",
      updating: "Updating...",
      compare: "Compare",
      compareApply: "Apply comparison",
      compareClose: "Close",
      compareTitle: "Period comparison",
      compareCurrent: "Current period",
      comparePrevious: "Previous period",
      compareMonth: "Month to month",
      compareWeek: "Week to week",
      compareYear: "Year over year",
      compareCustom: "Custom period",
      compareFrom: "from",
      compareTo: "to",
      exportPdf: "Export PDF",
      exportExcel: "Export Excel",
    },
    common: {
      total: "Total",
      trend: "Trend",
      platform: "Platform",
      channel: "Channel",
      instrument: "Instrument",
      buyType: "Buy type",
      noDataForSelectedPlatforms: "No data for selected platforms",
      loadingDashboard: "Loading dashboard...",
      demoMode: "Demo mode: API unavailable, showing mock data.",
    },
    aiSummary: {
      title: "AI Summary",
      subtitle: "Generated from the current dashboard view",
      watchout: "Watchout",
      unavailableTitle: "Summary unavailable for this report",
      unavailableBody: "There is not enough grounded report data yet to generate a reliable summary.",
      errorTitle: "Summary unavailable right now",
      errorBody: "The dashboard loaded normally, but the summary could not be generated for this request.",
    },
    planFact: {
      noRows: "No media plan rows connected. Add a published Google Sheets URL or CSV URL in dashboard sources.",
      planOnlyTitle: "Plan-only row: no campaign bindings yet.",
      fact: "Fact",
      plan: "Plan",
      completion: "Completion",
      status: "Status",
      onTrack: "On track",
      watch: "Watch",
      offTrack: "Off track",
      noStatus: "No status",
    },
    spend: {
      shareOfTotal: "% of total",
      totalSpend: "Total Spend",
      spend: "Spend",
      impressions: "Impressions",
      clicks: "Clicks",
    },
    channelTable: {
      noRows: "No media plan channels available for channel performance.",
    },
  },
  ru: {
    metrics: {
      impressions: "Показы",
      clicks: "Клики",
      ctr: "CTR",
      cpm: "CPM",
      cpc: "CPC",
      spend: "Расход",
      views: "Просмотры",
      cpv: "CPV",
      conversions: "Конверсии",
      cpa: "CPA",
      roas: "ROAS",
      reach: "Охват",
      frequency: "Частота",
      sessions: "Сессии",
      cr: "CR",
    },
    sections: {
      platformPerformance: "Эффективность платформ",
      platformPerformancePlanFact: "Эффективность платформ План / Факт",
      channelPerformance: "Эффективность каналов",
      channelPerformancePlanFact: "Эффективность каналов План / Факт",
      trendByDay: "Динамика по дням",
      comparison: "Сравнение периодов",
      promopages: "ПромоСтраницы",
      spendByPlatform: "Расход по платформам",
      channelMix: "Микс каналов",
      manualData: "Дополнительные источники",
    },
    filter: {
      filterBy: "Фильтр по",
      platforms: "Платформам",
      channels: "Каналам",
      all: "Все",
    },
    header: {
      to: "по",
      apply: "Применить",
      updating: "Обновление...",
      compare: "Сравнить",
      compareApply: "Применить сравнение",
      compareClose: "Закрыть",
      compareTitle: "Сравнение периодов",
      compareCurrent: "Текущий период",
      comparePrevious: "Предыдущий период",
      compareMonth: "Месяц к месяцу",
      compareWeek: "Неделя к неделе",
      compareYear: "Год к году",
      compareCustom: "Свой период",
      compareFrom: "с",
      compareTo: "по",
      exportPdf: "Экспорт PDF",
      exportExcel: "Экспорт Excel",
    },
    common: {
      total: "Итого",
      trend: "Тренд",
      platform: "Платформа",
      channel: "Канал",
      instrument: "Инструмент",
      buyType: "Модель закупки",
      noDataForSelectedPlatforms: "Нет данных для выбранных платформ",
      loadingDashboard: "Загрузка дашборда...",
      demoMode: "Демо-режим: API недоступен, показаны тестовые данные.",
    },
    aiSummary: {
      title: "AI Summary",
      subtitle: "Сформировано по текущему состоянию дашборда",
      watchout: "Риск",
      unavailableTitle: "Сводка пока недоступна для этого отчета",
      unavailableBody: "Для надежной AI-сводки в текущем отчете пока недостаточно подтвержденных данных.",
      errorTitle: "Сводка сейчас недоступна",
      errorBody: "Дашборд загрузился нормально, но сгенерировать сводку для этого запроса не удалось.",
    },
    planFact: {
      noRows: "Нет подключенных строк медиаплана. Добавьте опубликованный Google Sheets URL или CSV URL в источники дашборда.",
      planOnlyTitle: "Строка только с планом: привязки кампаний пока не заданы.",
      fact: "Факт",
      plan: "План",
      completion: "Выполнение",
      status: "Статус",
      onTrack: "В норме",
      watch: "Требует внимания",
      offTrack: "Не в норме",
      noStatus: "Без статуса",
    },
    spend: {
      shareOfTotal: "% от общего",
      totalSpend: "Общий расход",
      spend: "Расход",
      impressions: "Показы",
      clicks: "Клики",
    },
    channelTable: {
      noRows: "Для таблицы эффективности каналов нет доступных строк медиаплана.",
    },
  },
};

export function normalizeDashboardLanguage(value: unknown): DashboardLanguage {
  return String(value ?? "en") === "ru" ? "ru" : "en";
}

export function getDashboardI18n(language: unknown): DashboardI18n {
  const normalized = normalizeDashboardLanguage(language);
  return {
    language: normalized,
    locale: normalized === "ru" ? "ru-RU" : "en-US",
    ...DICTIONARY[normalized],
  };
}
