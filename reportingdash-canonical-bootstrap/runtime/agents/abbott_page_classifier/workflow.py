#!/usr/bin/env python3
"""Sanitized operator CLI for the canonical Abbott proposal workflow."""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
import json
import os
from pathlib import Path
import sys
from typing import Callable, Mapping, Protocol, Sequence


_PYTHON311_RUNTIME = sys.version_info[:2] == (3, 11)
_PYTHON311_FAILURE = {"status": "ABBOTT_CONTENT_PYTHON311_VERSION_REQUIRED"}
if __name__ == "__main__" and not _PYTHON311_RUNTIME:
    print(json.dumps(_PYTHON311_FAILURE, sort_keys=True))
    raise SystemExit(78)

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from agents.abbott_page_classifier.reconcile import ReconciliationInput, reconcile_entity
from agents.abbott_page_classifier.sources import read_registry1, read_registry2_csv


COMMANDS = (
    "reconcile", "classify", "publish-projection", "publish-local", "accept-local", "pull-accepted",
    "ingest", "materialize", "validate", "status",
)
_BATCH_COMMANDS = frozenset(COMMANDS) - {"reconcile", "classify"}
_WRITE_COMMANDS = frozenset(
    {"reconcile", "classify", "publish-projection", "publish-local", "accept-local", "ingest", "materialize", "validate"}
)
_SAFE_OUTPUT_KEYS = frozenset(
    {
        "status", "run_id", "run_key", "batch_id", "batch_key",
        "source_count", "catalog_gap_count", "ready_count", "conflict_count", "unresolved_count",
        "rejected_count", "no_change_count", "accepted_count", "skipped_count",
        "eligible_count", "candidate_release_id", "registry1_hash", "registry2_hash",
        "published_input_hash", "accepted_decision_hash", "batch_hash",
    }
)


class WorkflowGateway(Protocol):
    def reconcile(self, registry1: Path, registry2: Path, *, dry_run: bool) -> Mapping[str, object]: ...
    def classify(self, run_id: int, *, execute_llm: bool, dry_run: bool) -> Mapping[str, object]: ...
    def publish_projection(self, batch_id: int, *, dry_run: bool) -> Mapping[str, object]: ...
    def publish_local(self, batch_id: int, decision_file: Path, *, dry_run: bool) -> Mapping[str, object]: ...
    def accept_local(self, batch_id: int, decision_file: Path, *, dry_run: bool) -> Mapping[str, object]: ...
    def pull_accepted(self, batch_id: int, *, dry_run: bool) -> Mapping[str, object]: ...
    def ingest(self, batch_id: int, *, dry_run: bool) -> Mapping[str, object]: ...
    def materialize(self, batch_id: int, *, dry_run: bool) -> Mapping[str, object]: ...
    def validate(self, batch_id: int, *, dry_run: bool) -> Mapping[str, object]: ...
    def status(self, batch_id: int, *, dry_run: bool) -> Mapping[str, object]: ...


@dataclass(frozen=True)
class WorkflowDependencies:
    gateway: WorkflowGateway


class WorkflowConfigurationError(RuntimeError):
    """Stable configuration failure without sensitive detail."""


class _SanitizedArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise WorkflowConfigurationError("ARGUMENTS_INVALID")


def _configuration_from_environment():
    from agents.abbott_page_classifier.workflow_service import WorkflowConfiguration

    revision = os.environ.get("CODE_REVISION", "")
    prompt = os.environ.get("ABBOTT_CONTENT_PROMPT_VERSION", "")
    routing = os.environ.get("ABBOTT_CONTENT_MODEL_ROUTING_VERSION", "")
    taxonomy = os.environ.get("ABBOTT_CONTENT_TAXONOMY_VERSION", "abbott.v1")
    try:
        return WorkflowConfiguration(taxonomy, prompt, routing, revision)
    except ValueError:
        raise WorkflowConfigurationError("WORKFLOW_CONFIGURATION_INVALID") from None


