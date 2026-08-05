#!/usr/bin/env python3
"""Safe operator composition for the Abbott approval workflow.

This module owns command parsing and safety boundaries only.  Canonical writes,
LLM calls, Sheets operations, and candidate materialization remain behind the
Task 1--8 authorities and must be injected by the authorized operator.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import sys
from collections import Counter
from typing import Callable, Mapping, Protocol, Sequence

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from agents.abbott_page_classifier.sources import read_registry1, read_registry2_csv
from agents.abbott_page_classifier.reconcile import ReconciliationInput, reconcile_entity


COMMANDS = (
    "reconcile", "classify", "publish-projection", "pull-accepted",
    "ingest", "materialize", "validate", "status",
)
_BATCH_COMMANDS = frozenset(COMMANDS) - {"status"}
_SAFE_OUTPUT_KEYS = frozenset(
    {
        "status", "source_count", "ready_count", "conflict_count", "unresolved_count",
        "rejected_count", "no_change_count", "accepted_count", "skipped_count",
        "eligible_count", "candidate_release_id", "registry1_hash", "registry2_hash",
        "published_input_hash", "accepted_decision_hash", "batch_hash",
    }
)


class WorkflowGateway(Protocol):
    def reconcile(self, registry1: Path, registry2: Path, *, batch_id: str | None, dry_run: bool) -> Mapping[str, object]: ...
    def eligible_classification_count(self, batch_id: str) -> int: ...
    def classify(self, batch_id: str, *, execute_llm: bool, dry_run: bool) -> Mapping[str, object]: ...
    def publish_projection(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]: ...
    def pull_accepted(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]: ...
    def ingest(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]: ...
    def materialize(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]: ...
    def validate(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]: ...
    def status(self, batch_id: str | None) -> Mapping[str, object]: ...


@dataclass(frozen=True)
class WorkflowDependencies:
    gateway: WorkflowGateway


class WorkflowConfigurationError(RuntimeError):
    """Sanitized error for a missing separately-authorized operator authority."""


class _SanitizedArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise WorkflowConfigurationError("ARGUMENTS_INVALID")


class ProductionWorkflowGateway:
    """Lazy adapter that composes Tasks 1--8 without owning their semantics.

    Callers provide loaders for the approved batch and accepted snapshot because
    Tasks 1--8 deliberately do not expose a broad "load mutable batch" API.
    The concrete calls below are the existing canonical authorities, not a
    parallel persistence or release path.  Nothing is constructed until a
    command reaches the corresponding stage.
    """

    def __init__(
        self,
        *,
        repository_factory: Callable[[], object],
        persisted_batch_loader: Callable[[str], object],
        accepted_snapshot_loader: Callable[[str], object],
        sheets_gateway_factory: Callable[[], object],
        classification_runner: Callable[[str, bool, bool], Mapping[str, object]],
        reconcile_persist: Callable[[Path, Path, str], Mapping[str, object]],
        predecessor_release_id: Callable[[str], int],
        code_revision: Callable[[], str],
    ) -> None:
        self._repository_factory = repository_factory
        self._persisted_batch_loader = persisted_batch_loader
        self._accepted_snapshot_loader = accepted_snapshot_loader
        self._sheets_gateway_factory = sheets_gateway_factory
        self._classification_runner = classification_runner
        self._reconcile_persist = reconcile_persist
        self._predecessor_release_id = predecessor_release_id
        self._code_revision = code_revision

    def reconcile(self, registry1: Path, registry2: Path, *, batch_id: str | None, dry_run: bool) -> Mapping[str, object]:
        if dry_run:
            return _reconcile_captured_snapshots(registry1, registry2, dry_run=True)
        if not batch_id:
            raise WorkflowConfigurationError("BATCH_ID_REQUIRED")
        return self._reconcile_persist(registry1, registry2, batch_id)

    def eligible_classification_count(self, batch_id: str) -> int:
        # The injected Task 5 runner owns eligibility from immutable batch rows.
        result = self._classification_runner(batch_id, False, True)
        return int(result.get("eligible_count", 0))

    def classify(self, batch_id: str, *, execute_llm: bool, dry_run: bool) -> Mapping[str, object]:
        return self._classification_runner(batch_id, execute_llm, dry_run)

    def publish_projection(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]:
        batch = self._persisted_batch_loader(batch_id)
        if dry_run:
            return _batch_counts(batch, "dry_run")
        from agents.abbott_page_classifier.sheets_sync import publish_batch_projection

        projection = publish_batch_projection(
            batch, self._sheets_gateway_factory(), self._repository_factory()
        )
        return {
            "status": "published", "ready_count": projection.ready_count,
            "conflict_count": projection.conflict_count,
            "unresolved_count": projection.unresolved_count,
            "rejected_count": projection.rejected_count,
            "published_input_hash": projection.published_input_hash,
        }

    def pull_accepted(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]:
        batch = self._persisted_batch_loader(batch_id)
        from agents.abbott_page_classifier.sheets_sync import read_accepted_projection

        # Pull is read-only.  Ingestion, not pull, persists the immutable hash.
        snapshot = read_accepted_projection(batch, self._sheets_gateway_factory())
        return {
            "status": "dry_run" if dry_run else "accepted_snapshot_ready",
            "accepted_count": snapshot.accepted_count or 0,
            "skipped_count": snapshot.skipped_count or 0,
            "accepted_decision_hash": snapshot.accepted_decision_hash,
        }

    def ingest(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]:
        snapshot = self._accepted_snapshot_loader(batch_id)
        if dry_run:
            return {"status": "dry_run", "accepted_count": snapshot.accepted_count or 0,
                    "accepted_decision_hash": snapshot.accepted_decision_hash}
        from agents.abbott_page_classifier.batch_service import ingest_accepted_batch

        result = ingest_accepted_batch(snapshot, self._repository_factory())
        return {"status": result.status, "accepted_count": result.accepted_count,
                "conflict_count": result.conflict_count, "unresolved_count": result.unresolved_count,
                "rejected_count": result.rejected_count,
                "accepted_decision_hash": snapshot.accepted_decision_hash}

    def materialize(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]:
        if dry_run:
            return {"status": "dry_run"}
        from agents.abbott_page_classifier.candidate_release import materialize_content_candidate

        candidate = materialize_content_candidate(
            int(batch_id), self._predecessor_release_id(batch_id), self._code_revision()
        )
        return {"status": candidate.status, "candidate_release_id": candidate.candidate_release_id}

    def validate(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]:
        if dry_run:
            return {"status": "dry_run"}
        history = self._repository_factory().load_batch_history(int(batch_id))
        if not history.candidate_release_id or not history.accepted_decision_hash:
            raise WorkflowConfigurationError("CANDIDATE_GATE_EVIDENCE_MISSING")
        from agents.abbott_page_classifier.candidate_release import validate_content_candidate

        report = validate_content_candidate(
            history.candidate_release_id,
            {"source": history.ready_count + history.conflict_count + history.unresolved_count + history.rejected_count + history.no_change_count,
             "ready": history.ready_count, "conflict": history.conflict_count,
             "unresolved": history.unresolved_count, "rejected": history.rejected_count,
             "accepted": history.accepted_count, "no_change": history.no_change_count},
            history.accepted_decision_hash,
        )
        return {"status": "validated" if report.passed else "validation_failed",
                "candidate_release_id": report.candidate_release_id}

    def status(self, batch_id: str | None) -> Mapping[str, object]:
        if not batch_id:
            raise WorkflowConfigurationError("BATCH_ID_REQUIRED")
        history = self._repository_factory().load_batch_history(int(batch_id))
        return {"status": history.batch_status, "candidate_release_id": history.candidate_release_id or 0,
                "ready_count": history.ready_count, "conflict_count": history.conflict_count,
                "unresolved_count": history.unresolved_count, "rejected_count": history.rejected_count,
                "accepted_count": history.accepted_count, "published_input_hash": history.published_input_hash,
                "accepted_decision_hash": history.accepted_decision_hash or ""}


def _missing_authority(*_args: object, **_kwargs: object):
    raise WorkflowConfigurationError("OPERATOR_ADAPTER_REQUIRED")


def build_production_dependencies(
    *,
    repository_factory: Callable[[], object] | None = None,
    persisted_batch_loader: Callable[[str], object] | None = None,
    accepted_snapshot_loader: Callable[[str], object] | None = None,
    sheets_gateway_factory: Callable[[], object] | None = None,
    classification_runner: Callable[[str, bool, bool], Mapping[str, object]] | None = None,
    reconcile_persist: Callable[[Path, Path, str], Mapping[str, object]] | None = None,
    predecessor_release_id: Callable[[str], int] | None = None,
    code_revision: Callable[[], str] | None = None,
) -> WorkflowDependencies:
    """Build the production composition lazily; safe fakes may replace each edge."""

    if repository_factory is None:
        def repository_factory() -> object:
            from canonical_writer import get_db_connection
            from agents.abbott_page_classifier.repository import ContentRegistryRepository
            return ContentRegistryRepository(get_db_connection)
    return WorkflowDependencies(ProductionWorkflowGateway(
        repository_factory=repository_factory,
        persisted_batch_loader=persisted_batch_loader or _missing_authority,
        accepted_snapshot_loader=accepted_snapshot_loader or _missing_authority,
        sheets_gateway_factory=sheets_gateway_factory or _missing_authority,
        classification_runner=classification_runner or _missing_authority,
        reconcile_persist=reconcile_persist or _missing_authority,
        predecessor_release_id=predecessor_release_id or _missing_authority,
        code_revision=code_revision or _missing_authority,
    ))


def _batch_counts(batch: object, status: str) -> Mapping[str, object]:
    items = getattr(getattr(batch, "batch", batch), "items", ())
    counts = Counter(getattr(item, "readiness_state", "") for item in items)
    return {"status": status, "ready_count": counts["ready"], "conflict_count": counts["conflict"],
            "unresolved_count": counts["unresolved"], "rejected_count": counts["rejected"],
            "no_change_count": counts["no_change"]}


def _reconcile_captured_snapshots(registry1: Path, registry2: Path, *, dry_run: bool) -> Mapping[str, object]:
    """Apply the canonical Task 3 state machine to immutable captured sources."""

    first, second = read_registry1(registry1), read_registry2_csv(registry2)
    first_by_key = first.candidates_by_key
    second_by_key = second.candidates_by_key
    states = Counter(
        reconcile_entity(ReconciliationInput(registry1=first_by_key.get(key), registry2=second_by_key.get(key))).readiness_state
        for key in sorted(set(first_by_key) | set(second_by_key))
    )
    return {"status": "dry_run" if dry_run else "reconciled", "source_count": first.source_row_count + second.source_row_count,
            "ready_count": states["ready"], "conflict_count": states["conflict"],
            "unresolved_count": states["unresolved"],
            "rejected_count": len(first.rejected_rows) + len(second.rejected_rows),
            "registry1_hash": first.source_hash, "registry2_hash": second.source_hash}


class OfflineWorkflowGateway:
    """Read-only default adapter.  It intentionally cannot reach MySQL or Sheets."""

    def reconcile(self, registry1: Path, registry2: Path, *, batch_id: str | None, dry_run: bool) -> Mapping[str, object]:
        return _reconcile_captured_snapshots(registry1, registry2, dry_run=dry_run)

    def eligible_classification_count(self, batch_id: str) -> int:
        return 0

    def _unavailable(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]:
        return {"status": "dry_run" if dry_run else "OPERATOR_ADAPTER_REQUIRED"}

    def classify(self, batch_id: str, *, execute_llm: bool, dry_run: bool) -> Mapping[str, object]:
        return self._unavailable(batch_id, dry_run=dry_run)

    def publish_projection(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]:
        return self._unavailable(batch_id, dry_run=dry_run)

    def pull_accepted(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]:
        return self._unavailable(batch_id, dry_run=dry_run)

    def ingest(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]:
        return self._unavailable(batch_id, dry_run=dry_run)

    def materialize(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]:
        return self._unavailable(batch_id, dry_run=dry_run)

    def validate(self, batch_id: str, *, dry_run: bool) -> Mapping[str, object]:
        return self._unavailable(batch_id, dry_run=dry_run)

    def status(self, batch_id: str | None) -> Mapping[str, object]:
        return {"status": "OFFLINE_ADAPTER_REQUIRED"}


def _parser() -> argparse.ArgumentParser:
    parser = _SanitizedArgumentParser(add_help=False)
    parser.add_argument("command", choices=COMMANDS)
    parser.add_argument("--batch-id")
    parser.add_argument("--registry1")
    parser.add_argument("--registry2")
    execution = parser.add_mutually_exclusive_group()
    execution.add_argument("--dry-run", action="store_true")
    execution.add_argument("--execute", action="store_true")
    parser.add_argument("--execute-llm", action="store_true")
    return parser


def _emit(value: Mapping[str, object]) -> None:
    print(json.dumps({key: value[key] for key in sorted(value) if key in _SAFE_OUTPUT_KEYS}, sort_keys=True))


def _error(code: str) -> int:
    _emit({"status": code})
    return 2


def main(argv: Sequence[str] | None = None, *, dependencies: WorkflowDependencies | None = None) -> int:
    """Compose operator-only stages; default every write-capable stage to --dry-run."""

    try:
        args = _parser().parse_args(argv)
    except (SystemExit, WorkflowConfigurationError):
        return _error("ARGUMENTS_INVALID")
    dry_run = not bool(args.execute)
    if not dry_run and args.command in _BATCH_COMMANDS and not args.batch_id:
        return _error("BATCH_ID_REQUIRED")
    if args.command == "reconcile" and (not args.registry1 or not args.registry2):
        return _error("REGISTRY_SNAPSHOTS_REQUIRED")
    gateway = (dependencies or build_production_dependencies()).gateway
    try:
        if args.command == "reconcile":
            result = gateway.reconcile(Path(args.registry1), Path(args.registry2), batch_id=args.batch_id, dry_run=dry_run)
        elif args.command == "classify":
            eligible = gateway.eligible_classification_count(args.batch_id)
            if args.execute_llm and eligible > 0 and not os.environ.get("OPENAI_API_KEY"):
                return _error("OPENAI_API_KEY_REQUIRED")
            result = gateway.classify(args.batch_id, execute_llm=args.execute_llm and eligible > 0, dry_run=dry_run)
        elif args.command == "publish-projection":
            result = gateway.publish_projection(args.batch_id, dry_run=dry_run)
        elif args.command == "pull-accepted":
            result = gateway.pull_accepted(args.batch_id, dry_run=dry_run)
        elif args.command == "ingest":
            result = gateway.ingest(args.batch_id, dry_run=dry_run)
        elif args.command == "materialize":
            # Intentionally no Sheets or activation dependency is reachable here.
            result = gateway.materialize(args.batch_id, dry_run=dry_run)
        elif args.command == "validate":
            result = gateway.validate(args.batch_id, dry_run=dry_run)
        else:
            result = gateway.status(args.batch_id)
    except Exception as error:
        # Stages are deliberately fail-closed and never expose database, Sheets,
        # provider, path, or content details through this operator boundary.
        if isinstance(error, WorkflowConfigurationError):
            return _error("OPERATOR_CONFIGURATION_INVALID")
        return _error("WORKFLOW_STAGE_FAILED")
    _emit(result)
    return 0 if result.get("status") not in {"OPERATOR_ADAPTER_REQUIRED"} else 2


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    raise SystemExit(main())
