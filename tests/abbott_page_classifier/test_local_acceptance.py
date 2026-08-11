from __future__ import annotations

import hashlib
import json
import os
from dataclasses import replace
from datetime import datetime
from pathlib import Path
import tempfile
import unittest

from agents.abbott_page_classifier.approval_hashes import compute_batch_hash, compute_item_hash
from agents.abbott_page_classifier.batch_service import BuiltApprovalBatch, PersistedApprovalBatch
from agents.abbott_page_classifier.domain import ApprovalItem
from agents.abbott_page_classifier.local_acceptance import (
    LocalAcceptanceError,
    read_local_acceptance_intent,
)


class LocalAcceptanceIntentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.private_root = Path(self.temporary_directory.name) / "private"
        self.private_root.mkdir(mode=0o700)
        self.items = tuple(self._item(index) for index in (1, 2))
        self.batch = BuiltApprovalBatch(
            batch_key="abbott-local-acceptance",
            taxonomy_version="abbott.v1",
            published_input_hash=compute_batch_hash(self.items),
            items=self.items,
            taxonomy_terms={
                "direction": ("cardiology",),
                "material_type": ("articles",),
                "access": ("doctors",),
                "lifecycle": ("active",),
            },
        )
        self.persisted_batch = PersistedApprovalBatch(self.batch, 8)

    def _item(self, index: int) -> ApprovalItem:
        item = ApprovalItem(
            content_entity_id=index,
            input_hash=hashlib.sha256(f"input-{index}".encode()).hexdigest(),
            title=f"Immutable title {index}",
            url=f"https://www.abbott.example/{index}",
            final_direction_code="cardiology",
            final_material_type_code="articles",
            final_access_code="doctors",
            final_lifecycle_code="active",
            readiness_state="ready",
        )
        return replace(item, row_hash=compute_item_hash(item))

    def _payload(self) -> dict[str, object]:
        return {
            "schema_version": 1,
            "dataset_key": "abbott",
            "batch_id": 8,
            "batch_key": self.batch.batch_key,
            "published_input_hash": self.batch.published_input_hash,
            "accepted_by": "content-manager",
            "accepted_at": "2026-08-11T12:34:56Z",
            "decisions": [
                {
                    "input_hash": item.input_hash,
                    "row_hash": item.row_hash,
                    "final_direction_code": item.final_direction_code,
                    "final_material_type_code": item.final_material_type_code,
                    "final_access_code": item.final_access_code,
                    "final_lifecycle_code": item.final_lifecycle_code,
                    "selected_content_entity_id": None,
                    "url_alias_decision": None,
                    "decision_reason": "reviewed",
                }
                for item in self.items
            ],
        }

    def _write(self, name: str, payload: object, *, mode: int = 0o600) -> Path:
        path = self.private_root / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        path.chmod(mode)
        return path

    def test_local_intent_rehydrates_immutable_fields_and_preserves_identity(self):
        decision_path = self._write("decision.json", self._payload())

        intent = read_local_acceptance_intent(
            decision_path, self.persisted_batch, self.private_root
        )

        self.assertEqual(intent.batch_id, self.persisted_batch.database_batch_id)
        self.assertEqual(intent.batch_key, self.persisted_batch.batch.batch_key)
        self.assertEqual(intent.published_input_hash, self.batch.published_input_hash)
        self.assertEqual(intent.accepted_at, datetime(2026, 8, 11, 12, 34, 56))
        self.assertEqual(
            tuple(row.input_hash for row in intent.decisions),
            tuple(item.input_hash for item in self.persisted_batch.batch.items),
        )
        self.assertEqual(
            tuple(row.row_hash for row in intent.decisions),
            tuple(item.row_hash for item in self.persisted_batch.batch.items),
        )

    def test_local_intent_rejects_symlink_mode_and_hash_drift(self):
        good_path = self._write("good.json", self._payload())
        symlink_path = self.private_root / "symlink.json"
        symlink_path.symlink_to(good_path)
        mode_0644_path = self._write("mode-0644.json", self._payload(), mode=0o644)
        outside_private_root = Path(self.temporary_directory.name) / "outside.json"
        outside_private_root.write_text(json.dumps(self._payload()), encoding="utf-8")
        outside_private_root.chmod(0o600)
        drift = self._payload()
        drift["published_input_hash"] = "0" * 64
        hash_drift_path = self._write("hash-drift.json", drift)

        for bad_path in (
            symlink_path,
            mode_0644_path,
            outside_private_root,
            hash_drift_path,
        ):
            with self.subTest(path=bad_path), self.assertRaisesRegex(
                LocalAcceptanceError, "LOCAL_DECISION_FILE_INVALID"
            ):
                read_local_acceptance_intent(
                    bad_path, self.persisted_batch, self.private_root
                )

    def test_local_intent_rejects_reordered_or_mutated_identity_and_invalid_decision_fields(self):
        cases = []
        reordered = self._payload()
        reordered["decisions"].reverse()
        cases.append(reordered)
        mutated = self._payload()
        mutated["decisions"][0]["row_hash"] = "f" * 64
        cases.append(mutated)
        extra_field = self._payload()
        extra_field["immutable_title"] = "attempted override"
        cases.append(extra_field)
        invalid_taxonomy = self._payload()
        invalid_taxonomy["decisions"][0]["final_direction_code"] = "not-a-term"
        cases.append(invalid_taxonomy)
        noncanonical_timestamp = self._payload()
        noncanonical_timestamp["accepted_at"] = "2026-08-11T12:34:56+00:00"
        cases.append(noncanonical_timestamp)

        for index, payload in enumerate(cases):
            path = self._write(f"bad-{index}.json", payload)
            with self.subTest(index=index), self.assertRaisesRegex(
                LocalAcceptanceError, "LOCAL_DECISION_FILE_INVALID"
            ):
                read_local_acceptance_intent(path, self.persisted_batch, self.private_root)