def _workflow_db_connection():
    required = {
        "host": os.environ.get("ABBOTT_CONTENT_WORKFLOW_DB_HOST", "").strip(),
        "database": os.environ.get("ABBOTT_CONTENT_WORKFLOW_DB_NAME", "").strip(),
        "user": os.environ.get("ABBOTT_CONTENT_WORKFLOW_DB_USER", "").strip(),
        "password": os.environ.get("ABBOTT_CONTENT_WORKFLOW_DB_PASSWORD", ""),
    }
    raw_port = os.environ.get("ABBOTT_CONTENT_WORKFLOW_DB_PORT", "3306").strip()
    try:
        port = int(raw_port)
    except ValueError:
        port = 0
    if (
        any(not value for value in required.values())
        or required["database"] != "report_bd"
        or not 1 <= port <= 65535
    ):
        raise WorkflowConfigurationError("WORKFLOW_DB_CONFIGURATION_INVALID")
    import mysql.connector

    return mysql.connector.connect(
        host=required["host"],
        port=port,
        database=required["database"],
        user=required["user"],
        password=required["password"],
        charset="utf8mb4",
        collation="utf8mb4_unicode_ci",
    )


def _materializer_db_connection():
    required = {
        "host": os.environ.get("ABBOTT_CONTENT_MATERIALIZER_DB_HOST", "").strip(),
        "database": os.environ.get("ABBOTT_CONTENT_MATERIALIZER_DB_NAME", "").strip(),
        "user": os.environ.get("ABBOTT_CONTENT_MATERIALIZER_DB_USER", "").strip(),
        "password": os.environ.get("ABBOTT_CONTENT_MATERIALIZER_DB_PASSWORD", ""),
    }
    raw_port = os.environ.get(
        "ABBOTT_CONTENT_MATERIALIZER_DB_PORT", "3306"
    ).strip()
    try:
        port = int(raw_port)
    except ValueError:
        port = 0
    if (
        any(not value for value in required.values())
        or required["database"] != "report_bd"
        or not 1 <= port <= 65535
    ):
        raise WorkflowConfigurationError("MATERIALIZER_DB_CONFIGURATION_INVALID")
    import mysql.connector

    return mysql.connector.connect(
        host=required["host"],
        port=port,
        database=required["database"],
        user=required["user"],
        password=required["password"],
        charset="utf8mb4",
        collation="utf8mb4_unicode_ci",
    )


def _release_operator_db_connection():
    from abbott_release_operator import (
        OperatorConfigurationError,
        get_operator_db_connection,
    )

    try:
        return get_operator_db_connection()
    except OperatorConfigurationError:
        raise WorkflowConfigurationError(
            "RELEASE_OPERATOR_DB_CONFIGURATION_INVALID"
        ) from None


def _default_store_factory():
    from agents.abbott_page_classifier.workflow_repository import MySqlWorkflowStore

    return MySqlWorkflowStore(_workflow_db_connection)


def _local_decision_root() -> Path:
    root = os.environ.get("ABBOTT_CONTENT_LOCAL_DECISION_ROOT", "").strip()
    if not root:
        raise WorkflowConfigurationError("LOCAL_DECISION_ROOT_REQUIRED")
    path = Path(root)
    if not path.is_absolute():
        raise WorkflowConfigurationError("LOCAL_DECISION_ROOT_INVALID")
    return path


def _default_service_factory(store):
    from agents.abbott_page_classifier.llm_classifier import OpenAIContentClassifier
    from agents.abbott_page_classifier.workflow_service import CanonicalWeeklyProposalService

    def classifier_factory():
        if not os.environ.get("OPENAI_API_KEY"):
            raise WorkflowConfigurationError("OPENAI_API_KEY_REQUIRED")
        return OpenAIContentClassifier()

    return CanonicalWeeklyProposalService(
        store,
        _configuration_from_environment(),
        classifier_factory=classifier_factory,
    )


