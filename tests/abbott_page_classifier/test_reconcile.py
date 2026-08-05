"""Pure reconciliation tests for Abbott registry precedence and Batch 2."""

from __future__ import annotations

import unittest

from agents.abbott_page_classifier.domain import (
    CanonicalClassification,
    ConflictCode,
    MaterialCandidate,
    Proposal,
)
from agents.abbott_page_classifier.reconcile import ReconciliationInput, reconcile_entity
from agents.abbott_page_classifier.classify import Classification, classification_to_proposal
from agents.abbott_page_classifier.sources import (
    SourceCandidate,
    SourceIdentityVariant,
    SourceProvenance,
)


def candidate(
    source_name: str,
    *,
    row: int = 1,
    title: str = "Материал",
    url: str = "https://abbottpro.ru/material",
    direction: str | None = None,
    material_type: str | None = None,
    access: str | None = None,
    lifecycle: str = "active",
) -> MaterialCandidate:
    return MaterialCandidate(
        source_name=source_name,
        source_row_id=f"{source_name}:{row}",
        title=title,
        url=url,
        material_id=None,
        direction_code=direction,
        material_type_code=material_type,
        access_code=access,
        lifecycle_code=lifecycle,
        source_fingerprint=f"{row:064x}",
    )


def canonical(
    *,
    title: str = "Канонический материал",
    direction: str | None = "cardiology",
    material_type: str | None = "articles",
    access: str | None = "doctors",
    lifecycle: str = "active",
) -> CanonicalClassification:
    return CanonicalClassification(
        content_entity_id=41,
        title=title,
        url="https://abbottpro.ru/material",
        direction_code=direction,
        material_type_code=material_type,
        access_code=access,
        lifecycle_code=lifecycle,
        event_id=17,
    )


def proposal(
    *,
    direction: str | None = None,
    material_type: str | None = None,
    access: str | None = None,
    lifecycle: str | None = None,
    rule: str = "fixture",
) -> Proposal:
    return Proposal(
        direction_code=direction,
        material_type_code=material_type,
        access_code=access,
        lifecycle_code=lifecycle,
        rule_code=rule,
        confidence=0.9,
    )


