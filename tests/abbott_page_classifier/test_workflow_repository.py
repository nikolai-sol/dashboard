"""Executable fake-DB coverage for the production weekly workflow store."""

from __future__ import annotations

from dataclasses import asdict
from datetime import date, datetime, timezone
import json
import unittest

from agents.abbott_page_classifier.approval_hashes import (
    compute_classification_event_fingerprint,
    compute_taxonomy_digest,
)
from agents.abbott_page_classifier.domain import TAXONOMY_LABELS, TaxonomyVersion
from agents.abbott_page_classifier.domain import MaterialCandidate
from agents.abbott_page_classifier.llm_classifier import (
    LlmAttempt,
    LlmClassification,
    LlmUsage,
)
from agents.abbott_page_classifier.reconcile import ReconciliationInput, reconcile_entity
from agents.abbott_page_classifier.repository import RepositoryError
from agents.abbott_page_classifier.sources import RejectedSourceRow
from agents.abbott_page_classifier.workflow_repository import (
    MySqlWorkflowStore,
    _load_active_strong_url_aliases,
    _canonical_json,
    _input_from_payload,
    _input_payload,
    _run_key,
)
from agents.abbott_page_classifier.sources import (
    SourceCandidate,
    SourceIdentityVariant,
    SourceProvenance,
)
from agents.abbott_page_classifier.candidate_release import _catalog_rows
from agents.abbott_page_classifier.workflow_service import (
    PersistedSourceBinding,
    ReconciliationContext,
    WorkflowConfiguration,
)


TERMS = {kind: tuple(sorted(labels)) for kind, labels in TAXONOMY_LABELS.items()}
DIGEST = compute_taxonomy_digest("abbott.v1", TERMS)
CONFIG = WorkflowConfiguration("abbott.v1", "prompt.v1", "routing.v1", "a" * 40)


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rows = []
        self.lastrowid = 0
        self.rowcount = 0

    def execute(self, sql, params=()):
        normalized = " ".join(sql.split())
        self.connection.calls.append((normalized, params))
        self.rows = []
        self.rowcount = 0
        if "FROM portal_active_data_releases AS active" in normalized:
            self.rows = [(8, "[11,12]")]
        elif "FROM portal_dataset_snapshots" in normalized and "id IN" in normalized:
            self.rows = [(11, "1" * 64), (12, "2" * 64)]
        elif "FROM portal_content_taxonomy_versions" in normalized:
            self.rows = [(3, DIGEST)]
        elif "FROM portal_content_taxonomy_terms" in normalized:
            self.rows = [(kind, code) for kind, codes in TERMS.items() for code in codes]
        elif "FROM portal_content_registry_entities AS entity" in normalized:
            # The LEFT JOIN must retain this entity even without an event.
            self.rows = [(7, "Eventless", "https://abbottpro.ru/eventless", None, None, None, None, None)]
        elif "FROM portal_content_registry_aliases" in normalized:
            self.rows = [(7, "canonical_url", "https://abbottpro.ru/eventless", "strong")]
        elif (
            "FROM portal_content_llm_attempts" in normalized
            or "INNER JOIN portal_content_llm_attempts" in normalized
        ):
            self.rows = list(self.connection.llm_rows)
        elif "FROM portal_content_reconciliation_items" in normalized:
            self.rows = [(44,)]
        elif normalized.startswith("INSERT INTO portal_content_llm_attempts"):
            self.lastrowid = 91
            self.rowcount = 1

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)

    def close(self):
        pass


class FakeConnection:
    def __init__(self):
        self.calls = []
        self.llm_rows = []
        self.commit_count = 0
        self.rollback_count = 0
        self.cursor_instance = FakeCursor(self)

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        self.commit_count += 1

    def rollback(self):
        self.rollback_count += 1

    def close(self):
        pass


class StrongAliasCursor:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params=()):
        self.calls.append((" ".join(sql.split()), params))

    def fetchall(self):
        return [(7, "canonical_url", "https://abbottpro.ru/cardio/alpha")]


class RehydrationCursor(FakeCursor):
    def __init__(self, connection, *, version="abbott.v2", stored_digest=None):
        super().__init__(connection)
        self.version = version
        self.taxonomy = TaxonomyVersion(
            version=version,
            terms=TERMS,
            digest=compute_taxonomy_digest(version, TERMS),
        )
        self.stored_digest = stored_digest or self.taxonomy.digest
        configuration = WorkflowConfiguration(
            version, "prompt.v2", "routing.v2", "b" * 40
        )
        context = ReconciliationContext(
            predecessor_release_id=8,
            predecessor_snapshot_ids=(11, 12),
            predecessor_snapshot_digests=("1" * 64, "2" * 64),
            taxonomy=self.taxonomy,
            entities=(),
            aliases=(),
        )
        self.run_key = _run_key(configuration, context, "3" * 64, "4" * 64)

    def execute(self, sql, params=()):
        normalized = " ".join(sql.split())
        self.connection.calls.append((normalized, params))
        self.rows = []
        if "FROM portal_content_reconciliation_runs" in normalized:
            self.rows = [(
                self.run_key, "reconciled",
                31, "3" * 64, 1, 1, 0, 0,
                32, "4" * 64, 1, 1, 0, 0,
                8, "[11,12]", f'["{"1" * 64}","{"2" * 64}"]',
                5, self.version, self.stored_digest,
                "prompt.v2", "routing.v2", "b" * 40,
            )]
        elif "FROM portal_content_taxonomy_terms" in normalized:
            self.rows = [
                (kind, code) for kind, codes in TERMS.items() for code in codes
            ]
        elif "FROM portal_content_reconciliation_items" in normalized:
            self.rows = []