def _default_sheets_gateway_factory(spreadsheet_id: str):
    from agents.abbott_page_classifier.sheets_sync import GoogleApiSheetsGateway, services

    sheets_service, _drive_service = services()
    return GoogleApiSheetsGateway(sheets_service, spreadsheet_id)


class ProductionWorkflowGateway:
    """Lazy concrete composition of the Tasks 1--8 canonical authorities."""

    def __init__(
        self,
        *,
        store_factory: Callable[[], object] = _default_store_factory,
        service_factory: Callable[[object], object] = _default_service_factory,
        sheets_gateway_factory: Callable[[str], object] = _default_sheets_gateway_factory,
        materializer: Callable[[int, int, str], object] | None = None,
        validator: Callable[[int, Mapping[str, int], str], object] | None = None,
        materializer_connection_factory: Callable[[], object] = _materializer_db_connection,
        operator_connection_factory: Callable[[], object] = _release_operator_db_connection,
    ) -> None:
        self._store_factory = store_factory
        self._service_factory = service_factory
        self._sheets_gateway_factory = sheets_gateway_factory
        self._materializer = materializer
        self._validator = validator
        self._materializer_connection_factory = materializer_connection_factory
        self._operator_connection_factory = operator_connection_factory

    @staticmethod
    def _offline_reconcile(registry1: Path, registry2: Path) -> Mapping[str, object]:
        first, second = read_registry1(registry1), read_registry2_csv(registry2)
        first_by_key, second_by_key = first.candidates_by_key, second.candidates_by_key
        states = Counter(
            reconcile_entity(
                ReconciliationInput(
                    registry1=first_by_key.get(key), registry2=second_by_key.get(key)
                )
            ).readiness_state
            for key in sorted(set(first_by_key) | set(second_by_key))
        )
        return {
            "status": "dry_run",
            "source_count": first.source_row_count + second.source_row_count,
            "ready_count": states["ready"],
            "conflict_count": states["conflict"],
            "unresolved_count": states["unresolved"],
            "rejected_count": len(first.rejected_rows) + len(second.rejected_rows),
            "no_change_count": states["no_change"],
            "registry1_hash": first.source_hash,
            "registry2_hash": second.source_hash,
        }

    def reconcile(self, registry1: Path, registry2: Path, *, dry_run: bool) -> Mapping[str, object]:
        if dry_run:
            return self._offline_reconcile(registry1, registry2)
        receipt = self._service_factory(self._store_factory()).reconcile(registry1, registry2)
        return {"status": "reconciled", **receipt.__dict__}

    def classify(self, run_id: int, *, execute_llm: bool, dry_run: bool) -> Mapping[str, object]:
        if dry_run:
            return {"status": "dry_run"}
        receipt = self._service_factory(self._store_factory()).classify(
            int(run_id), execute_llm=execute_llm
        )
        return {"status": "finalized", **receipt.__dict__}

    def _spreadsheet_id(self, store, batch_id: int, *, publication: bool) -> str:
        configured = os.environ.get("ABBOTT_CONTENT_APPROVAL_SPREADSHEET_ID", "").strip()
        if configured:
            return configured
        history = store.load_batch_history(int(batch_id))
        if history.spreadsheet_file_id:
            return history.spreadsheet_file_id
        raise WorkflowConfigurationError(
            "SPREADSHEET_ID_REQUIRED" if publication else "BATCH_NOT_PUBLISHED"
        )

    def publish_projection(self, batch_id: int, *, dry_run: bool) -> Mapping[str, object]:
        if dry_run:
            return {"status": "dry_run"}
        from agents.abbott_page_classifier.sheets_sync import publish_batch_projection

        store = self._store_factory()
        history = store.load_batch_history(int(batch_id))
        if history.batch_status in (
            "published", "accepted", "ingested", "candidate_materialized"
        ):
            if (
                not history.spreadsheet_file_id
                or not history.spreadsheet_projection_hash
                or not history.published_input_hash
            ):
                raise WorkflowConfigurationError("PROJECTION_RECEIPT_INCONSISTENT")
            return {
                "status": "noop", "batch_id": int(batch_id),
                "batch_key": history.batch_key,
                "ready_count": history.ready_count,
                "conflict_count": history.conflict_count,
                "unresolved_count": history.unresolved_count,
                "rejected_count": history.rejected_count,
                "no_change_count": history.no_change_count,
                "published_input_hash": history.published_input_hash,
            }
        batch = store.load_persisted_batch(int(batch_id))
        spreadsheet_id = self._spreadsheet_id(store, int(batch_id), publication=True)
        projection = publish_batch_projection(
            batch, self._sheets_gateway_factory(spreadsheet_id), store
        )
        return {
            "status": "published", "batch_id": int(batch_id),
            "batch_key": projection.batch_key,
            "ready_count": projection.ready_count,
            "conflict_count": projection.conflict_count,
            "unresolved_count": projection.unresolved_count,
            "rejected_count": projection.rejected_count,
            "no_change_count": projection.no_change_count,
            "published_input_hash": projection.published_input_hash,
        }

    def publish_local(self, batch_id: int, decision_file: Path, *, dry_run: bool) -> Mapping[str, object]:
        if dry_run:
            return {"status": "dry_run"}
        from agents.abbott_page_classifier.local_acceptance import read_local_acceptance_artifact

        store = self._store_factory()
        history = store.load_batch_history(int(batch_id))
        if history.batch_status != "draft":
            raise WorkflowConfigurationError("BATCH_NOT_DRAFT")
        batch = store.load_persisted_batch(int(batch_id))
        store.attest_batch_for_publication(int(batch_id), batch.batch)
        artifact = read_local_acceptance_artifact(
            Path(decision_file), batch, _local_decision_root()
        )
        store.mark_local_batch_published(
            int(batch_id), artifact.locator, artifact.content_hash
        )
        return {
            "status": "published", "batch_id": int(batch_id),
            "batch_key": batch.batch.batch_key,
            "ready_count": history.ready_count, "conflict_count": history.conflict_count,
            "unresolved_count": history.unresolved_count,
            "rejected_count": history.rejected_count,
            "no_change_count": history.no_change_count,
            "published_input_hash": batch.batch.published_input_hash,
        }

    def accept_local(self, batch_id: int, decision_file: Path, *, dry_run: bool) -> Mapping[str, object]:
        if dry_run:
            return {"status": "dry_run"}
        from agents.abbott_page_classifier.local_acceptance import read_local_acceptance_artifact

        store = self._store_factory()
        history = store.load_batch_history(int(batch_id))
        if history.batch_status != "published":
            raise WorkflowConfigurationError("BATCH_NOT_PUBLISHED")
        batch = store.load_persisted_batch(int(batch_id))
        store.attest_batch_for_acceptance(int(batch_id), batch.batch)
        artifact = read_local_acceptance_artifact(
            Path(decision_file), batch, _local_decision_root()
        )
        if (
            history.spreadsheet_file_id != artifact.locator
            or history.spreadsheet_projection_hash != artifact.content_hash
        ):
            raise WorkflowConfigurationError("LOCAL_PROJECTION_RECEIPT_MISMATCH")
        snapshot = store.record_local_batch_acceptance(
            int(batch_id), artifact.intent, artifact.locator
        )
        return {
            "status": "accepted", "batch_id": int(batch_id),
            "batch_key": snapshot.batch_key,
            "published_input_hash": snapshot.published_input_hash,
            "accepted_decision_hash": snapshot.accepted_decision_hash,
            "accepted_count": snapshot.accepted_count,
            "skipped_count": snapshot.skipped_count,
        }

    def pull_accepted(self, batch_id: int, *, dry_run: bool) -> Mapping[str, object]:
        if dry_run:
            return {"status": "dry_run"}
        from agents.abbott_page_classifier.sheets_sync import read_accepted_projection

        store = self._store_factory()
        batch = store.load_persisted_batch(int(batch_id))
        spreadsheet_id = self._spreadsheet_id(store, int(batch_id), publication=False)
        snapshot = read_accepted_projection(
            batch, self._sheets_gateway_factory(spreadsheet_id)
        )
        return {
            "status": "accepted_snapshot_ready", "batch_id": int(batch_id),
            "accepted_count": snapshot.accepted_count or 0,
            "skipped_count": snapshot.skipped_count or 0,
            "accepted_decision_hash": snapshot.accepted_decision_hash,
        }

    def ingest(self, batch_id: int, *, dry_run: bool) -> Mapping[str, object]:
        if dry_run:
            return {"status": "dry_run"}
        from agents.abbott_page_classifier.batch_service import ingest_accepted_batch
        from agents.abbott_page_classifier.sheets_sync import read_accepted_projection

        store = self._store_factory()
        history = store.load_batch_history(int(batch_id))
        if history.batch_status == "published":
            batch = store.load_persisted_batch(int(batch_id))
            spreadsheet_id = self._spreadsheet_id(store, int(batch_id), publication=False)
            snapshot = read_accepted_projection(
                batch, self._sheets_gateway_factory(spreadsheet_id)
            )
            store.record_batch_acceptance(int(batch_id), snapshot, spreadsheet_id)
        elif history.batch_status in ("accepted", "ingested"):
            snapshot = store.load_accepted_snapshot(int(batch_id))
        else:
            raise WorkflowConfigurationError("BATCH_NOT_ACCEPTED")
        result = ingest_accepted_batch(snapshot, store)
        return {
            "status": result.status, "batch_id": int(batch_id),
            "accepted_count": result.accepted_count,
            "conflict_count": result.conflict_count,
            "unresolved_count": result.unresolved_count,
            "rejected_count": result.rejected_count,
            "accepted_decision_hash": snapshot.accepted_decision_hash,
        }

    def materialize(self, batch_id: int, *, dry_run: bool) -> Mapping[str, object]:
        if dry_run:
            return {"status": "dry_run"}
        store = self._store_factory()
        history = store.load_batch_history(int(batch_id))
        candidate_release_id = history.candidate_release_id
        candidate_receipt_valid = (
            isinstance(candidate_release_id, int)
            and not isinstance(candidate_release_id, bool)
            and candidate_release_id > 0
        )
        if history.batch_status == "candidate_materialized":
            if not candidate_receipt_valid:
                raise WorkflowConfigurationError("CANDIDATE_RECEIPT_INCONSISTENT")
            return {
                "status": "noop", "batch_id": int(batch_id),
                "candidate_release_id": candidate_release_id,
            }
        if candidate_release_id is not None or history.batch_status != "ingested":
            if candidate_release_id is not None:
                raise WorkflowConfigurationError("CANDIDATE_RECEIPT_INCONSISTENT")
            raise WorkflowConfigurationError("BATCH_NOT_INGESTED")
        predecessor_id = store.load_predecessor_release_id_for_batch(int(batch_id))
        materializer = self._materializer
        if materializer is None:
            from agents.abbott_page_classifier.candidate_release import materialize_content_candidate
            candidate = materialize_content_candidate(
                int(batch_id), predecessor_id,
                _configuration_from_environment().code_revision,
                connection_factory=self._materializer_connection_factory,
            )
        else:
            candidate = materializer(
                int(batch_id), predecessor_id,
                _configuration_from_environment().code_revision,
            )
        return {
            "status": candidate.status,
            "batch_id": int(batch_id),
            "candidate_release_id": candidate.candidate_release_id,
        }

    def validate(self, batch_id: int, *, dry_run: bool) -> Mapping[str, object]:
        if dry_run:
            return {"status": "dry_run"}
        store = self._store_factory()
        history = store.load_batch_history(int(batch_id))
        if not history.candidate_release_id or not history.accepted_decision_hash:
            raise WorkflowConfigurationError("CANDIDATE_GATE_EVIDENCE_MISSING")
        validator = self._validator
        if validator is None:
            from agents.abbott_page_classifier.candidate_release import (
                validate_and_transition_content_candidate,
            )
            reviewer = os.environ.get(
                "ABBOTT_CONTENT_VALIDATION_REVIEWED_BY", ""
            ).strip()
            report = validate_and_transition_content_candidate(
                history.candidate_release_id,
                {
                    "source": history.ready_count + history.conflict_count
                    + history.unresolved_count + history.rejected_count + history.no_change_count,
                    "ready": history.ready_count, "conflict": history.conflict_count,
                    "unresolved": history.unresolved_count, "rejected": history.rejected_count,
                    "accepted": history.accepted_count, "no_change": history.no_change_count,
                },
                history.accepted_decision_hash,
                reviewed_by=reviewer,
                code_revision=_configuration_from_environment().code_revision,
                materializer_connection_factory=self._materializer_connection_factory,
                operator_connection_factory=self._operator_connection_factory,
            )
        else:
            report = validator(
                history.candidate_release_id,
                {
                    "source": history.ready_count + history.conflict_count
                    + history.unresolved_count + history.rejected_count + history.no_change_count,
                    "ready": history.ready_count, "conflict": history.conflict_count,
                    "unresolved": history.unresolved_count, "rejected": history.rejected_count,
                    "accepted": history.accepted_count, "no_change": history.no_change_count,
                },
                history.accepted_decision_hash,
            )
        return {
            "status": "validated" if report.passed else "validation_failed",
            "batch_id": int(batch_id),
            "candidate_release_id": report.candidate_release_id,
        }

    def status(self, batch_id: int, *, dry_run: bool) -> Mapping[str, object]:
        if dry_run:
            return {"status": "dry_run"}
        history = self._store_factory().load_batch_history(int(batch_id))
        return {
            "status": history.batch_status, "batch_id": int(batch_id),
            "candidate_release_id": history.candidate_release_id or 0,
            "ready_count": history.ready_count, "conflict_count": history.conflict_count,
            "unresolved_count": history.unresolved_count,
            "rejected_count": history.rejected_count,
            "no_change_count": history.no_change_count,
            "accepted_count": history.accepted_count,
            "published_input_hash": history.published_input_hash,
            "accepted_decision_hash": history.accepted_decision_hash or "",
        }


