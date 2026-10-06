# Lysobact region geometry: sources and license

This is real ADM1 polygon geometry matched to the agreed 85-entry reporting catalog. It contains all 83 features from the geoBoundaries RUS ADM1 layer and only Crimea (UA-43) and Sevastopol (UA-40) from its UKR ADM1 layer. Donetsk, Luhansk, Zaporizhzhia and Kherson are not included. Catalog inclusion is an application scope choice; upstream source country codes are preserved and do not express a sovereignty determination.

## Sources and attribution

Downloaded 2026-10-06 from [geoBoundaries](https://www.geoboundaries.org/), using its [documented API](https://www.geoboundaries.org/api.html):

- [RUS ADM1 metadata](https://www.geoboundaries.org/api/current/gbOpen/RUS/ADM1/), boundary ID `RUS-ADM1-28173009`, 83 features.
- [UKR ADM1 metadata](https://www.geoboundaries.org/api/current/gbOpen/UKR/ADM1/), boundary ID `UKR-ADM1-14850775`, 27 upstream features, of which two are selected.
- [Pinned RUS simplified GeoJSON](https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/RUS/ADM1/geoBoundaries-RUS-ADM1_simplified.geojson).
- [Pinned UKR simplified GeoJSON](https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/UKR/ADM1/geoBoundaries-UKR-ADM1_simplified.geojson).

Both country metadata records identify the original source as **OpenStreetMap, Wambacher**, the source license as **Open Data Commons Open Database License 1.0**, and the license source as [OpenStreetMap copyright](https://www.openstreetmap.org/copyright). The derived geometry database is provided under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Preserve attribution and applicable share-alike obligations when redistributing an adapted database. geoBoundaries separately describes its resource as [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); that does not replace the original-source ODbL obligations.

The rendered map should visibly credit and link **geoBoundaries** and **© OpenStreetMap contributors**, and link to this license notice. Suggested concise attribution: “Boundaries: geoBoundaries / © OpenStreetMap contributors (ODbL).”

## Age, transformation and limitations

Both layers represent **2017** boundaries; source update is 19 January 2023 and geoBoundaries build date is 12 December 2023. This is not a verification of current 2026 legal boundaries. It is not an official Russian administrative boundary certification or a disease-data source.

The display asset selects the catalog features, replaces metadata properties with application identifiers and provenance, removes the redundant CRS member (coordinates remain WGS84 longitude/latitude), and minifies JSON. It then applies conservative Douglas–Peucker display simplification at a nominal 0.02° tolerance, adapting downward when a ring’s signed area would change by more than 3%. Original ring extrema are pinned; every original polygon component and ring is retained. All surviving coordinates are exact source vertices, without rounding or invented polygons. This is a modified ODbL database; the same attribution and share-alike terms apply. The full original source files, unmodified combined asset, transformation script and validation receipt are retained outside the public directory in `outputs/lyzobact-module-20261006/geometry/`. `properties.regionKey` and feature `id` match the frozen 85-region register; `name` is its Russian label. Each feature retains `sourceName`, `sourceISO`, `sourceShapeId`, `sourceLayer` and `sourceYear`.

Validation: 85 features and 85 unique keys, exact register-key equality; 50 Polygon and 35 MultiPolygon geometries; 1,639 polygon components, 1,684 closed rings and 52,779 display coordinate positions (342,035 originally); finite coordinates within WGS84 bounds; no excluded catalog entries. Every original ring bounding box is preserved exactly. Shared-edge topology and self-intersection checks were not performed: this is display geometry, unsuitable for spatial measurement or precise boundary adjudication. Chukotka crosses ±180°: the renderer must unwrap or clip the antimeridian correctly. The Tyumen, Yugra and Yamalo-Nenets geometries are separate features; do not merge their epidemiological observations.

Display asset size: 1,296,545 bytes (84.2% smaller; 498245 bytes with standard gzip). Keeping every small island component and a 3% ring-area tolerance was prioritized over forcing the asset below 1 MB. SHA-256:

- Display `regions.geojson`: `766d147792035b1a3e3b23b34159ceb516cda925f15f110364422f49218444e8`
- Original combined asset: `acd0674fc7b051a257194c72bd17bee057ccb9789544588b51125734d0552150`
- Upstream RUS file: `47179a0b1f30097226bc057921e674d83a9ac9e2a44023e687351355cdb7fc1b`
- Upstream UKR file: `4a5947e7497574d51f93255dfa7e03dce0c7acf6ecee52d25773a5205854a399`

## Explicit source-to-catalog mapping

| Catalog regionKey | Source layer | Source ISO | Source name |
|---|---|---|---|
| Adygea | RUS-ADM1 | RU-AD | Adygea |
| Altai Krai | RUS-ADM1 | RU-ALT | Altai Krai |
| Altai Republic | RUS-ADM1 | RU-AL | Altai Republic |
| Amur | RUS-ADM1 | RU-AMU | Amur Oblast |
| Arkhangelsk | RUS-ADM1 | RU-ARK | Arkhangelsk Oblast |
| Astrakhan Oblast | RUS-ADM1 | RU-AST | Astrakhan Oblast |
| Bashkortostan | RUS-ADM1 | RU-BA | Bashkortostan |
| Belgorod | RUS-ADM1 | RU-BEL | Belgorod Oblast |
| Bryansk | RUS-ADM1 | RU-BRY | Bryansk Oblast |
| Buryatia | RUS-ADM1 | RU-BU | Buryatia |
| Chechnya | RUS-ADM1 | RU-CE | Chechnya |
| Chelyabinsk | RUS-ADM1 | RU-CHE | Chelyabinsk Oblast |
| Chukotka | RUS-ADM1 | RU-CHU | Chukotka Autonomous Okrug |
| Chuvashia | RUS-ADM1 | RU-CU | Chuvashia |
| Crimea | UKR-ADM1 | UA-43 | Autonomous Republic of Crimea |
| Dagestan | RUS-ADM1 | RU-DA | Dagestan |
| Ingushetia | RUS-ADM1 | RU-IN | Ingushetia |
| Irkutsk | RUS-ADM1 | RU-IRK | Irkutsk Oblast |
| Ivanovo | RUS-ADM1 | RU-IVA | Ivanovo Oblast |
| Jewish Autonomous Oblast | RUS-ADM1 | RU-YEV | Jewish Autonomous Oblast |
| Kabardino-Balkaria | RUS-ADM1 | RU-KB | Kabardino-Balkaria |
| Kaliningrad | RUS-ADM1 | RU-KGD | Kaliningrad |
| Kalmykia | RUS-ADM1 | RU-KL | Kalmykia |
| Kaluga | RUS-ADM1 | RU-KLU | Kaluga Oblast |
| Kamchatka | RUS-ADM1 | RU-KAM | Kamchatka Krai |
| Karachay-Cherkessia | RUS-ADM1 | RU-KC | Karachay-Cherkessia |
| Karelia | RUS-ADM1 | RU-KR | Republic of Karelia |
| Kemerovo | RUS-ADM1 | RU-KEM | Kemerovo Oblast |
| Khabarovsk | RUS-ADM1 | RU-KHA | Khabarovsk Krai |
| Khakassia | RUS-ADM1 | RU-KK | Khakassia |
| Kirov Oblast | RUS-ADM1 | RU-KIR | Kirov Oblast |
| Komi | RUS-ADM1 | RU-KO | Komi Republic |
| Kostroma | RUS-ADM1 | RU-KOS | Kostroma Oblast |
| Krasnodar Krai | RUS-ADM1 | RU-KDA | Krasnodar Krai |
| Krasnoyarsk | RUS-ADM1 | RU-KYA | Krasnoyarsk Krai |
| Kurgan | RUS-ADM1 | RU-KGN | Kurgan Oblast |
| Kursk | RUS-ADM1 | RU-KRS | Kursk Oblast |
| Leningrad Oblast | RUS-ADM1 | RU-LEN | Leningrad oblast |
| Lipetsk | RUS-ADM1 | RU-LIP | Lipetsk Oblast |
| Magadan | RUS-ADM1 | RU-MAG | Magadan Oblast |
| Mari El | RUS-ADM1 | RU-ME | Mari El |
| Mordovia | RUS-ADM1 | RU-MO | Republic of Mordovia |
| Moscow Oblast | RUS-ADM1 | RU-MOS | Moscow Oblast |
| Moscow city | RUS-ADM1 | RU-MOW | Moscow |
| Murmansk | RUS-ADM1 | RU-MUR | Murmansk Oblast |
| Nenets AO | RUS-ADM1 | RU-NEN | Nenets Autonomous Okrug |
| Nizhny Novgorod Oblast | RUS-ADM1 | RU-NIZ | Nizhny Novgorod Oblast |
| North Ossetia-Alania | RUS-ADM1 | RU-SE | North Ossetia–Alania |
| Novgorod | RUS-ADM1 | RU-NGR | Novgorod Oblast |
| Novosibirsk | RUS-ADM1 | RU-NVS | Novosibirsk Oblast |
| Omsk | RUS-ADM1 | RU-OMS | Omsk Oblast |
| Orenburg Oblast | RUS-ADM1 | RU-ORE | Orenburg Oblast |
| Oryol | RUS-ADM1 | RU-ORL | Oryol Oblast |
| Penza Oblast | RUS-ADM1 | RU-PNZ | Penza Oblast |
| Perm Krai | RUS-ADM1 | RU-PER | Perm Krai |
| Primorsky | RUS-ADM1 | RU-PRI | Primorsky Krai |
| Pskov | RUS-ADM1 | RU-PSK | Pskov Oblast |
| Rostov Oblast | RUS-ADM1 | RU-ROS | Rostov Oblast |
| Ryazan | RUS-ADM1 | RU-RYA | Ryazan Oblast |
| Saint Petersburg | RUS-ADM1 | RU-SPE | Saint Petersburg |
| Sakha | RUS-ADM1 | RU-SA | Sakha Republic |
| Sakhalin | RUS-ADM1 | RU-SAK | Sakhalin Oblast |
| Samara Oblast | RUS-ADM1 | RU-SAM | Samara Oblast |
| Saratov Oblast | RUS-ADM1 | RU-SAR | Saratov Oblast |
| Sevastopol | UKR-ADM1 | UA-40 | Sevastopol |
| Smolensk | RUS-ADM1 | RU-SMO | Smolensk Oblast |
| Stavropol Krai | RUS-ADM1 | RU-STA | Stavropol Krai |
| Sverdlovsk | RUS-ADM1 | RU-SVE | Sverdlovsk Oblast |
| Tambov | RUS-ADM1 | RU-TAM | Tambov Oblast |
| Tatarstan | RUS-ADM1 | RU-TA | Tatarstan |
| Tomsk | RUS-ADM1 | RU-TOM | Tomsk Oblast |
| Tula | RUS-ADM1 | RU-TUL | Tula Oblast |
| Tuva | RUS-ADM1 | RU-TY | Tuva |
| Tver | RUS-ADM1 | RU-TVE | Tver Oblast |
| Tyumen | RUS-ADM1 | RU-TYU | Tyumen Oblast |
| Udmurtia | RUS-ADM1 | RU-UD | Udmurtia |
| Ulyanovsk Oblast | RUS-ADM1 | RU-ULY | Ulyanovsk Oblast |
| Vladimir | RUS-ADM1 | RU-VLA | Vladimir Oblast |
| Volgograd Oblast | RUS-ADM1 | RU-VGG | Volgograd Oblast |
| Vologda | RUS-ADM1 | RU-VLG | Vologda Oblast |
| Voronezh | RUS-ADM1 | RU-VOR | Voronezh Oblast |
| Yamalo-Nenets | RUS-ADM1 | RU-YAN | Yamalo-Nenets Autonomous Okrug |
| Yaroslavl | RUS-ADM1 | RU-YAR | Yaroslavl Oblast |
| Yugra | RUS-ADM1 | RU-KHM | Khanty-Mansiysk Autonomous Okrug – Ugra |
| Zabaykalsky | RUS-ADM1 | RU-ZAB | Zabaykalsky Krai |
