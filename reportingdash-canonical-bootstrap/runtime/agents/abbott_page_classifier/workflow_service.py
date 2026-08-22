"""Canonical weekly Abbott reconciliation and proposal-batch service.

The service is intentionally independent of command parsing and Google APIs.
It composes immutable captured sources with a canonical store, and stops after
one persisted proposal batch.  Human acceptance and release materialization are
separate stages.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from decimal import Decimal
import json
from pathlib import Path
from typing import Callable, Mapping, Protocol, Sequence

from .batch_service import PersistedApprovalBatch, build_batch
from .domain import CanonicalClassification, ConflictCode, MaterialCandidate, Proposal, TaxonomyVersion
from .identity import IdentityAlias, IdentityResolver
from .llm_classifier import (
    LLM_PRIMARY_MODEL,
    LLM_VERIFIER_MODEL,
    LlmAttempt,
    LlmClassification,
    LlmRequest,
    OpenAIContentClassifier,
    route_llm,
)
from .normalization import normalize_url, sha256_text
from .reconcile import ReconciliationInput, reconcile_entity
from .sources import (
    SourceCandidate,
    ObservedPage,
    SourceSnapshot,
    collapse_observed_pages,
    read_canonical_catalog,
    read_registry1,
    read_registry2_csv,
)


REGISTRY1_PARSER_VERSION = "registry1.xlsx.v1"
REGISTRY2_PARSER_VERSION = "registry2.capture.v1"


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


@dataclass(frozen=True)
class WorkflowConfiguration:
    taxonomy_version: str
    prompt_version: str
    model_routing_version: str
    code_revision: str

    def __post_init__(self) -> None:
        values = (
            self.taxonomy_version,
            self.prompt_version,
            self.model_routing_version,
        )
        if any(not isinstance(value, str) or not value.strip() for value in values):
            raise ValueError("WORKFLOW_CONFIGURATION_INVALID")
        revision = self.code_revision.lower()
        if len(revision) != 40 or any(character not in "0123456789abcdef" for character in revision):
            raise ValueError("CODE_REVISION_INVALID")
        object.__setattr__(self, "code_revision", revision)


@dataclass(frozen=True)
class ReconciliationContext:
    predecessor_release_id: int
    predecessor_snapshot_ids: tuple[int, ...]
    predecessor_snapshot_digests: tuple[str, ...]
    taxonomy: TaxonomyVersion
    entities: tuple[CanonicalClassification, ...]
    aliases: tuple[IdentityAlias, ...]
    predecessor_content_entity_ids: tuple[int, ...] = ()
    predecessor_catalog_entities: tuple[CanonicalClassification, ...] = ()
    observed_pages: tuple[ObservedPage, ...] = ()
    mnn_by_entity: Mapping[int, tuple[str, ...]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "predecessor_snapshot_ids", tuple(self.predecessor_snapshot_ids))
        object.__setattr__(self, "predecessor_snapshot_digests", tuple(self.predecessor_snapshot_digests))
        object.__setattr__(self, "entities", tuple(self.entities))
        object.__setattr__(self, "aliases", tuple(self.aliases))
        object.__setattr__(
            self,
            "predecessor_content_entity_ids",
            tuple(self.predecessor_content_entity_ids),
        )
        object.__setattr__(
            self,
            "predecessor_catalog_entities",
            tuple(self.predecessor_catalog_entities),
        )
        object.__setattr__(self, "observed_pages", tuple(self.observed_pages))
        normalized_mnn = {
            int(entity_id): tuple(sorted({str(label).strip() for label in labels if str(label).strip()}))
            for entity_id, labels in self.mnn_by_entity.items()
        }
        if any(entity_id <= 0 for entity_id in normalized_mnn):
            raise ValueError("MNN_CONTEXT_INVALID")
        object.__setattr__(self, "mnn_by_entity", normalized_mnn)
        if (
            self.predecessor_release_id <= 0
            or not self.predecessor_snapshot_ids
            or len(self.predecessor_snapshot_ids) != len(self.predecessor_snapshot_digests)
            or len(set(self.predecessor_snapshot_ids)) != len(self.predecessor_snapshot_ids)
            or any(snapshot_id <= 0 for snapshot_id in self.predecessor_snapshot_ids)
            or any(
                entity_id <= 0
                for entity_id in self.predecessor_content_entity_ids
            )
            or len(set(self.predecessor_content_entity_ids))
            != len(self.predecessor_content_entity_ids)
            or len(
                {
                    entity.content_entity_id
                    for entity in self.predecessor_catalog_entities
                }
            )
            != len(self.predecessor_catalog_entities)
            or any(
                len(digest) != 64
                or any(character not in "0123456789abcdef" for character in digest.lower())
                for digest in self.predecessor_snapshot_digests
            )
        ):
            raise ValueError("PREDECESSOR_BINDING_INVALID")


@dataclass(frozen=True)
class PersistedReconciliationItem:
    grouping_key: str
    item_key: str
    input_hash: str
    identity_status: str
    content_entity_id: int | None
    reconciliation_input: ReconciliationInput


@dataclass(frozen=True)
class PersistedReconciliationRun:
    run_id: int
    run_key: str
    observed_pages_hash: str | None
    status: str
    configuration: WorkflowConfiguration
    context: ReconciliationContext
    registry1: SourceSnapshot
    registry2: SourceSnapshot
    items: tuple[PersistedReconciliationItem, ...]


@dataclass(frozen=True)
class PersistedSourceBinding:
    source_name: str
    source_hash: str
    source_row_count: int
    accepted_count: int
    rejected_count: int
    duplicate_collapsed_count: int
    database_snapshot_id: int


@dataclass(frozen=True)
class ReconciliationReceipt:
    run_id: int
    run_key: str
    registry1_hash: str
    registry2_hash: str
    source_count: int
    catalog_gap_count: int
    ready_count: int
    conflict_count: int
    unresolved_count: int
    rejected_count: int
    no_change_count: int


@dataclass(frozen=True)
class ClassificationReceipt:
    run_id: int
    batch_id: int
    batch_key: str
    published_input_hash: str
    eligible_count: int
    ready_count: int
    conflict_count: int
    unresolved_count: int
    rejected_count: int
    no_change_count: int


class WorkflowStore(Protocol):
    def load_reconciliation_context(self, configuration: WorkflowConfiguration) -> ReconciliationContext: ...
    def persist_reconciliation_run(self, draft: PersistedReconciliationRun) -> PersistedReconciliationRun: ...
    def load_reconciliation_run(self, run_id: int) -> PersistedReconciliationRun: ...
    def load_finalized_batch_for_run(self, run_id: int) -> PersistedApprovalBatch | None: ...
    def load_llm_attempts(self, run_id: int, item_key: str) -> Mapping[str, LlmAttempt]: ...
    def resolve_or_create_registry1_entities(self, run_id: int, item_keys: Sequence[str]) -> Mapping[str, int]: ...
    def append_llm_attempt(self, run_id: int, item_key: str, route_kind: str, attempt: LlmAttempt) -> None: ...
    def finalize_reconciliation_run(self, run_id: int, batch: object) -> PersistedApprovalBatch: ...


def _counts(inputs: Sequence[ReconciliationInput]) -> dict[str, int]:
    values = {state: 0 for state in ("ready", "conflict", "unresolved", "rejected", "no_change")}
    for item in inputs:
        values[reconcile_entity(item).readiness_state] += 1
    return values


def _source_candidate_key(source: str, candidate: SourceCandidate) -> str:
    return f"{source}:{candidate.key}"


def _classification_proposal(value: LlmClassification, rule_code: str) -> Proposal:
    confidences = tuple(
        confidence
        for confidence in (value.direction_confidence, value.material_type_confidence)
        if confidence is not None
    )
    return Proposal(
        direction_code=value.direction_code,
        material_type_code=value.material_type_code,
        access_code=None,
        lifecycle_code=None,
        rule_code=rule_code,
        confidence=min(confidences) if confidences else None,
        evidence=tuple(value.evidence),
    )


class CanonicalWeeklyProposalService:
    def __init__(
        self,
        store: WorkflowStore,
        configuration: WorkflowConfiguration,
        *,
        classifier_factory: Callable[[], object] = OpenAIContentClassifier,
    ) -> None:
        self._store = store
        self._configuration = configuration
        self._classifier_factory = classifier_factory

    def reconcile(self, registry1_path: Path, registry2_path: Path) -> ReconciliationReceipt:
        registry1 = read_registry1(registry1_path)
        registry2 = read_registry2_csv(registry2_path)
        context = self._store.load_reconciliation_context(self._configuration)
        if (
            context.taxonomy.version != self._configuration.taxonomy_version
            or not context.taxonomy.digest
        ):
            raise ValueError("TAXONOMY_CONTRACT_MISMATCH")
        items = self._build_items(context, registry1, registry2)
        observed_pages = collapse_observed_pages(context.observed_pages)
        observed_pages_hash = sha256_text(
            _canonical_json(
                [
                    {
                        "exact_url_hashes": page.exact_url_hashes,
                        "first_seen": page.first_seen.isoformat(),
                        "last_seen": page.last_seen.isoformat(),
                        "normalized_url": page.normalized_url,
                        "page_title": page.page_title,
                        "pageviews": page.pageviews,
                    }
                    for page in observed_pages
                ]
            )
        )
        run_key = sha256_text(
            _canonical_json(
                {
                    "code_revision": self._configuration.code_revision,
                    "model_routing_version": self._configuration.model_routing_version,
                    "observed_pages_hash": observed_pages_hash,
                    "predecessor_release_id": context.predecessor_release_id,
                    "predecessor_snapshot_digests": context.predecessor_snapshot_digests,
                    "predecessor_snapshot_ids": context.predecessor_snapshot_ids,
                    "prompt_version": self._configuration.prompt_version,
                    "registry1_hash": registry1.source_hash,
                    "registry2_hash": registry2.source_hash,
                    "taxonomy_digest": context.taxonomy.digest,
                    "taxonomy_version": context.taxonomy.version,
                }
            )
        )
        persisted = self._store.persist_reconciliation_run(
            PersistedReconciliationRun(
                run_id=0,
                run_key=run_key,
                observed_pages_hash=observed_pages_hash,
                status="reconciled",
                configuration=self._configuration,
                context=context,
                registry1=registry1,
                registry2=registry2,
                items=items,
            )
        )
        inputs = tuple(item.reconciliation_input for item in persisted.items)
        counts = _counts(inputs)
        return ReconciliationReceipt(
            run_id=int(persisted.run_id),
            run_key=persisted.run_key,
            registry1_hash=persisted.registry1.source_hash,
            registry2_hash=persisted.registry2.source_hash,
            source_count=persisted.registry1.source_row_count + persisted.registry2.source_row_count,
            catalog_gap_count=sum(
                1
                for item in persisted.items
                if item.reconciliation_input.registry1 is not None
                and item.reconciliation_input.registry1.source_name
                in {"canonical_catalog", "observed_page"}
            ),
            ready_count=counts["ready"],
            conflict_count=counts["conflict"],
            unresolved_count=counts["unresolved"],
            rejected_count=counts["rejected"],
            no_change_count=counts["no_change"],
        )

    def classify(self, run_id: int, *, execute_llm: bool) -> ClassificationReceipt:
        run = self._store.load_reconciliation_run(int(run_id))
        if run.configuration != self._configuration:
            raise ValueError("RUN_CONFIGURATION_MISMATCH")
        if run.status == "finalized":
            finalized = self._store.load_finalized_batch_for_run(run.run_id)
            if finalized is None:
                raise ValueError("FINALIZED_BATCH_MISSING")
            return self._classification_receipt(
                run,
                finalized,
                eligible_count=self._eligible_count(run.items),
            )
        new_registry1_keys = tuple(
            item.item_key
            for item in run.items
            if item.identity_status == "new"
            and item.reconciliation_input.registry1 is not None
            and item.reconciliation_input.registry1.source_name == "registry1"
        )
        created = self._store.resolve_or_create_registry1_entities(run.run_id, new_registry1_keys)
        if set(created) != set(new_registry1_keys):
            raise ValueError("REGISTRY_ENTITY_RESOLUTION_INCOMPLETE")

        classifier = None
        eligible_count = 0
        enriched_inputs: list[ReconciliationInput] = []
        for persisted_item in run.items:
            value = persisted_item.reconciliation_input
            if persisted_item.item_key in created:
                value = replace(value, content_entity_id=int(created[persisted_item.item_key]))
            preview = reconcile_entity(value)
            requested_fields = tuple(
                field_name
                for field_name, current in (
                    ("direction_code", preview.final_direction_code),
                    ("material_type_code", preview.final_material_type_code),
                )
                if current in (None, "undetermined")
            )
            eligible = (
                bool(requested_fields)
                and not value.identity_conflict
                and not value.rejection_code
                and (
                    (value.registry1 is not None and value.registry1.source_name in {"registry1", "canonical_catalog"})
                    or value.registry2 is not None
                )
            )
            if not eligible:
                enriched_inputs.append(value)
                continue
            eligible_count += 1
            if not execute_llm:
                enriched_inputs.append(value)
                continue
            deterministic = value.deterministic_proposal or Proposal(
                direction_code=preview.final_direction_code,
                material_type_code=preview.final_material_type_code,
                access_code=preview.final_access_code,
                lifecycle_code=preview.final_lifecycle_code,
                rule_code="canonical_reconciliation",
                confidence=1.0,
            )
            request = LlmRequest(
                title=preview.title,
                normalized_url=preview.url,
                normalized_path=normalize_url(preview.url).path,
                taxonomy_version=run.context.taxonomy.version,
                access_code=preview.final_access_code,
                material_type_hint=preview.final_material_type_code,
                deterministic_proposal=deterministic,
                deterministic_evidence=tuple(deterministic.evidence),
                direction_locked="direction_code" not in requested_fields,
                material_type_locked="material_type_code" not in requested_fields,
            )
            persisted_attempts = self._store.load_llm_attempts(
                run.run_id, persisted_item.item_key
            )
            primary = persisted_attempts.get("terra_primary")
            if primary is None:
                if classifier is None:
                    classifier = self._classifier_factory()
                primary = classifier.classify(request, LLM_PRIMARY_MODEL)
                self._store.append_llm_attempt(
                    run.run_id, persisted_item.item_key, "terra_primary", primary
                )
            elif (
                primary.model != LLM_PRIMARY_MODEL
                or primary.requested_fields != request.requested_fields
            ):
                raise ValueError("LLM_ATTEMPT_MISMATCH")
            verifier_attempt: LlmAttempt | None = None

            def verifier_factory() -> LlmAttempt:
                nonlocal classifier, verifier_attempt
                verifier_attempt = persisted_attempts.get("sol_verifier")
                if verifier_attempt is None:
                    if classifier is None:
                        classifier = self._classifier_factory()
                    verifier_attempt = classifier.classify(request, LLM_VERIFIER_MODEL)
                    self._store.append_llm_attempt(
                        run.run_id,
                        persisted_item.item_key,
                        "sol_verifier",
                        verifier_attempt,
                    )
                elif (
                    verifier_attempt.model != LLM_VERIFIER_MODEL
                    or verifier_attempt.requested_fields != request.requested_fields
                ):
                    raise ValueError("LLM_ATTEMPT_MISMATCH")
                return verifier_attempt

            routed = route_llm(deterministic, primary, verifier_factory)
            verifier_proposal = (
                _classification_proposal(verifier_attempt.classification, "llm_verifier")
                if verifier_attempt is not None and verifier_attempt.classification is not None
                else None
            )
            enriched_inputs.append(
                replace(
                    value,
                    llm_proposal=(
                        routed.proposal
                        or (
                            _classification_proposal(
                                primary.classification, "llm_primary"
                            )
                            if routed.conflict_code == "LLM_DISAGREEMENT"
                            and primary.classification is not None
                            else None
                        )
                    ),
                    verifier_proposal=verifier_proposal,
                )
            )

        batch = build_batch(
            enriched_inputs,
            run.context.taxonomy,
            run.configuration.prompt_version,
            source_snapshot_ids=run.context.predecessor_snapshot_ids,
            source_snapshot_digests=run.context.predecessor_snapshot_digests,
            model_routing_version=run.configuration.model_routing_version,
            mnn_by_entity=run.context.mnn_by_entity,
        )
        persisted_batch = self._store.finalize_reconciliation_run(run.run_id, batch)
        return self._classification_receipt(
            run, persisted_batch, eligible_count=eligible_count
        )

    @staticmethod
    def _classification_receipt(
        run: PersistedReconciliationRun,
        persisted_batch: PersistedApprovalBatch,
        *,
        eligible_count: int,
    ) -> ClassificationReceipt:
        counts = {
            state: 0
            for state in ("ready", "conflict", "unresolved", "rejected", "no_change")
        }
        for item in persisted_batch.batch.items:
            counts[item.readiness_state] += 1
        return ClassificationReceipt(
            run_id=run.run_id,
            batch_id=int(persisted_batch.database_batch_id),
            batch_key=persisted_batch.batch.batch_key,
            published_input_hash=persisted_batch.batch.published_input_hash,
            eligible_count=eligible_count,
            ready_count=counts["ready"],
            conflict_count=counts["conflict"],
            unresolved_count=counts["unresolved"],
            rejected_count=counts["rejected"],
            no_change_count=counts["no_change"],
        )

    @staticmethod
    def _eligible_count(items: Sequence[PersistedReconciliationItem]) -> int:
        total = 0
        for persisted_item in items:
            value = persisted_item.reconciliation_input
            preview = reconcile_entity(value)
            requested = (
                preview.final_direction_code in (None, "undetermined")
                or preview.final_material_type_code in (None, "undetermined")
            )
            if (
                requested
                and not value.identity_conflict
                and not value.rejection_code
                and (
                    (value.registry1 is not None and value.registry1.source_name in {"registry1", "canonical_catalog"})
                    or value.registry2 is not None
                )
            ):
                total += 1
        return total

    @staticmethod
    def _strong_identity(candidate: SourceCandidate) -> dict[str, frozenset[str]]:
        material_ids = frozenset(
            str(variant.material_id).strip().casefold()
            for variant in candidate.identity_variants
            if variant.material_id and str(variant.material_id).strip()
        )
        urls = frozenset(
            normalized
            for normalized in (
                normalize_url(variant.normalized_url).value
                for variant in candidate.identity_variants
                if variant.normalized_url
            )
            if normalized
        )
        return {"material_id": material_ids, "url": urls}

    @staticmethod
    def _strong_url_target_indexes(
        entities: Sequence[CanonicalClassification],
        aliases: Sequence[IdentityAlias],
    ) -> tuple[dict[str, frozenset[int]], dict[str, frozenset[int]]]:
        """Index exact reviewed URLs once for bounded observed-page lookups."""
        entity_ids = {entity.content_entity_id for entity in entities}
        all_targets: dict[str, set[int]] = {}
        usable_targets: dict[str, set[int]] = {}

        def add(targets: dict[str, set[int]], url: str, entity_id: int) -> None:
            normalized = normalize_url(url).value
            if normalized:
                targets.setdefault(sha256_text(normalized), set()).add(entity_id)

        for entity in entities:
            add(all_targets, entity.url, entity.content_entity_id)
            add(usable_targets, entity.url, entity.content_entity_id)
        for alias in aliases:
            if alias.strength != "strong" or alias.alias_kind not in {
                "canonical_url", "url"
            }:
                continue
            add(all_targets, alias.alias_value, alias.content_entity_id)
            if alias.content_entity_id in entity_ids:
                add(usable_targets, alias.alias_value, alias.content_entity_id)

        return (
            {
                url_hash: frozenset(targets)
                for url_hash, targets in all_targets.items()
            },
            {
                url_hash: frozenset(targets)
                for url_hash, targets in usable_targets.items()
            },
        )

    @staticmethod
    def _build_items(
        context: ReconciliationContext,
        registry1: SourceSnapshot,
        registry2: SourceSnapshot,
    ) -> tuple[PersistedReconciliationItem, ...]:
        resolver = IdentityResolver.prepare(context.entities, context.aliases)
        entity_by_id = {entity.content_entity_id: entity for entity in context.entities}
        entries: list[tuple[str, SourceCandidate, object]] = []
        for source_name, snapshot in (("registry1", registry1), ("registry2", registry2)):
            for candidate in snapshot.candidates:
                resolution = resolver.resolve(candidate)
                entries.append((source_name, candidate, resolution))

        parents = list(range(len(entries)))

        def find(index: int) -> int:
            while parents[index] != index:
                parents[index] = parents[parents[index]]
                index = parents[index]
            return index

        def union(left: int, right: int) -> None:
            left_root, right_root = find(left), find(right)
            if left_root != right_root:
                parents[right_root] = left_root

        owners: dict[str, int] = {}
        for index, (_source, candidate, resolution) in enumerate(entries):
            tokens = []
            if getattr(resolution, "status", None) == "matched":
                tokens.append(f"entity:{getattr(resolution, 'content_entity_id', None)}")
            strong = CanonicalWeeklyProposalService._strong_identity(candidate)
            tokens.extend(
                f"{kind}:{value}"
                for kind, values in strong.items()
                for value in values
            )
            for token in tokens:
                prior = owners.setdefault(token, index)
                union(index, prior)

        components: dict[int, list[tuple[str, SourceCandidate, object]]] = {}
        for index, entry in enumerate(entries):
            components.setdefault(find(index), []).append(entry)

        items: list[PersistedReconciliationItem] = []
        ordered_components = sorted(
            components.values(),
            key=lambda component: tuple(
                sorted(_source_candidate_key(source, candidate) for source, candidate, _ in component)
            ),
        )
        for component in ordered_components:
            resolutions = tuple(entry[2] for entry in component)
            targets = {
                resolution.content_entity_id
                for resolution in resolutions
                if resolution.status == "matched" and resolution.content_entity_id is not None
            }
            by_source: dict[str, list[SourceCandidate]] = {
                "registry1": [], "registry2": []
            }
            for source_name, candidate, _resolution in component:
                by_source[source_name].append(candidate)
            strong_by_source = {
                source_name: {
                    kind: frozenset().union(
                        *(CanonicalWeeklyProposalService._strong_identity(candidate)[kind]
                          for candidate in candidates)
                    )
                    for kind in ("material_id", "url")
                }
                for source_name, candidates in by_source.items()
            }
            cross_source_disagreement = any(
                strong_by_source["registry1"][kind]
                and strong_by_source["registry2"][kind]
                and strong_by_source["registry1"][kind]
                != strong_by_source["registry2"][kind]
                for kind in ("material_id", "url")
            )
            collision = (
                any(resolution.status == "collision" for resolution in resolutions)
                or len(targets) > 1
                or any(len(candidates) > 1 for candidates in by_source.values())
                or cross_source_disagreement
            )
            content_entity_id = next(iter(targets)) if len(targets) == 1 and not collision else None
            identity_status = "collision" if collision else ("matched" if content_entity_id else "new")
            registry1_candidate = (
                by_source["registry1"][0] if by_source["registry1"] else None
            )
            registry2_candidate = (
                by_source["registry2"][0] if by_source["registry2"] else None
            )
            registry1_identity_required = (
                identity_status == "new"
                and registry1_candidate is None
                and registry2_candidate is not None
            )
            if registry1_identity_required:
                identity_status = "rejected"
            component_keys = tuple(
                sorted(
                    _source_candidate_key(source, candidate)
                    for source, candidate, _resolution in component
                )
            )
            grouping_key = (
                f"entity:{content_entity_id}"
                if content_entity_id is not None
                else f"component:{sha256_text(_canonical_json(component_keys))}"
            )
            reconciliation_input = ReconciliationInput(
                content_entity_id=content_entity_id,
                active_canonical=entity_by_id.get(content_entity_id),
                registry1=registry1_candidate,
                registry2=registry2_candidate,
                identity_conflict=collision,
                rejection_code=(
                    ConflictCode.REGISTRY1_IDENTITY_REQUIRED.value
                    if registry1_identity_required
                    else None
                ),
            )
            reconciled = reconcile_entity(reconciliation_input)
            item_key = sha256_text(
                _canonical_json(
                    {
                        "grouping_key": grouping_key,
                        "identity_status": identity_status,
                        "input_hash": reconciled.input_hash,
                    }
                )
            )
            items.append(
                PersistedReconciliationItem(
                    grouping_key=grouping_key,
                    item_key=item_key,
                    input_hash=reconciled.input_hash,
                    identity_status=identity_status,
                    content_entity_id=content_entity_id,
                    reconciliation_input=reconciliation_input,
                )
            )
        represented_entity_ids = {
            item.content_entity_id
            for item in items
            if item.content_entity_id is not None
        }
        predecessor_entity_ids = set(
            context.predecessor_content_entity_ids
        )
        predecessor_catalog_by_id = {
            entity.content_entity_id: entity
            for entity in context.predecessor_catalog_entities
        }
        catalog_gaps = tuple(
            replace(
                entity,
                title=predecessor_catalog_by_id[entity.content_entity_id].title,
                url=predecessor_catalog_by_id[entity.content_entity_id].url,
            )
            for entity in sorted(
                context.entities, key=lambda value: value.content_entity_id
            )
            if entity.content_entity_id in predecessor_entity_ids
            and entity.content_entity_id in predecessor_catalog_by_id
            and entity.content_entity_id not in represented_entity_ids
            and entity.lifecycle_code != "archived"
            and (
                entity.direction_code in (None, "undetermined")
                or entity.material_type_code in (None, "undetermined")
            )
        )
        for entity, candidate in zip(
            catalog_gaps, read_canonical_catalog(catalog_gaps).candidates
        ):
            grouping_key = f"entity:{entity.content_entity_id}"
            reconciliation_input = ReconciliationInput(
                content_entity_id=entity.content_entity_id,
                active_canonical=entity,
                registry1=candidate,
            )
            reconciled = reconcile_entity(reconciliation_input)
            identity_status = "matched"
            items.append(
                PersistedReconciliationItem(
                    grouping_key=grouping_key,
                    item_key=sha256_text(_canonical_json({
                        "grouping_key": grouping_key,
                        "identity_status": identity_status,
                        "input_hash": reconciled.input_hash,
                    })),
                    input_hash=reconciled.input_hash,
                    identity_status=identity_status,
                    content_entity_id=entity.content_entity_id,
                    reconciliation_input=reconciliation_input,
                )
            )
        strong_url_targets, usable_strong_url_targets = (
            CanonicalWeeklyProposalService._strong_url_target_indexes(
                context.entities, context.aliases
            )
        )
        entities_by_id = {
            entity.content_entity_id: entity for entity in context.entities
        }
        for observed in collapse_observed_pages(context.observed_pages):
            candidate = MaterialCandidate(
                source_name="observed_page",
                source_row_id=f"observed:{observed.normalized_url}",
                title=observed.page_title,
                url=observed.normalized_url,
                material_id=None,
                direction_code=None,
                material_type_code=None,
                access_code=None,
                lifecycle_code="active",
                source_fingerprint=sha256_text(_canonical_json({
                    "url": observed.normalized_url, "title": observed.page_title,
                    "pageviews": observed.pageviews, "first_seen": observed.first_seen.isoformat(),
                    "last_seen": observed.last_seen.isoformat(),
                    "exact_url_hashes": observed.exact_url_hashes,
                })),
            )
            exact_target_sets = tuple(
                strong_url_targets.get(url_hash, frozenset())
                for url_hash in observed.exact_url_hashes
            )
            exact_targets = (
                set().union(*exact_target_sets) if exact_target_sets else set()
            )
            service_route = normalize_url(observed.normalized_url).path in {
                "/auth", "/registration.php", "/personal", "/rules", "/privacy", "/cookies", "/sitemap.php",
            } or normalize_url(observed.normalized_url).path.startswith("/personal/")
            deterministic = Proposal(
                direction_code="not_applicable",
                # The active reviewed taxonomy does not publish a service-page
                # material type.  Keep the route unresolved so local review can
                # explicitly reject it as non-content instead of persisting an
                # out-of-taxonomy classification.
                material_type_code=None,
                access_code="unspecified",
                lifecycle_code="active",
                rule_code="SERVICE_ROUTE",
                confidence=1.0,
                evidence=("reviewed service route",),
            ) if service_route else None
            if (
                exact_target_sets
                and all(len(targets) == 1 for targets in exact_target_sets)
                and len(exact_targets) == 1
            ):
                target_id = next(iter(exact_targets))
                canonical = entities_by_id.get(target_id)
                if canonical is None:
                    raise ValueError("STRONG_URL_TARGET_MISSING")
                if (
                    canonical.direction_code not in (None, "undetermined")
                    and canonical.material_type_code not in (None, "undetermined")
                ):
                    continue
                reconciliation_input = ReconciliationInput(
                    content_entity_id=target_id,
                    active_canonical=canonical,
                    registry1=candidate,
                    deterministic_proposal=(
                        deterministic
                        or Proposal(
                            direction_code=None,
                            material_type_code=None,
                            access_code="unspecified",
                            lifecycle_code="active",
                            rule_code="OBSERVED_METADATA_GAP",
                            confidence=1.0,
                            evidence=("reviewed URL owner lacks published metadata",),
                        )
                    ),
                )
                reconciled = reconcile_entity(reconciliation_input)
                grouping_key = f"observed:{observed.normalized_url}"
                items.append(PersistedReconciliationItem(
                    grouping_key=grouping_key,
                    item_key=sha256_text(_canonical_json({
                        "grouping_key": grouping_key,
                        "identity_status": "matched",
                        "input_hash": reconciled.input_hash,
                    })),
                    input_hash=reconciled.input_hash,
                    identity_status="matched",
                    content_entity_id=target_id,
                    reconciliation_input=reconciliation_input,
                ))
                continue
            usable_target_sets = tuple(
                usable_strong_url_targets.get(url_hash, frozenset())
                for url_hash in observed.exact_url_hashes
            )
            usable_targets = (
                set().union(*usable_target_sets) if usable_target_sets else set()
            )
            conflict = any(len(targets) > 1 for targets in usable_target_sets) or len(
                usable_targets
            ) > 1
            reconciliation_input = ReconciliationInput(
                registry1=candidate,
                identity_conflict=conflict,
                deterministic_proposal=deterministic,
            )
            reconciled = reconcile_entity(reconciliation_input)
            grouping_key = f"observed:{observed.normalized_url}"
            items.append(PersistedReconciliationItem(
                grouping_key=grouping_key,
                item_key=sha256_text(_canonical_json({"grouping_key": grouping_key, "identity_status": "collision" if conflict else "new", "input_hash": reconciled.input_hash})),
                input_hash=reconciled.input_hash,
                identity_status="collision" if conflict else "new",
                content_entity_id=None,
                reconciliation_input=reconciliation_input,
            ))
        for snapshot in (registry1, registry2):
            for rejected in snapshot.rejected_rows:
                reconciliation_input = ReconciliationInput(
                    content_available=False,
                    rejection_code=rejected.reason_code,
                    rejected_source_row=rejected,
                )
                reconciled = reconcile_entity(reconciliation_input)
                grouping_key = f"{snapshot.source_name}:{rejected.source_row_id}"
                items.append(
                    PersistedReconciliationItem(
                        grouping_key=grouping_key,
                        item_key=sha256_text(
                            _canonical_json(
                                {
                                    "grouping_key": grouping_key,
                                    "identity_status": "rejected",
                                    "input_hash": reconciled.input_hash,
                                }
                            )
                        ),
                        input_hash=reconciled.input_hash,
                        identity_status="rejected",
                        content_entity_id=None,
                        reconciliation_input=reconciliation_input,
                    )
                )
        if len({item.item_key for item in items}) != len(items) or len({item.input_hash for item in items}) != len(items):
            raise ValueError("RECONCILIATION_ITEM_DUPLICATE")
        return tuple(items)


__all__ = [
    "CanonicalWeeklyProposalService",
    "ClassificationReceipt",
    "PersistedReconciliationItem",
    "PersistedReconciliationRun",
    "PersistedSourceBinding",
    "ReconciliationContext",
    "ReconciliationReceipt",
    "WorkflowConfiguration",
    "ObservedPage",
]