def build_production_dependencies(
    *,
    store_factory: Callable[[], object] = _default_store_factory,
    service_factory: Callable[[object], object] = _default_service_factory,
    sheets_gateway_factory: Callable[[str], object] = _default_sheets_gateway_factory,
    materializer: Callable[[int, int, str], object] | None = None,
    validator: Callable[[int, Mapping[str, int], str], object] | None = None,
    materializer_connection_factory: Callable[[], object] = _materializer_db_connection,
    operator_connection_factory: Callable[[], object] = _release_operator_db_connection,
) -> WorkflowDependencies:
    """Construct lazy production factories without opening any external authority."""

    return WorkflowDependencies(
        ProductionWorkflowGateway(
            store_factory=store_factory,
            service_factory=service_factory,
            sheets_gateway_factory=sheets_gateway_factory,
            materializer=materializer,
            validator=validator,
            materializer_connection_factory=materializer_connection_factory,
            operator_connection_factory=operator_connection_factory,
        )
    )


def _parser() -> argparse.ArgumentParser:
    parser = _SanitizedArgumentParser(add_help=False)
    parser.add_argument("command", choices=COMMANDS)
    parser.add_argument("--run-id")
    parser.add_argument("--batch-id")
    parser.add_argument("--registry1")
    parser.add_argument("--registry2")
    parser.add_argument("--decision-file")
    execution = parser.add_mutually_exclusive_group()
    execution.add_argument("--dry-run", action="store_true")
    execution.add_argument("--execute", action="store_true")
    parser.add_argument("--execute-llm", action="store_true")
    return parser