class RehydrationConnection(FakeConnection):
    def __init__(self, *, version="abbott.v2", stored_digest=None):
        super().__init__()
        self.cursor_instance = RehydrationCursor(
            self, version=version, stored_digest=stored_digest
        )


class EntityCreationCursor(FakeCursor):
    def __init__(self, connection, candidate):
        super().__init__(connection)
        self.candidate = candidate
        self.entities = {}
        self.aliases = []

    def execute(self, sql, params=()):
        normalized = " ".join(sql.split())
        self.connection.calls.append((normalized, params))
        self.rows = []
        self.rowcount = 0
        if (
            "FROM portal_active_data_releases" in normalized
            and "canonical_release_id" in normalized
        ):
            self.rows = [(8,)]
        elif "FROM portal_content_reconciliation_runs" in normalized:
            self.rows = [("reconciled",)]
        elif (
            "FROM portal_content_reconciliation_items" in normalized
            and "identity_status, registry1_json" in normalized
        ):
            self.rows = [("new", _canonical_json(asdict(self.candidate)))]
        elif normalized.startswith("SELECT id FROM portal_content_registry_entities"):
            self.rows = [(entity_id,) for entity_id in sorted(self.entities)]
        elif normalized.startswith("SELECT id FROM portal_content_registry_aliases"):
            self.rows = []
        elif "FROM portal_content_registry_entities AS entity" in normalized:
            self.rows = [
                (
                    entity_id,
                    entity["title"],
                    entity["canonical_url"],
                    None,
                    None,
                    None,
                    None,
                    None,
                )
                for entity_id, entity in sorted(self.entities.items())
            ]
        elif "FROM portal_content_registry_aliases" in normalized:
            self.rows = [
                (
                    alias["content_entity_id"],
                    alias["alias_type"],
                    alias["alias_value"],
                    alias["uniqueness_scope"],
                )
                for alias in self.aliases
            ]
        elif normalized.startswith("INSERT INTO portal_content_registry_entities"):
            self.lastrowid = 101
            self.entities[self.lastrowid] = {
                "material_id": params[1],
                "title": params[2],
                "canonical_url": params[3],
                "source_evidence": json.loads(params[4]),
            }
            self.rowcount = 1
        elif normalized.startswith("INSERT INTO portal_content_registry_aliases"):
            self.aliases.append(
                {
                    "content_entity_id": int(params[1]),
                    "alias_type": params[2],
                    "alias_value": params[3],
                    "uniqueness_scope": params[5],
                    "source_evidence": json.loads(params[6]),
                }
            )
            self.rowcount = 1


class EntityCreationConnection(FakeConnection):
    def __init__(self, candidate):
        super().__init__()
        self.cursor_instance = EntityCreationCursor(self, candidate)


def _baseline_evidence(fingerprint):
    return {
        "authority": "active_release_baseline",
        "predecessor_release_id": 8,
        "source_row_fingerprints": [fingerprint],
    }


def _baseline_event(entity_id, fingerprint, *, taxonomy_id=3):
    evidence = _baseline_evidence(fingerprint)
    values = {
        "content_entity_id": entity_id,
        "taxonomy_version_id": taxonomy_id,
        "direction_code": "cardiology",
        "material_type_code": "articles",
        "access_code": "all",
        "lifecycle_code": "active",
        "event_kind": "baseline",
        "proposal_evidence": evidence,
        "effective_at": "1970-01-01T00:00:00.000000+00:00",
    }
    return {
        **values,
        "event_fingerprint": compute_classification_event_fingerprint(values),
        "effective_at": datetime(1970, 1, 1, tzinfo=timezone.utc),
        "id": 50 + entity_id,
    }


