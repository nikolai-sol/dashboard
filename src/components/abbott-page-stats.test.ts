import test from "node:test";
import assert from "node:assert/strict";
import { buildAbbottPageStatsExportRows, matchesPageStatsSearch, matchesSelectedMaterialType } from "./abbott-page-stats";
import type { AbbottBiPageStatRow } from "@/lib/types";

const sampleRow: AbbottBiPageStatRow = {
  page_title: "Видеолекция о головокружении",
  url: "https://abbottpro.ru/video/262339",
  direction: "Неврология и психиатрия",
  material_type: "Видео",
  access: "Врачи",
  pageviews: 157,
  users: 122,
  bitrix_pageviews: 150,
  bitrix_sessions: 75,
  bitrix_users: 61,
  bitrix_logged_in_sessions: 44,
  bitrix_anonymous_sessions: 31,
  bitrix_avg_session_duration: 124.5,
};

test("empty material selection keeps all material types", () => {
  assert.equal(matchesSelectedMaterialType("Видео", []), true);
  assert.equal(matchesSelectedMaterialType(null, []), true);
});

test("material selection matches any selected type", () => {
  assert.equal(matchesSelectedMaterialType("Видео", ["Статьи", "Видео"]), true);
  assert.equal(matchesSelectedMaterialType("Калькуляторы", ["Статьи", "Видео"]), false);
});

test("page stats search matches title or URL case-insensitively", () => {
  assert.equal(matchesPageStatsSearch(sampleRow.page_title, sampleRow.url, "головокружении"), true);
  assert.equal(matchesPageStatsSearch(sampleRow.page_title, sampleRow.url, "262339"), true);
  assert.equal(matchesPageStatsSearch(sampleRow.page_title, sampleRow.url, "неизвестная страница"), false);
});

test("export rows keep page identity and raw numeric metrics", () => {
  assert.deepEqual(buildAbbottPageStatsExportRows([sampleRow]), [
    {
      "Заголовок страницы": "Видеолекция о головокружении",
      URL: "https://abbottpro.ru/video/262339",
      Направление: "Неврология и психиатрия",
      "Тип материала": "Видео",
      Доступ: "Врачи",
      "Просмотры Метрики": 157,
      "Пользователи Метрики (page-level)": 122,
      "Просмотры Bitrix": 150,
      "Сессии Bitrix": 75,
      "User ID Bitrix": 61,
      "Сессии с User ID": 44,
      "Анонимные сессии": 31,
      "Средняя сессия Bitrix, мин": 2.08,
    },
  ]);
});