def _emit(value: Mapping[str, object]) -> None:
    print(json.dumps(
        {key: value[key] for key in sorted(value) if key in _SAFE_OUTPUT_KEYS},
        sort_keys=True,
    ))


def _error(code: str) -> int:
    _emit({"status": code})
    return 2


def _positive_id(raw: str | None, missing_code: str, invalid_code: str):
    if raw is None:
        return None, missing_code
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None, invalid_code
    if value <= 0 or str(value) != str(raw):
        return None, invalid_code
    return value, None


def main(
    argv: Sequence[str] | None = None,
    *,
    dependencies: WorkflowDependencies | None = None,
) -> int:
    if not _PYTHON311_RUNTIME:
        _emit(_PYTHON311_FAILURE)
        return 78
    try:
        args = _parser().parse_args(argv)
    except (SystemExit, WorkflowConfigurationError):
        return _error("ARGUMENTS_INVALID")
    dry_run = bool(args.dry_run) or (
        args.command in _WRITE_COMMANDS and not bool(args.execute)
    )
    if args.execute_llm and args.command != "classify":
        return _error("ARGUMENTS_INVALID")
    if args.decision_file is not None and args.command not in {"publish-local", "accept-local"}:
        return _error("ARGUMENTS_INVALID")
    if args.command in {"publish-local", "accept-local"} and not args.decision_file:
        return _error("DECISION_FILE_REQUIRED")
    if args.command == "reconcile":
        if args.run_id is not None or args.batch_id is not None:
            return _error("IDENTIFIER_INVALID")
        if not args.registry1 or not args.registry2:
            return _error("REGISTRY_SNAPSHOTS_REQUIRED")
    elif args.command == "classify":
        if args.batch_id is not None:
            return _error("IDENTIFIER_INVALID")
        run_id, error = _positive_id(args.run_id, "RUN_ID_REQUIRED", "RUN_ID_INVALID")
        if error:
            return _error(error)
    else:
        if args.run_id is not None:
            return _error("IDENTIFIER_INVALID")
        batch_id, error = _positive_id(args.batch_id, "BATCH_ID_REQUIRED", "BATCH_ID_INVALID")
        if error and not dry_run:
            return _error(error)
        if error:
            batch_id = 0

    # No command factory or external authority is reached for a non-reconcile dry run.
    if dry_run and args.command != "reconcile":
        _emit({"status": "dry_run"})
        return 0
    gateway = (dependencies or build_production_dependencies()).gateway
    try:
        if args.command == "reconcile":
            result = gateway.reconcile(Path(args.registry1), Path(args.registry2), dry_run=dry_run)
        elif args.command == "classify":
            result = gateway.classify(run_id, execute_llm=bool(args.execute_llm), dry_run=False)
        elif args.command == "publish-projection":
            result = gateway.publish_projection(batch_id, dry_run=False)
        elif args.command == "publish-local":
            result = gateway.publish_local(batch_id, Path(args.decision_file), dry_run=False)
        elif args.command == "accept-local":
            result = gateway.accept_local(batch_id, Path(args.decision_file), dry_run=False)
        elif args.command == "pull-accepted":
            result = gateway.pull_accepted(batch_id, dry_run=False)
        elif args.command == "ingest":
            result = gateway.ingest(batch_id, dry_run=False)
        elif args.command == "materialize":
            result = gateway.materialize(batch_id, dry_run=False)
        elif args.command == "validate":
            result = gateway.validate(batch_id, dry_run=False)
        else:
            result = gateway.status(batch_id, dry_run=False)
    except WorkflowConfigurationError as error:
        stable = str(error)
        return _error(stable if stable.isupper() and len(stable) <= 64 else "OPERATOR_CONFIGURATION_INVALID")
    except Exception:
        return _error("WORKFLOW_STAGE_FAILED")
    _emit(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