class BootstrapCursor(FakeCursor):
    def __init__(self, connection, *, conflict=None):
        super().__init__(connection)
        self.catalog_locked = False
        self.catalog = [
            ("Existing", "https://abbottpro.ru/existing", "100", "articles", "all", "cardiology", 1, 11, "pages", 1, "f1"),
            ("Missing", "https://abbottpro.ru/missing", "200", "articles", "all", "cardiology", 1, 11, "pages", 2, "f2"),
        ]
        evidence = _baseline_evidence("f1")
        self.entities = {
            7: {
                "material_id": "100", "title": "Existing",
                "canonical_url": "https://abbottpro.ru/existing",
                "registry_status": "active", "source_evidence": evidence,
            }
        }
        self.aliases = []
        for alias_type, value, scope in (
            ("material_id", "100", "strong"),
            ("canonical_url", "https://abbottpro.ru/existing", "strong"),
            ("url", "https://abbottpro.ru/existing", "strong"),
            ("slug", "existing", "weak"),
            ("title", "Existing", "weak"),
        ):
            self.aliases.append({
                "content_entity_id": 7, "alias_type": alias_type,
                "alias_value": value, "alias_hash": __import__("hashlib").sha256(value.casefold().encode()).hexdigest(),
                "uniqueness_scope": scope, "alias_status": "active",
                "source_evidence": evidence,
            })
        self.events = {7: _baseline_event(7, "f1")}
        if conflict == "strong_alias":
            self.aliases[0]["content_entity_id"] = 99
        elif conflict == "taxonomy_event":
            self.events[7] = _baseline_event(7, "f1", taxonomy_id=99)
        elif conflict == "event_payload":
            self.events[7]["material_type_code"] = "video"
        self.inserted_entity_ids = []

    def execute(self, sql, params=()):
        normalized = " ".join(sql.split())
        self.connection.calls.append((normalized, params))
        self.rows = []
        self.rowcount = 0
        if "FROM portal_active_data_releases AS active" in normalized:
            self.rows = [(8, "[11,12]")]
        elif "FROM portal_dataset_snapshots" in normalized and "id IN" in normalized:
            self.rows = [(11, "1" * 64), (12, "2" * 64)]
        elif "FROM portal_content_taxonomy_versions" in normalized:
            self.rows = [(3, DIGEST)]
        elif "FROM portal_content_taxonomy_terms" in normalized:
            self.rows = [(kind, code) for kind, codes in TERMS.items() for code in codes]
        elif "WITH ranked_catalog AS" in normalized:
            rows_by_entity = {}
            for row in self.catalog:
                entity_id = int(row[11]) if len(row) > 11 and row[11] else None
                if entity_id is None:
                    for current_id, entity in self.entities.items():
                        if (
                            entity["material_id"] == row[2]
                            or entity["canonical_url"] == row[1]
                        ):
                            entity_id = current_id
                            break
                if entity_id is None:
                    continue
                candidate = (
                    entity_id, row[0], row[1], row[5], row[3], row[4], row[6]
                )
                prior = rows_by_entity.get(entity_id)
                if prior is None or (not prior[2], prior[2]) > (
                    not candidate[2], candidate[2]
                ):
                    rows_by_entity[entity_id] = candidate
            self.rows = [rows_by_entity[key] for key in sorted(rows_by_entity)]
        elif normalized.startswith(
            "SELECT DISTINCT content_entity_id FROM portal_content_catalog"
        ):
            entity_ids = set()
            for row in self.catalog:
                if len(row) > 11 and row[11] is not None:
                    entity_ids.add(int(row[11]))
                    continue
                for entity_id, entity in self.entities.items():
                    if (
                        entity["material_id"] == row[2]
                        or entity["canonical_url"] == row[1]
                    ):
                        entity_ids.add(entity_id)
            self.rows = [(entity_id,) for entity_id in sorted(entity_ids)]
        elif "FROM portal_content_catalog" in normalized:
            self.catalog_locked = "FOR UPDATE" in normalized
            self.rows = list(self.catalog)
        elif "SELECT id, material_id, title, canonical_url" in normalized:
            material_id, urls = params[1], tuple(params[2:-2])
            predecessor_id = int(params[-2])
            fingerprints = json.loads(params[-1])
            self.rows = [
                (entity_id, entity["material_id"], entity["title"],
                 entity["canonical_url"], entity["registry_status"],
                 _canonical_json(entity["source_evidence"]))
                for entity_id, entity in self.entities.items()
                if (
                    material_id is not None
                    and entity["material_id"] == material_id
                ) or entity["canonical_url"] in urls or (
                    entity["source_evidence"].get("authority")
                    == "active_release_baseline"
                    and entity["source_evidence"].get("predecessor_release_id")
                    == predecessor_id
                    and entity["source_evidence"].get("source_row_fingerprints")
                    == fingerprints
                )
            ]
        elif (
            "SELECT entity.id, entity.registry_status" in normalized
            and "entity.id IN" in normalized
        ):
            entity_ids = {int(value) for value in params[1:]}
            self.rows = [
                (entity_id, entity["registry_status"])
                for entity_id, entity in sorted(self.entities.items())
                if entity_id in entity_ids
            ]
        elif (
            "SELECT event.id, event.content_entity_id" in normalized
            and "event.id IN" in normalized
        ):
            event_ids = {int(value) for value in params}
            self.rows = [
                (
                    event["id"], entity_id, event["taxonomy_version_id"],
                    event["direction_code"], event["material_type_code"],
                    event["access_code"], event["lifecycle_code"],
                    event["event_fingerprint"],
                )
                for entity_id, event in sorted(self.events.items())
                if event["id"] in event_ids
            ]
        elif "FROM portal_content_registry_aliases" in normalized and "alias_type = %s" in normalized:
            alias_type, alias_hash, scope = params[1], params[2], params[3]
            self.rows = [
                (alias["content_entity_id"], alias["alias_type"], alias["alias_value"],
                 alias["alias_hash"], alias["uniqueness_scope"], alias["alias_status"],
                 _canonical_json(alias["source_evidence"]))
                for alias in self.aliases
                if alias["alias_type"] == alias_type
                and alias["alias_hash"] == alias_hash
                and alias["uniqueness_scope"] == scope
            ]
        elif "FROM portal_content_classification_events" in normalized and "event_kind = 'baseline'" in normalized:
            event = self.events.get(int(params[0]))
            if event:
                self.rows = [(
                    event["taxonomy_version_id"], event["direction_code"],
                    event["material_type_code"], event["access_code"],
                    event["lifecycle_code"], event["event_fingerprint"],
                    _canonical_json(event["proposal_evidence"]), event["effective_at"],
                )]
        elif "FROM portal_content_registry_entities AS entity" in normalized:
            self.rows = []
            for entity_id, entity in sorted(self.entities.items()):
                event = self.events.get(entity_id)
                self.rows.append((
                    entity_id, entity["title"], entity["canonical_url"],
                    event["direction_code"] if event else None,
                    event["material_type_code"] if event else None,
                    event["access_code"] if event else None,
                    event["lifecycle_code"] if event else None,
                    event["id"] if event else None,
                ))
        elif "FROM portal_content_registry_aliases" in normalized:
            self.rows = [
                (alias["content_entity_id"], alias["alias_type"],
                 alias["alias_value"], alias["uniqueness_scope"])
                for alias in self.aliases if alias["alias_status"] == "active"
            ]
        elif normalized.startswith("INSERT INTO portal_content_registry_entities"):
            self.lastrowid = max(self.entities, default=0) + 1
            self.entities[self.lastrowid] = {
                "material_id": params[1], "title": params[2],
                "canonical_url": params[3], "registry_status": params[4],
                "source_evidence": json.loads(params[5]),
            }
            self.inserted_entity_ids.append(self.lastrowid)
            self.rowcount = 1
        elif normalized.startswith("INSERT INTO portal_content_registry_aliases"):
            self.aliases.append({
                "content_entity_id": int(params[1]), "alias_type": params[2],
                "alias_value": params[3], "alias_hash": params[4],
                "uniqueness_scope": params[5], "alias_status": "active",
                "source_evidence": json.loads(params[6]),
            })
            self.rowcount = 1
        elif normalized.startswith("INSERT INTO portal_content_classification_events"):
            self.events[int(params[0])] = {
                "taxonomy_version_id": int(params[1]), "direction_code": params[2],
                "material_type_code": params[3], "access_code": params[4],
                "lifecycle_code": params[5], "event_fingerprint": params[6],
                "proposal_evidence": json.loads(params[7]), "effective_at": params[8],
                "id": 100 + int(params[0]),
            }
            self.rowcount = 1


