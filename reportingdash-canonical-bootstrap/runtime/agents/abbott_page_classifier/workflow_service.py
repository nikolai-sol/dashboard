"""Canonical weekly Abbott reconciliation and proposal-batch service.

The service is intentionally independent of command parsing and Google APIs.
It composes immutable captured sources with a canonical store, and stops after
one persisted proposal batch.  Human acceptance and release materialization are
separate stages.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
import json
from pathlib import Path
from typing import Callable, Mapping, Protocol, Sequence

from .batch_service import PersistedApprovalBatch, build_batch
from .domain import CanonicalClassification, Proposal, TaxonomyVersion
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
from .sources import SourceCandidate, SourceSnapshot, read_registry1, read_registry2_csv


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

    def __post_init__(self) -> None:
        object.__setattr__(self, "predecessor_snapshot_ids", tuple(self.predecessor_snapshot_ids))
        object.__setattr__(self, "predecessor_snapshot_digests", tuple(self.predecessor_snapshot_digests))
        object.__setattr__(self, "entities", tuple(self.entities))
        object.__setattr__(self, "aliases", tuple(self.aliases))
        if (
            self.predecessor_release_id <= 0
            or not self.predecessor_snapshot_ids
            or len(self.predecessor_snapshot_ids) != len(self.predecessor_snapshot_digests)
            or len(set(self.predecessor_snapshot_ids)) != len(self.predecessor_snapshot_ids)
            or any(snapshot_id <= 0 for snapshot_id in self.predecessor_snapshot_ids)
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
        run_key = sha256_text(
            _canonical_json(
                {
                    "code_revision": self._configuration.code_revision,
                    "model_routing_version": self._configuration.model_routing_version,
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
        new_registry1_keys = tuple(
            item.item_key
            for item in run.items
            if item.identity_status == "new" and item.reconciliation_input.registry1 is not None
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
                and (value.registry1 is not None or value.registry2 is not None)
            )
            if not eligible:
                enriched_inputs.append(value)
                continue
            eligible_count += 1
            if not execute_llm:
                enriched_inputs.append(value)
                continue
            if classifier is None:
                classifier = self._classifier_factory()
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
            primary = classifier.classify(request, LLM_PRIMARY_MODEL)
            self._store.append_llm_attempt(
                run.run_id, persisted_item.item_key, "terra_primary", primary
            )
            verifier_attempt: LlmAttempt | None = None

            def verifier_factory() -> LlmAttempt:
                nonlocal verifier_attempt
                verifier_attempt = classifier.classify(request, LLM_VERIFIER_MODEL)
                self._store.append_llm_attempt(
                    run.run_id, persisted_item.item_key, "sol_verifier", verifier_attempt
                )
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
                    llm_proposal=routed.proposal,
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
        )
        persisted_batch = self._store.finalize_reconciliation_run(run.run_id, batch)
        counts = {state: 0 for state in ("ready", "conflict", "unresolved", "rejected", "no_change")}
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
    def _build_items(
        context: ReconciliationContext,
        registry1: SourceSnapshot,
        registry2: SourceSnapshot,
    ) -> tuple[PersistedReconciliationItem, ...]:
        resolver = IdentityResolver()
        entity_by_id = {entity.content_entity_id: entity for entity in context.entities}
        grouped: dict[str, dict[str, object]] = {}
        for source_name, snapshot in (("registry1", registry1), ("registry2", registry2)):
            for candidate in snapshot.candidates:
                resolution = resolver.resolve(candidate, context.entities, context.aliases)
                grouping_key = (
                    f"entity:{resolution.content_entity_id}"
                    if resolution.status == "matched"
                    else _source_candidate_key(source_name, candidate)
                )
                group = grouped.setdefault(
                    grouping_key,
                    {"registry1": None, "registry2": None, "resolutions": []},
                )
                if group[source_name] is not None:
                    grouping_key = _source_candidate_key(source_name, candidate)
                    group = grouped.setdefault(
                        grouping_key,
                        {"registry1": None, "registry2": None, "resolutions": []},
                    )
                group[source_name] = candidate
                group["resolutions"].append(resolution)

        items: list[PersistedReconciliationItem] = []
        for grouping_key, group in sorted(grouped.items()):
            resolutions = tuple(group["resolutions"])
            targets = {
                resolution.content_entity_id
                for resolution in resolutions
                if resolution.status == "matched" and resolution.content_entity_id is not None
            }
            collision = any(resolution.status == "collision" for resolution in resolutions) or len(targets) > 1
            content_entity_id = next(iter(targets)) if len(targets) == 1 and not collision else None
            identity_status = "collision" if collision else ("matched" if content_entity_id else "new")
            reconciliation_input = ReconciliationInput(
                content_entity_id=content_entity_id,
                active_canonical=entity_by_id.get(content_entity_id),
                registry1=group["registry1"],
                registry2=group["registry2"],
                identity_conflict=collision,
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
        for snapshot in (registry1, registry2):
            for rejected in snapshot.rejected_rows:
                reconciliation_input = ReconciliationInput(
                    content_available=False,
                    rejection_code=rejected.reason_code,
                )
                reconciled = reconcile_entity(reconciliation_input)
                items.append(
                    PersistedReconciliationItem(
                        grouping_key=f"{snapshot.source_name}:{rejected.source_row_id}",
                        item_key=sha256_text(f"{snapshot.source_name}:{rejected.source_row_id}:{rejected.source_fingerprint}"),
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
]