class ReconciliationTests(unittest.TestCase):
    def test_registry1_fills_metadata_without_overwriting_active_classification(
        self,
    ) -> None:
        item = reconcile_entity(
            ReconciliationInput(
                active_canonical=canonical(title=""),
                registry1=candidate(
                    "registry1",
                    title="Новый заголовок",
                    direction="gastroenterology",
                ),
            )
        )

        self.assertEqual(item.title, "Новый заголовок")
        self.assertEqual(item.final_direction_code, "cardiology")
        self.assertEqual(item.readiness_state, "conflict")
        self.assertEqual(item.conflict_codes, (ConflictCode.DIRECTION_CONFLICT,))

    def test_existing_page_direction_never_flips_automatically(self) -> None:
        item = reconcile_entity(
            ReconciliationInput(
                active_canonical=canonical(),
                deterministic_proposal=proposal(direction="gastroenterology"),
                llm_proposal=proposal(direction="gastroenterology"),
            )
        )

        self.assertEqual(item.final_direction_code, "cardiology")
        self.assertEqual(
            item.conflict_codes,
            (ConflictCode.ANTI_FLIP_CONFLICT,),
        )

    def test_empty_incoming_values_never_erase_active_values(self) -> None:
        item = reconcile_entity(
            ReconciliationInput(
                active_canonical=canonical(),
                registry1=candidate("registry1", title="", url=""),
                registry2=candidate("registry2", title="", url=""),
            )
        )

        self.assertEqual(item.title, "Канонический материал")
        self.assertEqual(item.final_direction_code, "cardiology")
        self.assertEqual(item.final_material_type_code, "articles")
        self.assertEqual(item.final_access_code, "doctors")
        self.assertEqual(item.readiness_state, "no_change")
        self.assertEqual(item.conflict_codes, ())

    def test_registry1_reports_simultaneous_classification_differences(self) -> None:
        item = reconcile_entity(
            ReconciliationInput(
                active_canonical=canonical(),
                registry1=candidate(
                    "registry1",
                    direction="gastroenterology",
                    material_type="video",
                    access="all",
                ),
            )
        )

        self.assertEqual(item.final_direction_code, "cardiology")
        self.assertEqual(item.final_material_type_code, "articles")
        self.assertEqual(item.final_access_code, "doctors")
        self.assertEqual(
            item.conflict_codes,
            (
                ConflictCode.DIRECTION_CONFLICT,
                ConflictCode.MATERIAL_TYPE_CONFLICT,
                ConflictCode.ACCESS_CONFLICT,
            ),
        )

    def test_registry1_adds_a_new_entity(self) -> None:
        item = reconcile_entity(
            ReconciliationInput(
                registry1=candidate(
                    "registry1",
                    title="Новый материал",
                    url="https://abbottpro.ru/new",
                    direction="dermatology",
                    material_type="video",
                    access="all",
                )
            )
        )

        self.assertIsNone(item.content_entity_id)
        self.assertEqual(item.title, "Новый материал")
        self.assertEqual(item.final_direction_code, "dermatology")
        self.assertEqual(item.final_material_type_code, "video")
        self.assertEqual(item.final_access_code, "all")
        self.assertEqual(item.final_lifecycle_code, "active")
        self.assertEqual(item.readiness_state, "ready")

    def test_accepted_registry2_fills_missing_classification_on_unlocked_entity(self) -> None:
        item = reconcile_entity(
            ReconciliationInput(
                active_canonical=canonical(
                    direction=None,
                    material_type=None,
                    access=None,
                    lifecycle="unknown",
                ),
                registry2=candidate(
                    "registry2",
                    direction="womens_health",
                    material_type="clinical_cases",
                    access="doctors",
                    lifecycle="active",
                ),
            )
        )

        self.assertEqual(item.final_direction_code, "womens_health")
        self.assertEqual(item.final_material_type_code, "clinical_cases")
        self.assertEqual(item.final_access_code, "doctors")
        self.assertEqual(item.final_lifecycle_code, "active")
        self.assertEqual(item.readiness_state, "ready")
        self.assertEqual(item.conflict_codes, ())

    def test_registry1_metadata_does_not_claim_an_existing_unlocked_classification(self) -> None:
        item = reconcile_entity(
            ReconciliationInput(
                active_canonical=canonical(
                    title="",
                    direction=None,
                    material_type=None,
                    access=None,
                    lifecycle="unknown",
                ),
                registry1=candidate(
                    "registry1",
                    title="Заголовок Registry 1",
                    direction="cardiology",
                    material_type="video",
                    access="all",
                ),
                registry2=candidate(
                    "registry2",
                    title="Заголовок Registry 2",
                    direction="gastroenterology",
                    material_type="articles",
                    access="doctors",
                ),
            )
        )

        self.assertEqual(item.title, "Заголовок Registry 1")
        self.assertEqual(item.final_direction_code, "gastroenterology")
        self.assertEqual(item.final_material_type_code, "articles")
        self.assertEqual(item.final_access_code, "doctors")
        self.assertEqual(item.conflict_codes, ())

    def test_accepted_registry2_never_overwrites_active_canonical(self) -> None:
        item = reconcile_entity(
            ReconciliationInput(
                active_canonical=canonical(),
                registry2=candidate(
                    "registry2",
                    direction="gastroenterology",
                    material_type="video",
                    access="all",
                ),
            )
        )

        self.assertEqual(item.final_direction_code, "cardiology")
        self.assertEqual(item.final_material_type_code, "articles")
        self.assertEqual(item.final_access_code, "doctors")
        self.assertEqual(
            item.conflict_codes,
            (
                ConflictCode.DIRECTION_CONFLICT,
                ConflictCode.MATERIAL_TYPE_CONFLICT,
                ConflictCode.ACCESS_CONFLICT,
            ),
        )

    def test_explicit_reviewed_correction_supersedes_active_canonical(self) -> None:
        correction = proposal(
            direction="gastroenterology",
            material_type="video",
            access="all",
            lifecycle="active",
            rule="reviewed_correction",
        )
        item = reconcile_entity(
            ReconciliationInput(
                active_canonical=canonical(),
                reviewed_correction=correction,
                deterministic_proposal=proposal(direction="gastroenterology"),
                llm_proposal=proposal(direction="gastroenterology"),
            )
        )

        self.assertEqual(item.final_direction_code, "gastroenterology")
        self.assertEqual(item.final_material_type_code, "video")
        self.assertEqual(item.final_access_code, "all")
        self.assertEqual(item.readiness_state, "ready")
        self.assertNotIn(ConflictCode.ANTI_FLIP_CONFLICT, item.conflict_codes)

    def test_archive_requires_override_or_not_found_evidence(self) -> None:
        invalid = reconcile_entity(
            ReconciliationInput(
                registry2=candidate(
                    "registry2",
                    direction="cardiology",
                    access="all",
                ),
                registry2_material_type_raw="Архив",
                http_status=500,
            )
        )
        overridden = reconcile_entity(
            ReconciliationInput(
                registry2=candidate(
                    "registry2",
                    direction="cardiology",
                    access="all",
                ),
                registry2_material_type_raw="Архив",
                explicit_archive_override=True,
            )
        )
        not_found = reconcile_entity(
            ReconciliationInput(
                registry2=candidate(
                    "registry2",
                    direction="cardiology",
                    access="all",
                ),
                registry2_material_type_raw="Архив",
                http_status=404,
            )
        )
        override_without_legacy_type = reconcile_entity(
            ReconciliationInput(
                registry2=candidate(
                    "registry2",
                    direction="cardiology",
                    material_type="articles",
                    access="all",
                ),
                explicit_archive_override=True,
            )
        )

        self.assertEqual(
            invalid.conflict_codes,
            (ConflictCode.ARCHIVE_TYPE_INVALID,),
        )
        self.assertEqual(invalid.final_lifecycle_code, "active")
        self.assertEqual(overridden.final_lifecycle_code, "archive_candidate")
        self.assertNotIn(ConflictCode.ARCHIVE_TYPE_INVALID, overridden.conflict_codes)
        self.assertEqual(not_found.final_lifecycle_code, "archive_candidate")
        self.assertNotIn(ConflictCode.ARCHIVE_TYPE_INVALID, not_found.conflict_codes)
        self.assertEqual(
            override_without_legacy_type.final_lifecycle_code,
            "archive_candidate",
        )

    def test_deterministic_proposal_precedes_llm_for_missing_classification(self) -> None:
        item = reconcile_entity(
            ReconciliationInput(
                registry1=candidate(
                    "registry1",
                    material_type="articles",
                    access="all",
                ),
                deterministic_proposal=proposal(direction="cardiology"),
                llm_proposal=proposal(direction="gastroenterology"),
            )
        )

        self.assertEqual(item.final_direction_code, "cardiology")

    def test_http_410_maps_lifecycle_without_erasing_material_type(self) -> None:
        item = reconcile_entity(
            ReconciliationInput(active_canonical=canonical(), http_status=410)
        )

        self.assertEqual(item.final_material_type_code, "articles")
        self.assertEqual(item.final_lifecycle_code, "archive_candidate")
        self.assertEqual(item.readiness_state, "ready")

    def test_llm_verifier_disagreement_is_a_conflict(self) -> None:
        item = reconcile_entity(
            ReconciliationInput(
                registry1=candidate(
                    "registry1",
                    material_type="articles",
                    access="all",
                ),
                llm_proposal=proposal(direction="cardiology"),
                verifier_proposal=proposal(direction="gastroenterology"),
            )
        )

        self.assertEqual(item.final_direction_code, "cardiology")
        self.assertEqual(item.readiness_state, "conflict")
        self.assertEqual(item.conflict_codes, (ConflictCode.LLM_DISAGREEMENT,))

    def test_identity_and_content_failures_use_stable_codes_and_states(self) -> None:
        collision = reconcile_entity(
            ReconciliationInput(
                registry1=candidate("registry1"),
                identity_conflict=True,
            )
        )
        unavailable = reconcile_entity(
            ReconciliationInput(
                registry1=candidate("registry1"),
                content_available=False,
            )
        )
        rejected = reconcile_entity(
            ReconciliationInput(
                registry1=candidate("registry1"),
                rejection_code="MISSING_IDENTITY",
            )
        )

        self.assertEqual(collision.readiness_state, "conflict")
        self.assertEqual(collision.conflict_codes, (ConflictCode.IDENTITY_COLLISION,))
        self.assertEqual(unavailable.readiness_state, "unresolved")
        self.assertEqual(unavailable.conflict_codes, (ConflictCode.CONTENT_UNAVAILABLE,))
        self.assertEqual(rejected.readiness_state, "rejected")

    def test_batch2_exact_counts_and_archive_gate(self) -> None:
        items = []
        for row in range(377):
            has_direction = row < 234
            archive_value = row < 146
            items.append(
                reconcile_entity(
                    ReconciliationInput(
                        registry2=candidate(
                            "registry2",
                            row=row + 1,
                            title=f"Материал {row + 1}",
                            url=f"https://abbottpro.ru/material-{row + 1}",
                            direction="cardiology" if has_direction else None,
                            material_type=None if archive_value else "articles",
                            access="all",
                        ),
                        registry2_material_type_raw=(
                            "Архив" if archive_value else "Статьи"
                        ),
                        explicit_archive_override=row < 4,
                        http_status=404 if 4 <= row < 6 else 200,
                    )
                )
            )

        counts = {
            state: sum(item.readiness_state == state for item in items)
            for state in ("ready", "conflict", "unresolved", "rejected", "no_change")
        }
        directionless = items[234:]
        archive_invalid = [
            item
            for item in items
            if ConflictCode.ARCHIVE_TYPE_INVALID in item.conflict_codes
        ]

        self.assertEqual(sum(counts.values()), 377)
        self.assertEqual(
            counts,
            {
                "ready": 88,
                "conflict": 140,
                "unresolved": 149,
                "rejected": 0,
                "no_change": 0,
            },
        )
        self.assertEqual(len(directionless), 143)
        self.assertTrue(all(item.readiness_state == "unresolved" for item in directionless))
        self.assertEqual(len(archive_invalid), 140)
        self.assertTrue(
            all(items[row].final_lifecycle_code == "archive_candidate" for row in range(6))
        )

    def test_legacy_classification_converts_to_normalized_proposal(self) -> None:
        result = Classification(
            direction="Кардиология [262338]",
            material_type="Статьи",
            access="Врачи",
            confidence=0.8,
            rule="path_prefix:cardio",
            lifecycle_code="archive_candidate",
            lifecycle_rule="http_404",
        )

        converted = classification_to_proposal(result)

        self.assertEqual(converted.direction_code, "cardiology")
        self.assertEqual(converted.material_type_code, "articles")
        self.assertEqual(converted.access_code, "doctors")
        self.assertEqual(converted.lifecycle_code, "archive_candidate")
        self.assertEqual(converted.rule_code, "path_prefix:cardio")
        self.assertEqual(converted.evidence, ("http_404",))

    def test_input_hash_covers_every_collapsed_source_occurrence(self) -> None:
        representative = candidate(
            "registry1",
            direction="cardiology",
            material_type="articles",
            access="all",
        )
        first = SourceCandidate(
            key="url:https://abbottpro.ru/material",
            candidate=representative,
            provenance=(
                SourceProvenance("registry1", "registry1:1", "a" * 64),
            ),
            identity_variants=(
                SourceIdentityVariant(
                    "registry1:1",
                    None,
                    representative.url,
                    representative.title,
                    representative.material_type_code,
                ),
            ),
        )
        second = SourceCandidate(
            key=first.key,
            candidate=representative,
            provenance=first.provenance
            + (SourceProvenance("registry1", "registry1:2", "b" * 64),),
            identity_variants=first.identity_variants
            + (
                SourceIdentityVariant(
                    "registry1:2",
                    None,
                    representative.url,
                    representative.title,
                    representative.material_type_code,
                ),
            ),
        )

        first_item = reconcile_entity(ReconciliationInput(registry1=first))
        second_item = reconcile_entity(ReconciliationInput(registry1=second))

        self.assertNotEqual(first_item.input_hash, second_item.input_hash)


if __name__ == "__main__":
    unittest.main()