class BootstrapConnection(FakeConnection):
    def __init__(self, *, conflict=None):
        super().__init__()
        self.cursor_instance = BootstrapCursor(self, conflict=conflict)


class MySqlWorkflowStoreTests(unittest.TestCase):
    def test_observed_page_query_is_aggregate_only_and_drops_off_domain_rows(self):
        class Cursor:
            def __init__(self): self.calls = []
            def execute(self, sql, params): self.calls.append((" ".join(sql.split()), params))
            def fetchall(self):
                return [
                    ("https://abbottpro.ru/auth", "Вход", 5, date(2026, 8, 1), date(2026, 8, 2)),
                    ("https://example.test/nope", "Nope", 3, date(2026, 8, 1), date(2026, 8, 1)),
                ]

        cursor = Cursor()
        pages = MySqlWorkflowStore._load_observed_pages(cursor, 24)

        self.assertEqual(pages[0].normalized_url, "https://abbottpro.ru/auth")
        self.assertEqual(len(pages), 1)
        sql, params = cursor.calls[0]
        self.assertEqual(params, (24,))
        self.assertIn("canonical_fact_metrika_site_analytics_daily", sql)
        self.assertIn("SUM(pageviews)", sql)
        self.assertNotIn("canonical_fact_metrika_visits", sql)

    def test_load_active_strong_url_aliases_is_constrained_and_ordered(self):
        cursor = StrongAliasCursor()

        aliases = _load_active_strong_url_aliases(cursor)

        self.assertEqual(aliases[0].content_entity_id, 7)
        self.assertEqual(aliases[0].alias_type, "canonical_url")
        self.assertEqual(aliases[0].alias_value, "https://abbottpro.ru/cardio/alpha")
        sql, params = cursor.calls[0]
        self.assertEqual(params, ())
        self.assertIn("dataset_key = 'abbott'", sql)
        self.assertIn("alias_status = 'active'", sql)
        self.assertIn("uniqueness_scope = 'strong'", sql)
        self.assertIn("alias_type IN ('canonical_url', 'url')", sql)
        self.assertIn("ORDER BY content_entity_id, alias_type, alias_hash", sql)
    def test_distinct_rejected_source_inputs_round_trip_durable_payload(self):
        rejected_rows = tuple(
            RejectedSourceRow(
                source_name="registry1",
                source_row_id=f"registry1:кардио:{ordinal}",
                reason_code="MISSING_IDENTITY",
                source_fingerprint=str(ordinal) * 64,
            )
            for ordinal in (2, 3)
        )
        inputs = tuple(
            ReconciliationInput(
                content_available=False,
                rejection_code=rejected.reason_code,
                rejected_source_row=rejected,
            )
            for rejected in rejected_rows
        )

        replayed = tuple(_input_from_payload(_input_payload(value)) for value in inputs)

        self.assertNotIn("rejected_source_row", _input_payload(ReconciliationInput()))
        self.assertEqual(replayed, inputs)
        self.assertEqual(
            len({reconcile_entity(value).input_hash for value in replayed}), 2
        )

    def test_observed_material_candidate_round_trips_durable_payload(self):
        observed = MaterialCandidate(
            source_name="observed_page",
            source_row_id="observed:https://abbottpro.ru/auth",
            title="Вход",
            url="https://abbottpro.ru/auth",
            material_id=None,
            direction_code=None,
            material_type_code=None,
            access_code=None,
            lifecycle_code="active",
            source_fingerprint="a" * 64,
        )
        value = ReconciliationInput(registry1=observed)

        replayed = _input_from_payload(_input_payload(value))

        self.assertEqual(replayed, value)
        self.assertEqual(
            reconcile_entity(replayed).input_hash,
            reconcile_entity(value).input_hash,
        )

    def test_new_registry1_entity_persists_and_emits_every_source_occurrence(self):
        candidate = SourceCandidate(
            key="material:900",
            candidate=MaterialCandidate(
                source_name="registry1",
                source_row_id="registry1:Кардиология:2",
                title="Alpha",
                url="https://abbottpro.ru/cardio/alpha",
                material_id="900",
                direction_code="cardiology",
                material_type_code="articles",
                access_code="doctors",
                lifecycle_code="active",
                source_fingerprint="a" * 64,
            ),
            provenance=(
                SourceProvenance(
                    "registry1", "registry1:Кардиология:2", "a" * 64
                ),
                SourceProvenance(
                    "registry1", "registry1:Кардиология:3", "b" * 64
                ),
            ),
            identity_variants=(
                SourceIdentityVariant(
                    "registry1:Кардиология:2",
                    "900",
                    "https://abbottpro.ru/cardio/alpha",
                    "Alpha",
                    "articles",
                    direction_code="cardiology",
                    access_code="doctors",
                    lifecycle_code="active",
                ),
                SourceIdentityVariant(
                    "registry1:Кардиология:3",
                    "900",
                    "https://abbottpro.ru/cardio/alpha-print",
                    "Alpha print",
                    "articles",
                    direction_code="cardiology",
                    access_code="doctors",
                    lifecycle_code="active",
                ),
            ),
        )
        connection = EntityCreationConnection(candidate)
        resolved = MySqlWorkflowStore(
            lambda: connection
        ).resolve_or_create_registry1_entities(19, ("registry1:material:900",))

        self.assertEqual(resolved, {"registry1:material:900": 101})
        evidence = connection.cursor_instance.entities[101]["source_evidence"]
        self.assertEqual(
            [row["source_row_id"] for row in evidence["provenance"]],
            ["registry1:Кардиология:2", "registry1:Кардиология:3"],
        )
        self.assertEqual(
            [row["source_row_fingerprint"] for row in evidence["provenance"]],
            ["a" * 64, "b" * 64],
        )
        self.assertEqual(
            {alias["alias_value"] for alias in connection.cursor_instance.aliases},
            {
                "900",
                "https://abbottpro.ru/cardio/alpha",
                "https://abbottpro.ru/cardio/alpha-print",
                "alpha",
                "alpha-print",
                "Alpha",
                "Alpha print",
            },
        )
        rows = _catalog_rows(
            (
                {
                    "content_entity_id": 101,
                    "classification_event_id": 501,
                    "event_fingerprint": "c" * 64,
                    "effective_at": datetime(2026, 8, 6, tzinfo=timezone.utc),
                    "source_evidence": evidence,
                    "direction_code": "cardiology",
                    "direction_label": "Кардиология [262338]",
                    "material_type_code": "articles",
                    "material_type_label": "Статьи",
                    "access_code": "doctors",
                    "access_label": "Врачи",
                    "lifecycle_code": "active",
                    "lifecycle_label": "active",
                },
            )
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(
            {
                (row.normalized_url, row.source_sheet, row.source_row_ordinal,
                 row.source_row_fingerprint)
                for row in rows
            },
            {
                (
                    "https://abbottpro.ru/cardio/alpha",
                    "Кардиология",
                    2,
                    "a" * 64,
                ),
                (
                    "https://abbottpro.ru/cardio/alpha-print",
                    "Кардиология",
                    3,
                    "b" * 64,
                ),
            },
        )

    def test_context_locks_active_predecessor_and_keeps_eventless_entities(self):
        connection = BootstrapConnection()
        connection.cursor_instance.entities[9] = {
            "material_id": "unrelated", "title": "Eventless",
            "canonical_url": "https://abbottpro.ru/eventless",
            "registry_status": "active",
            "source_evidence": {"authority": "unrelated-reviewed-entity"},
        }
        context = MySqlWorkflowStore(lambda: connection).load_reconciliation_context(CONFIG)

        self.assertEqual(context.predecessor_release_id, 8)
        self.assertEqual(context.predecessor_snapshot_ids, (11, 12))
        self.assertEqual(context.predecessor_snapshot_digests, ("1" * 64, "2" * 64))
        eventless = next(entity for entity in context.entities if entity.content_entity_id == 9)
        self.assertEqual(eventless.lifecycle_code, "unknown")
        self.assertEqual(eventless.event_id, None)
        self.assertNotIn(9, context.predecessor_content_entity_ids)
        self.assertTrue(context.predecessor_content_entity_ids)
        self.assertEqual(
            {entity.content_entity_id for entity in context.predecessor_catalog_entities},
            set(context.predecessor_content_entity_ids),
        )
        sql = "\n".join(statement for statement, _ in connection.calls)
        self.assertIn("FOR UPDATE", sql)
        self.assertIn("LEFT JOIN latest_events AS event", sql)
        self.assertEqual(connection.commit_count, 1)

    def test_append_llm_attempt_is_append_only_and_usage_bounded(self):
        connection = FakeConnection()
        attempt = LlmAttempt(
            status="unresolved",
            model="gpt-5.6-terra",
            unresolved_code="LLM_INSUFFICIENT_EVIDENCE",
            attempt_count=1,
            input_hash="f" * 64,
            requested_fields=("direction_code",),
            usage=LlmUsage(input_tokens=12, output_tokens=3, total_tokens=15),
            elapsed_ms=7,
        )
        MySqlWorkflowStore(lambda: connection).append_llm_attempt(
            4, "b" * 64, "terra_primary", attempt
        )

        sql = "\n".join(statement for statement, _ in connection.calls)
        self.assertIn("INSERT INTO portal_content_llm_attempts", sql)
        self.assertNotRegex(sql, r"UPDATE portal_content_llm_attempts|DELETE FROM portal_content_llm_attempts")
        insert_params = next(params for statement, params in connection.calls if statement.startswith("INSERT INTO portal_content_llm_attempts"))
        self.assertIn(12, insert_params)
        self.assertIn(3, insert_params)
        self.assertIn(7, insert_params)
        self.assertFalse(any("bounded source" in str(value) for value in insert_params))
        self.assertEqual(connection.commit_count, 1)

    def test_load_llm_attempts_rehydrates_and_attests_stored_primary(self):
        connection = FakeConnection()
        classification = LlmClassification(
            direction_code="cardiology",
            material_type_code="articles",
            direction_confidence=0.9,
            material_type_confidence=0.8,
            alternative_direction_codes=(),
            evidence=("path",),
            requires_medical_review=False,
            insufficient_evidence=False,
        )
        attempt = LlmAttempt(
            status="success",
            model="gpt-5.6-terra",
            classification=classification,
            attempt_count=1,
            input_hash="f" * 64,
            requested_fields=("direction_code", "material_type_code"),
            usage=LlmUsage(input_tokens=12, output_tokens=3, total_tokens=15),
            elapsed_ms=7,
        )
        payload = {
            "attempt_count": 1,
            "input_hash": "f" * 64,
            "item_key": "b" * 64,
            "model": "gpt-5.6-terra",
            "requested_fields": attempt.requested_fields,
            "route_kind": "terra_primary",
            "run_id": 4,
            "status": "success",
            "strict_result": classification.model_dump(mode="json"),
            "unresolved_code": None,
        }
        connection.llm_rows = [(
            "terra_primary", 1, attempt.model, attempt.input_hash,
            _canonical_json(attempt.requested_fields),
            _canonical_json(classification.model_dump(mode="json")),
            None, 12, 3, 7,
            __import__("hashlib").sha256(
                _canonical_json(payload).encode("utf-8")
            ).hexdigest(),
        )]

        loaded = MySqlWorkflowStore(lambda: connection).load_llm_attempts(
            4, "b" * 64
        )

        self.assertEqual(loaded, {"terra_primary": attempt})

    def test_run_rehydration_uses_the_taxonomy_version_joined_by_stored_fk(self):
        connection = RehydrationConnection(version="abbott.v2")

        run = MySqlWorkflowStore(lambda: connection).load_reconciliation_run(19)

        self.assertEqual(run.configuration.taxonomy_version, "abbott.v2")
        self.assertEqual(run.context.taxonomy.version, "abbott.v2")
        sql = "\n".join(statement for statement, _params in connection.calls)
        self.assertIn("INNER JOIN portal_content_taxonomy_versions AS taxonomy", sql)
        self.assertNotIn("abbott.v1", sql)

    def test_run_rehydration_rejects_stored_version_digest_mismatch(self):
        connection = RehydrationConnection(
            version="abbott.v2",
            stored_digest=compute_taxonomy_digest("abbott.v1", TERMS),
        )

        with self.assertRaisesRegex(
            RepositoryError, "TAXONOMY_CONTRACT_MISMATCH"
        ):
            MySqlWorkflowStore(lambda: connection).load_reconciliation_run(19)

    def test_partial_baseline_bootstrap_attests_existing_and_inserts_only_missing(self):
        connection = BootstrapConnection()

        context_value = MySqlWorkflowStore(
            lambda: connection
        ).load_reconciliation_context(CONFIG)

        cursor = connection.cursor_instance
        self.assertTrue(cursor.catalog_locked)
        self.assertEqual(cursor.inserted_entity_ids, [8])
        self.assertEqual(sorted(entity.content_entity_id for entity in context_value.entities), [7, 8])
        self.assertEqual(connection.commit_count, 1)
        self.assertEqual(connection.rollback_count, 0)

    def test_successor_release_uses_catalog_provenance_without_rebootstrapping_entities(self):
        connection = BootstrapConnection()
        cursor = connection.cursor_instance
        event = cursor.events[7]
        event["lifecycle_code"] = "archive_candidate"
        event_values = {
            "content_entity_id": 7,
            "taxonomy_version_id": event["taxonomy_version_id"],
            "direction_code": event["direction_code"],
            "material_type_code": event["material_type_code"],
            "access_code": event["access_code"],
            "lifecycle_code": event["lifecycle_code"],
            "event_kind": "baseline",
            "proposal_evidence": event["proposal_evidence"],
            "effective_at": "1970-01-01T00:00:00.000000+00:00",
        }
        event["event_fingerprint"] = compute_classification_event_fingerprint(
            event_values
        )
        cursor.catalog = [
            cursor.catalog[0]
            + (7, event["id"], event["event_fingerprint"])
        ]
        cursor.entities[7]["source_evidence"] = {
            "authority": "registry1_reconciliation",
            "reconciliation_run_id": 3,
        }

        context = MySqlWorkflowStore(
            lambda: connection
        ).load_reconciliation_context(CONFIG)

        self.assertEqual(
            [entity.content_entity_id for entity in context.entities], [7]
        )
        self.assertEqual(cursor.inserted_entity_ids, [])
        self.assertEqual(connection.commit_count, 1)
        self.assertEqual(connection.rollback_count, 0)

    def test_successor_release_rejects_catalog_event_fingerprint_mismatch(self):
        connection = BootstrapConnection()
        cursor = connection.cursor_instance
        event = cursor.events[7]
        cursor.catalog = [cursor.catalog[0] + (7, event["id"], "0" * 64)]

        with self.assertRaisesRegex(
            RepositoryError, "BASELINE_PROVENANCE_EVENT_MISMATCH"
        ):
            MySqlWorkflowStore(
                lambda: connection
            ).load_reconciliation_context(CONFIG)

        self.assertEqual(connection.commit_count, 0)
        self.assertEqual(connection.rollback_count, 1)

    def test_identityless_baseline_bootstrap_is_replay_safe_by_source_evidence(self):
        connection = BootstrapConnection()
        cursor = connection.cursor_instance
        cursor.catalog = [
            (
                "Identityless",
                "",
                None,
                "articles",
                "all",
                "cardiology",
                1,
                11,
                "pages",
                7,
                "identityless-fingerprint",
            )
        ]
        cursor.entities = {}
        cursor.aliases = []
        cursor.events = {}

        store = MySqlWorkflowStore(lambda: connection)
        first = store.load_reconciliation_context(CONFIG)
        second = store.load_reconciliation_context(CONFIG)

        self.assertEqual(len(first.entities), 1)
        self.assertEqual(len(second.entities), 1)
        self.assertEqual(cursor.inserted_entity_ids, [1])

    def test_partial_baseline_bootstrap_rolls_back_identity_taxonomy_and_event_conflicts(self):
        for conflict, code in (
            ("strong_alias", "IDENTITY_COLLISION"),
            ("taxonomy_event", "BASELINE_EVENT_MISMATCH"),
            ("event_payload", "BASELINE_EVENT_MISMATCH"),
        ):
            with self.subTest(conflict=conflict):
                connection = BootstrapConnection(conflict=conflict)
                with self.assertRaisesRegex(RepositoryError, code):
                    MySqlWorkflowStore(
                        lambda: connection
                    ).load_reconciliation_context(CONFIG)
                    self.assertTrue(connection.cursor_instance.catalog_locked)
                self.assertEqual(connection.commit_count, 0)
                self.assertEqual(connection.rollback_count, 1)

    def test_baseline_duplicate_material_preserves_every_url_alias(self):
        connection = BootstrapConnection()
        cursor = connection.cursor_instance
        cursor.catalog.insert(
            1,
            (
                "Existing alternate",
                "https://abbottpro.ru/existing-alternate",
                "100",
                "articles",
                "all",
                "cardiology",
                1,
                11,
                "pages",
                3,
                "f3",
            ),
        )
        # Existing bootstrap evidence must attest the complete material group.
        grouped_evidence = _baseline_evidence("f1")
        grouped_evidence["source_row_fingerprints"] = ["f1", "f3"]
        cursor.entities[7]["source_evidence"] = grouped_evidence
        for alias in cursor.aliases:
            alias["source_evidence"] = grouped_evidence
        cursor.events[7] = _baseline_event(7, "f1")
        cursor.events[7]["proposal_evidence"] = grouped_evidence
        event_values = {
            "content_entity_id": 7,
            "taxonomy_version_id": 3,
            "direction_code": "cardiology",
            "material_type_code": "articles",
            "access_code": "all",
            "lifecycle_code": "active",
            "event_kind": "baseline",
            "proposal_evidence": grouped_evidence,
            "effective_at": "1970-01-01T00:00:00.000000+00:00",
        }
        cursor.events[7]["event_fingerprint"] = compute_classification_event_fingerprint(
            event_values
        )

        MySqlWorkflowStore(lambda: connection).load_reconciliation_context(CONFIG)

        url_aliases = {
            alias["alias_value"]
            for alias in cursor.aliases
            if alias["content_entity_id"] == 7
            and alias["alias_type"] in {"canonical_url", "url"}
        }
        self.assertEqual(
            url_aliases,
            {
                "https://abbottpro.ru/existing",
                "https://abbottpro.ru/existing-alternate",
            },
        )

    def test_baseline_duplicate_material_rejects_direction_or_type_disagreement(self):
        for column, value in ((5, "gastroenterology"), (3, "video"), (4, "doctors")):
            with self.subTest(column=column):
                connection = BootstrapConnection()
                row = list(connection.cursor_instance.catalog[0])
                row[column] = value
                row[9] = 3
                row[10] = "f3"
                connection.cursor_instance.catalog.insert(1, tuple(row))

                with self.assertRaisesRegex(
                    RepositoryError, "BASELINE_CLASSIFICATION_MISMATCH"
                ):
                    MySqlWorkflowStore(
                        lambda: connection
                    ).load_reconciliation_context(CONFIG)

    def test_baseline_material_id_without_url_is_replay_safe(self):
        connection = BootstrapConnection()
        cursor = connection.cursor_instance
        cursor.catalog = [(
            "Material without URL", None, "300", "articles", "all",
            "cardiology", 1, 11, "pages", 3, "f3",
        )]
        cursor.entities = {}
        cursor.aliases = []
        cursor.events = {}
        store = MySqlWorkflowStore(lambda: connection)

        first = store.load_reconciliation_context(CONFIG)
        second = store.load_reconciliation_context(CONFIG)

        self.assertEqual(len(first.entities), 1)
        self.assertEqual(first.entities, second.entities)
        self.assertEqual(cursor.inserted_entity_ids, [1])
        self.assertEqual(cursor.entities[1]["canonical_url"], "")

    def test_baseline_weak_alias_can_have_multiple_entity_owners(self):
        connection = BootstrapConnection()
        connection.cursor_instance.catalog[1] = (
            "Existing",
            "https://abbottpro.ru/missing",
            "200",
            "articles",
            "all",
            "cardiology",
            1,
            11,
            "pages",
            2,
            "f2",
        )

        MySqlWorkflowStore(lambda: connection).load_reconciliation_context(CONFIG)

        shared_title = [
            alias
            for alias in connection.cursor_instance.aliases
            if alias["alias_type"] == "title"
            and alias["alias_value"] == "Existing"
        ]
        self.assertEqual(
            {alias["content_entity_id"] for alias in shared_title},
            {7, 8},
        )


if __name__ == "__main__":
    unittest.main()
