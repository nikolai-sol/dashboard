#!/usr/bin/env python3
"""Weekly Abbott proposal orchestration; stops at manual Sheet approval."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Callable, Mapping, Sequence


_PYTHON311_RUNTIME = sys.version_info[:2] == (3, 11)
_PYTHON311_FAILURE = {"status": "ABBOTT_CONTENT_PYTHON311_VERSION_REQUIRED"}
if __name__ == "__main__" and not _PYTHON311_RUNTIME:
    print(json.dumps(_PYTHON311_FAILURE, sort_keys=True))
    raise SystemExit(78)

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from agents.abbott_page_classifier.workflow import (
    WorkflowConfigurationError,
    WorkflowDependencies,
    build_production_dependencies,
)
from agents.abbott_page_classifier.workflow_service import WorkflowConfiguration


_SAFE_KEYS = frozenset(
    {
        "status", "run_id", "run_key", "batch_id", "batch_key",
        "source_count", "ready_count", "conflict_count", "unresolved_count",
        "rejected_count", "no_change_count", "registry1_hash", "registry2_hash",
        "published_input_hash", "batch_hash",
    }
)


class _Parser(argparse.ArgumentParser):
    def error(self, _message: str) -> None:
        raise WorkflowConfigurationError("ARGUMENTS_INVALID")


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(add_help=False)
    parser.add_argument("--registry1", required=True)
    parser.add_argument("--registry2", required=True)
    parser.add_argument("--taxonomy-version", required=True)
    parser.add_argument("--prompt-version", required=True)
    parser.add_argument("--model-routing-version", required=True)
    parser.add_argument("--code-revision", required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--execute-llm", action="store_true")
    return parser


def _emit(value: Mapping[str, object]) -> None:
    print(
        json.dumps(
            {key: value[key] for key in sorted(value) if key in _SAFE_KEYS},
            sort_keys=True,
        )
    )


def _default_dependencies(configuration: WorkflowConfiguration) -> WorkflowDependencies:
    from agents.abbott_page_classifier.llm_classifier import OpenAIContentClassifier
    from agents.abbott_page_classifier.workflow_service import CanonicalWeeklyProposalService

    def service_factory(store):
        def classifier_factory():
            if not os.environ.get("OPENAI_API_KEY"):
                raise WorkflowConfigurationError("OPENAI_API_KEY_REQUIRED")
            return OpenAIContentClassifier()

        return CanonicalWeeklyProposalService(
            store, configuration, classifier_factory=classifier_factory
        )

    return build_production_dependencies(service_factory=service_factory)


def _positive_receipt_id(receipt: Mapping[str, object], key: str, code: str) -> int:
    try:
        value = int(receipt[key])
    except (KeyError, TypeError, ValueError):
        raise WorkflowConfigurationError(code) from None
    if value <= 0:
        raise WorkflowConfigurationError(code)
    return value


def main(
    argv: Sequence[str] | None = None,
    *,
    dependencies_factory: Callable[[WorkflowConfiguration], WorkflowDependencies] = _default_dependencies,
) -> int:
    if not _PYTHON311_RUNTIME:
        _emit(_PYTHON311_FAILURE)
        return 78
    try:
        args = _parser().parse_args(argv)
        configuration = WorkflowConfiguration(
            taxonomy_version=args.taxonomy_version,
            prompt_version=args.prompt_version,
            model_routing_version=args.model_routing_version,
            code_revision=args.code_revision,
        )
    except (SystemExit, ValueError, WorkflowConfigurationError):
        _emit({"status": "WEEKLY_CONFIGURATION_INVALID"})
        return 2

    # The weekly dry run is deliberately a zero-authority configuration check.
    if not args.execute:
        _emit({"status": "dry_run"})
        return 0

    try:
        gateway = dependencies_factory(configuration).gateway
        run = gateway.reconcile(
            Path(args.registry1), Path(args.registry2), dry_run=False
        )
        run_id = _positive_receipt_id(run, "run_id", "RECONCILIATION_RECEIPT_INVALID")
        batch = gateway.classify(
            run_id, execute_llm=bool(args.execute_llm), dry_run=False
        )
        batch_id = _positive_receipt_id(batch, "batch_id", "BATCH_RECEIPT_INVALID")
        published = gateway.publish_projection(batch_id, dry_run=False)
    except WorkflowConfigurationError as error:
        code = str(error)
        _emit({"status": code if code.isupper() and len(code) <= 64 else "WEEKLY_CONFIGURATION_INVALID"})
        return 2
    except Exception:
        _emit({"status": "WEEKLY_PROPOSAL_FAILED"})
        return 2

    result = {
        **run,
        **batch,
        **published,
        "run_id": run_id,
        "batch_id": batch_id,
        "status": "proposal_published",
    }
    _emit(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
