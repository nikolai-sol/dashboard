import type { Feature, Geometry } from "geojson";
import type { GeometryObject, Topology } from "topojson-specification";
import { feature } from "topojson-client";
import worldAtlas from "world-atlas/countries-50m.json";
import type { ZarukuSeoMetricRow } from "@/lib/types";

type Coordinates = readonly [longitude: number, latitude: number];

type WorldAtlasTopology = Topology<{
  countries: {
    type: "GeometryCollection";
    geometries: Array<GeometryObject<{ name?: string }>>;
  };
}>;

export interface RussiaDemandCity {
  row: ZarukuSeoMetricRow;
  coordinates: Coordinates;
  showLabel: boolean;
}

const atlas = worldAtlas as unknown as WorldAtlasTopology;
const russiaGeometry = atlas.objects.countries.geometries.find((geometry) => String(geometry.id) === "643");

if (!russiaGeometry) {
  throw new Error("Russia geometry is missing from world-atlas");
}

export const RUSSIA_FEATURE = feature(atlas, russiaGeometry) as Feature<Geometry>;

function normalizeCityName(city: string) {
  return city
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const CITY_COORDINATES: Record<string, Coordinates> = {};

function registerCity(coordinates: Coordinates, ...aliases: string[]) {
  aliases.forEach((alias) => {
    CITY_COORDINATES[normalizeCityName(alias)] = coordinates;
  });
}

registerCity([37.6173, 55.7558], "Moscow", "Москва");
registerCity([30.3351, 59.9343], "Saint Petersburg", "St Petersburg", "Санкт-Петербург", "Санкт Петербург");
registerCity([39.7015, 47.2357], "Rostov-na-Donu", "Rostov-on-Don", "Ростов-на-Дону");
registerCity([44.002, 56.2965], "Nizhny Novgorod", "Нижний Новгород");
registerCity([56.2294, 58.0105], "Perm", "Пермь");
registerCity([60.5975, 56.8389], "Yekaterinburg", "Ekaterinburg", "Екатеринбург");
registerCity([92.8932, 56.0153], "Krasnoyarsk", "Красноярск");
registerCity([131.8855, 43.1155], "Vladivostok", "Владивосток");
registerCity([38.9753, 45.0355], "Krasnodar", "Краснодар");
registerCity([39.7231, 43.5855], "Sochi", "Сочи");
registerCity([129.7326, 62.0355], "Yakutsk", "Якутск");
registerCity([82.9204, 55.0302], "Novosibirsk", "Новосибирск");
registerCity([36.6959, 55.575], "Kubinka", "Кубинка");
registerCity([61.4026, 55.1644], "Chelyabinsk", "Челябинск");
registerCity([37.765, 55.4364], "Domodedovo", "Домодедово");
registerCity([50.1002, 53.1959], "Samara", "Самара");
registerCity([41.9734, 45.0445], "Stavropol", "Ставрополь");
registerCity([40.5433, 64.5393], "Arkhangelsk", "Архангельск");
registerCity([49.1064, 55.7961], "Kazan", "Казань");
registerCity([55.9587, 54.7388], "Ufa", "Уфа");
registerCity([73.3686, 54.9885], "Omsk", "Омск");
registerCity([104.2807, 52.2869], "Irkutsk", "Иркутск");
registerCity([135.0719, 48.4802], "Khabarovsk", "Хабаровск");
registerCity([65.5343, 57.153], "Tyumen", "Тюмень");
registerCity([39.2003, 51.6608], "Voronezh", "Воронеж");
registerCity([43.6071, 43.4846], "Nalchik", "Нальчик");

export function resolveRussiaCityCoordinates(city: string): Coordinates | null {
  return CITY_COORDINATES[normalizeCityName(city)] ?? null;
}

export function selectRussiaDemandCities(rows: ZarukuSeoMetricRow[], limit = 20): RussiaDemandCity[] {
  return rows
    .map((row) => {
      const coordinates = resolveRussiaCityCoordinates(row.label);
      return coordinates ? { row, coordinates } : null;
    })
    .filter((city): city is { row: ZarukuSeoMetricRow; coordinates: Coordinates } => city !== null)
    .sort((a, b) => b.row.visits - a.row.visits || a.row.label.localeCompare(b.row.label, "ru"))
    .slice(0, limit)
    .map((city, index) => ({ ...city, showLabel: index < 5 }));
}
