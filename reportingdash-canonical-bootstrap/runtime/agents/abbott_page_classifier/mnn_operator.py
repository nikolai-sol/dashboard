"""Owner-only CLI for immutable Abbott MNN workbook registration."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .mnn_repository import MnnImportError, import_mnn_workbook


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Register reviewed Abbott MNN metadata")
    parser.add_argument("--workbook", type=Path, required=True)
    parser.add_argument("--private-archive-locator", required=True)
    parser.add_argument("--code-revision", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        receipt = import_mnn_workbook(
            args.workbook,
            private_archive_locator=args.private_archive_locator,
            code_revision=args.code_revision,
        )
    except MnnImportError as exc:
        print(json.dumps({"status": "error", "code": exc.code}, sort_keys=True))
        return 1
    print(
        json.dumps(
            {
                "status": receipt.status,
                "snapshot_id": receipt.snapshot_id,
                "claim_count": receipt.claim_count,
                "mapped_count": receipt.mapped_count,
                "unresolved_count": receipt.unresolved_count,
                "collision_count": receipt.collision_count,
                "unlinked_count": receipt.unlinked_count,
                "rejected_count": receipt.rejected_count,
                "claims_hash": receipt.claims_hash,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
