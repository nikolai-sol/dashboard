#!/usr/bin/env python3
"""Stable direction registry for Abbott pages.

Rules (product):
  1. What was already set / approved earlier has HIGHER weight.
  2. Older acceptance > newer heuristic proposals.
  3. A page MUST NOT flip direction once locked (unless human force override).
  4. New pages from Metrika enter the approve queue only if unknown.

Storage: agents/abbott_page_classifier/out/direction_registry.jsonl
Each line is one lock event (append-only history). Effective map = latest
non-revoked lock per key; if multiple keys (url/slug/title) conflict, older
direction wins for the entity.

Keys (normalized):
  - url:<normalized>
  - slug:<slug>
  - title:<exact title>
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

DEFAULT_REGISTRY = (
    Path(__file__).resolve().parent / "out" / "direction_registry.jsonl"
)

# Epoch for workbook seed = "oldest" (maximum weight)
WORKBOOK_SEED_TS = "2020-01-01T00:00:00+00:00"


@dataclass
class RegistryEntry:
    key: str
    key_type: str  # url | slug | title
    direction: str
    material_type: str | None = None
    access: str | None = None
    title: str = ""
    url: str = ""
    slug: str = ""
    source: str = "unknown"  # workbook_initial | batch_approve | human_force | migrate
    approved_at: str = ""
    batch: str = ""
    revoked: bool = False
    notes: str = ""

    def weight(self) -> float:
        """Older approved_at → higher weight. Revoked → 0."""
        if self.revoked or not self.direction:
            return 0.0
        try:
            ts = datetime.fromisoformat(self.approved_at.replace("Z", "+00:00"))
        except Exception:
            ts = datetime.now(timezone.utc)
        # seconds since year 2000 inverted: older = larger
        base = datetime(2000, 1, 1, tzinfo=timezone.utc)
        age_days = max(0.0, (ts - base).total_seconds() / 86400.0)
        # weight decreases as age_days increases from seed... wait user wants OLDER = MORE weight
        # So weight = large for old dates: use (far_future - ts)
        far = datetime(2100, 1, 1, tzinfo=timezone.utc)
        return max(0.0, (far - ts).total_seconds())


class DirectionRegistry:
    def __init__(self, path: Path | None = None):
        self.path = path or DEFAULT_REGISTRY
        self.events: list[RegistryEntry] = []
        self._by_key: dict[str, RegistryEntry] = {}
        if self.path.exists():
            self.load()

    def load(self) -> None:
        self.events = []
        self._by_key = {}
        with self.path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                d = json.loads(line)
                e = RegistryEntry(**{k: d.get(k) for k in RegistryEntry.__dataclass_fields__})
                self.events.append(e)
                self._apply(e)

    def _apply(self, e: RegistryEntry) -> None:
        """Update effective map: higher weight wins; same weight → first (older event order)."""
        if e.revoked:
            # revoke only if same direction
            cur = self._by_key.get(e.key)
            if cur and cur.direction == e.direction:
                del self._by_key[e.key]
            return
        if not e.direction or e.direction == "Не определено":
            return
        cur = self._by_key.get(e.key)
        if cur is None:
            self._by_key[e.key] = e
            return
        # Prefer higher weight (older). Never flip to different direction with lower weight.
        if e.weight() > cur.weight():
            self._by_key[e.key] = e
        elif e.weight() == cur.weight() and e.direction == cur.direction:
            self._by_key[e.key] = e
        # else: ignore newer conflicting proposal — stability

    def append(self, entry: RegistryEntry) -> dict[str, Any]:
        """Append lock. Refuses silent flip: if key locked to other direction, return conflict."""
        if not entry.approved_at:
            entry.approved_at = datetime.now(timezone.utc).isoformat()
        cur = self._by_key.get(entry.key)
        if (
            cur
            and cur.direction
            and entry.direction
            and cur.direction != entry.direction
            and not entry.notes.startswith("force:")
            and entry.source != "human_force"
        ):
            return {
                "status": "conflict",
                "key": entry.key,
                "locked": cur.direction,
                "attempted": entry.direction,
                "locked_source": cur.source,
                "locked_at": cur.approved_at,
            }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(asdict(entry), ensure_ascii=False) + "\n")
        self.events.append(entry)
        self._apply(entry)
        return {"status": "ok", "key": entry.key, "direction": entry.direction}

    def lock_entity(
        self,
        *,
        direction: str,
        url: str = "",
        slug: str = "",
        title: str = "",
        material_type: str | None = None,
        access: str | None = None,
        source: str = "batch_approve",
        batch: str = "",
        notes: str = "",
        approved_at: str | None = None,
        force: bool = False,
    ) -> list[dict[str, Any]]:
        """Lock by all available keys (url, slug, title)."""
        from classify import normalize_url, extract_slug  # local package-less import

        results = []
        norm = normalize_url(url) if url else ""
        slug = slug or (extract_slug(norm) if norm else "")
        ts = approved_at or datetime.now(timezone.utc).isoformat()
        src = "human_force" if force else source
        note = (f"force:{notes}" if force and notes else notes) or (f"force" if force else "")

        for key_type, raw in (("url", norm), ("slug", slug), ("title", title)):
            if not raw:
                continue
            key = f"{key_type}:{raw}"
            e = RegistryEntry(
                key=key,
                key_type=key_type,
                direction=direction,
                material_type=material_type,
                access=access,
                title=title,
                url=norm,
                slug=slug,
                source=src,
                approved_at=ts,
                batch=batch,
                notes=note,
            )
            results.append(self.append(e))
        return results

    def lookup(
        self, *, url: str = "", slug: str = "", title: str = ""
    ) -> RegistryEntry | None:
        """Resolve locked direction. Prefer url > slug > title; then highest weight."""
        from classify import normalize_url, extract_slug

        norm = normalize_url(url) if url else ""
        slug = slug or (extract_slug(norm) if norm else "")
        candidates: list[RegistryEntry] = []
        for key_type, raw in (("url", norm), ("slug", slug), ("title", title)):
            if not raw:
                continue
            e = self._by_key.get(f"{key_type}:{raw}")
            if e:
                candidates.append(e)
        if not candidates:
            return None
        # If directions disagree, pick highest weight (oldest)
        candidates.sort(key=lambda e: e.weight(), reverse=True)
        return candidates[0]

    def is_locked(self, *, url: str = "", slug: str = "", title: str = "") -> bool:
        return self.lookup(url=url, slug=slug, title=title) is not None

    def seed_from_workbook(self, workbook_path: Path) -> dict[str, Any]:
        """Import existing non-empty directions as oldest locks (maximum weight)."""
        from classify import DIRECTION_BY_PREFIX, DIRECTION_BY_QUERY_ID, load_workbook

        # Allowlist: canonical direction labels only (skip dirty workbook cells)
        allowed = set(DIRECTION_BY_PREFIX.values()) | set(DIRECTION_BY_QUERY_ID.values())
        allowed.add("Дерматология")
        allowed.add("Фармацевты")
        # multi-label rare strings that start with a known direction are kept if fully listed later

        idx = load_workbook(workbook_path)
        added = 0
        skipped = 0
        conflicts = 0
        skipped_invalid = 0

        def is_valid_direction(direction: str | None) -> bool:
            if not direction:
                return False
            d = direction.strip()
            if d in allowed:
                return True
            # allow multi "A / B" if every part is allowed
            parts = [p.strip() for p in d.split("/") if p.strip()]
            if len(parts) > 1 and all(p in allowed for p in parts):
                return True
            return False

        def seed_meta(meta: dict[str, Any], url: str = "") -> None:
            nonlocal added, skipped, conflicts, skipped_invalid
            direction = meta.get("direction")
            if not direction:
                skipped += 1
                return
            if not is_valid_direction(direction):
                skipped_invalid += 1
                return
            res = self.lock_entity(
                direction=direction,
                url=url or "",
                slug=meta.get("slug") or "",
                title=meta.get("title") or "",
                material_type=meta.get("material_type"),
                access=meta.get("access"),
                source="workbook_initial",
                batch="seed-workbook",
                approved_at=WORKBOOK_SEED_TS,
                notes=f"sheet:{meta.get('sheet')}",
            )
            for r in res:
                if r.get("status") == "ok":
                    added += 1
                elif r.get("status") == "conflict":
                    conflicts += 1

        for title, meta in idx.by_title.items():
            seed_meta(meta)
        for slug, meta in idx.by_slug.items():
            seed_meta(meta)
        for url, meta in idx.by_url.items():
            seed_meta(meta, url=url)
        for url, meta in idx.events_by_url.items():
            seed_meta(
                {
                    "direction": meta.get("direction"),
                    "slug": "",
                    "title": meta.get("title") or "",
                    "material_type": meta.get("material_type"),
                    "access": meta.get("access"),
                    "sheet": "events",
                },
                url=url,
            )

        return {
            "added_events": added,
            "skipped_empty": skipped,
            "skipped_invalid_direction": skipped_invalid,
            "conflicts": conflicts,
            "effective_keys": len(self._by_key),
            "registry": str(self.path),
        }

    def stats(self) -> dict[str, Any]:
        dirs: dict[str, int] = {}
        for e in self._by_key.values():
            dirs[e.direction] = dirs.get(e.direction, 0) + 1
        return {
            "events": len(self.events),
            "effective_locks": len(self._by_key),
            "by_direction": dict(sorted(dirs.items(), key=lambda x: -x[1])),
            "path": str(self.path),
        }


def main(argv: list[str] | None = None) -> int:
    import argparse

    p = argparse.ArgumentParser(description="Abbott direction registry (stable locks)")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_seed = sub.add_parser("seed-workbook", help="Seed locks from Abbott names.xlsx")
    p_seed.add_argument(
        "--workbook",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "Abbott names.xlsx",
    )
    p_seed.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)

    p_stats = sub.add_parser("stats", help="Show registry stats")
    p_stats.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)

    p_lookup = sub.add_parser("lookup", help="Lookup lock for url/title/slug")
    p_lookup.add_argument("--url", default="")
    p_lookup.add_argument("--title", default="")
    p_lookup.add_argument("--slug", default="")
    p_lookup.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)

    args = p.parse_args(argv)
    if args.cmd == "seed-workbook":
        reg = DirectionRegistry(args.registry)
        # fresh seed only if empty; else merge
        info = reg.seed_from_workbook(args.workbook)
        print(json.dumps({**info, **reg.stats()}, ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "stats":
        reg = DirectionRegistry(args.registry)
        print(json.dumps(reg.stats(), ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "lookup":
        reg = DirectionRegistry(args.registry)
        e = reg.lookup(url=args.url, title=args.title, slug=args.slug)
        print(json.dumps(asdict(e) if e else None, ensure_ascii=False, indent=2))
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
