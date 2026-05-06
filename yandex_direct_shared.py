from __future__ import annotations

from typing import Iterable

EXCLUDED_CAMPAIGN_IDS = frozenset(
    {
        '108269032',  # 2 Ашфорд Формула || Москва и МО брендовые
        '108269036',  # 2 Ашфорд Формула || Москва и МО общие
        '108269081',  # 2 Ашфорд Формула || Москва и МО общие широкие
        '108269040',  # 2 Ашфорд Формула || Регионы брендовые
        '108269045',  # 2 Ашфорд Формула || Регионы общие
        '108269054',  # 2 Ашфорд Формула || Регионы общие широкие
        '108270544',  # 2 Вопрос Ашфорд Формула
        '108269058',  # 2 Ретаргетинг Ашфорд Формула || Москва и МО
        '108269066',  # 2 Ретаргетинг Ашфорд Формула || Регионы
        '108269069',  # 2 РСЯ Ашфорд Формула || Москва и МО
        '108269074',  # 2 РСЯ Ашфорд Формула || Регионы
        '115098804',  # armstrongtire - context - brand
        '115098345',  # armstrongtire - context - competitors
        '115098791',  # armstrongtire - context - conversionnye
        '115098774',  # armstrongtire - context - kategorii
        '115098812',  # armstrongtire - context - popular
    }
)

DEFAULT_CRITICAL_ACCOUNTS = ('leovit-mtg',)
DEFAULT_CHECKPOINT_ACCOUNTS = ('leovit-mtg', 'porg-47e7bbnx')


def clean_text(value) -> str:
    if value is None:
        return ''
    return str(value).strip()


def parse_csv_list(value: str | None, default: Iterable[str]) -> tuple[str, ...]:
    if value is None or not str(value).strip():
        items = [clean_text(item) for item in default]
    else:
        items = [clean_text(item) for item in str(value).split(',')]
    deduped: list[str] = []
    for item in items:
        if item and item not in deduped:
            deduped.append(item)
    return tuple(deduped)


def resolve_account_bridge(campaign_id: str, campaign_meta: dict[str, dict[str, str]]) -> tuple[str, str, bool]:
    brand = clean_text(campaign_meta.get(campaign_id, {}).get('brand'))
    if brand:
        return brand, brand, False
    fallback_id = f'campaign::{campaign_id}'
    fallback_name = f'Yandex Direct campaign account {campaign_id}'
    return fallback_id, fallback_name, True
