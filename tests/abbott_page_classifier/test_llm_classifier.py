"""Offline contracts for the Abbott OpenAI classification adapter."""

from __future__ import annotations

import json
from types import SimpleNamespace
import unittest

from agents.abbott_page_classifier.domain import Proposal
from agents.abbott_page_classifier.llm_classifier import (
    LLM_PRIMARY_MODEL,
    LLM_VERIFIER_MODEL,
    LlmAttempt,
    LlmClassification,
    LlmRequest,
    OpenAIContentClassifier,
    SYSTEM_PROMPT_V1,
    route_llm,
)


class _FakeResponses:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class _FakeClient:
    def __init__(self, outcomes):
        self.responses = _FakeResponses(outcomes)


class APITimeoutError(Exception):
    pass


class RateLimitError(Exception):
    status_code = 429


class APIStatusError(Exception):
    def __init__(self, status_code):
        super().__init__("sensitive body must not escape")
        self.status_code = status_code


def _classification(**overrides):
    values = {
        "direction_code": "cardiology",
        "material_type_code": "articles",
        "direction_confidence": 0.94,
        "material_type_confidence": 0.93,
        "alternative_direction_codes": (),
        "evidence": ("URL path contains cardio",),
        "requires_medical_review": False,
        "insufficient_evidence": False,
    }
    values.update(overrides)
    return LlmClassification(**values)


def _completed(value=None):
    return SimpleNamespace(status="completed", output_parsed=value or _classification())


def _request(**overrides):
    values = {
        "title": "Кардиологическая статья",
        "normalized_url": "https://abbottpro.ru/cardio/articles/heart",
        "normalized_path": "/cardio/articles/heart",
        "breadcrumbs": ("Кардиология", "Статьи"),
        "h1": "Кардиологическая статья",
        "meta_description": "Материал для врачей",
        "content_excerpt": "Клиническое содержание",
        "access_code": "doctors",
        "material_type_hint": "articles",
        "deterministic_proposal": Proposal(
            direction_code="cardiology",
            material_type_code="articles",
            access_code="doctors",
            lifecycle_code="active",
            rule_code="path_prefix",
            confidence=0.8,
            evidence=("path:cardio",),
        ),
        "taxonomy_version": "abbott-v1",
        "approved_examples": (
            {
                "title": "Пример",
                "direction_code": "cardiology",
                "material_type_code": "articles",
            },
        ),
    }
    values.update(overrides)
    return LlmRequest(**values)


def _attempt(value=None, *, status="success", code=None, model=LLM_PRIMARY_MODEL):
    return LlmAttempt(
        status=status,
        model=model,
        classification=value,
        unresolved_code=code,
        attempt_count=1,
    )


class StructuredOutputTests(unittest.TestCase):
    def test_schema_rejects_unknown_fields(self):
        with self.assertRaises((TypeError, ValueError)):
            _classification(unapproved_field="no")

    def test_schema_rejects_free_form_taxonomy_and_out_of_bounds_confidence(self):
        with self.assertRaises(ValueError):
            _classification(direction_code="free form")
        with self.assertRaises(ValueError):
            _classification(direction_confidence=1.01)
        with self.assertRaises(ValueError):
            _classification(material_type_confidence=-0.01)

    def test_schema_bounds_short_evidence(self):
        with self.assertRaises(ValueError):
            _classification(evidence=("x" * 241,))
        with self.assertRaises(ValueError):
            _classification(evidence=tuple("signal" for _ in range(6)))
        with self.assertRaises(ValueError):
            _classification(evidence=("   ",))

    def test_insufficient_evidence_is_a_strict_abstention(self):
        abstention = _classification(
            direction_code="undetermined",
            material_type_code=None,
            direction_confidence=0.0,
            material_type_confidence=0.0,
            evidence=(),
            insufficient_evidence=True,
        )
        self.assertTrue(abstention.insufficient_evidence)
        with self.assertRaises(ValueError):
            _classification(insufficient_evidence=True)
        with self.assertRaises(ValueError):
            _classification(direction_code="undetermined", material_type_code=None)


class AdapterTests(unittest.TestCase):
    def test_parse_receives_only_minimized_immutable_material_json(self):
        client = _FakeClient([_completed()])
        classifier = OpenAIContentClassifier(client=client)
        result = classifier.classify(
            _request(content_excerpt="я" * 12_010), LLM_PRIMARY_MODEL
        )

        self.assertEqual(result.status, "success")
        self.assertEqual(result.attempt_count, 1)
        self.assertEqual(len(client.responses.calls), 1)
        call = client.responses.calls[0]
        self.assertEqual(
            set(call),
            {"model", "input", "text_format", "store", "tools", "reasoning"},
        )
        self.assertEqual(call["model"], LLM_PRIMARY_MODEL)
        self.assertIs(call["text_format"], LlmClassification)
        self.assertIs(call["store"], False)
        self.assertEqual(call["tools"], [])
        self.assertEqual(call["reasoning"], {"effort": "low"})
        self.assertEqual(call["input"][0], {"role": "system", "content": SYSTEM_PROMPT_V1})
        material = json.loads(call["input"][1]["content"])
        self.assertEqual(
            set(material),
            {
                "access_code",
                "approved_examples",
                "breadcrumbs",
                "content_excerpt",
                "deterministic_evidence",
                "deterministic_proposal",
                "h1",
                "material_type_hint",
                "meta_description",
                "normalized_path",
                "normalized_url",
                "taxonomy_version",
                "title",
            },
        )
        self.assertEqual(len(material["content_excerpt"]), 12_000)
        self.assertEqual(material["deterministic_evidence"], ["path:cardio"])
        self.assertEqual(material["taxonomy_version"], "abbott-v1")
        self.assertEqual(material["approved_examples"][0]["title"], "Пример")

    def test_sol_uses_explicit_medium_reasoning(self):
        client = _FakeClient([_completed()])
        OpenAIContentClassifier(client=client).classify(_request(), LLM_VERIFIER_MODEL)
        self.assertEqual(client.responses.calls[0]["reasoning"], {"effort": "medium"})

    def test_unsupported_model_fails_closed_without_call(self):
        client = _FakeClient([_completed()])
        result = OpenAIContentClassifier(client=client).classify(_request(), "gpt-5.6")
        self.assertEqual(result.status, "unresolved")
        self.assertEqual(result.unresolved_code, "LLM_MODEL_NOT_ALLOWED")
        self.assertEqual(result.attempt_count, 0)
        self.assertEqual(client.responses.calls, [])

    def test_locked_classification_never_calls_a_model(self):
        client = _FakeClient([_completed()])
        result = OpenAIContentClassifier(client=client).classify(
            _request(classification_locked=True), LLM_PRIMARY_MODEL
        )
        self.assertEqual(result.status, "locked")
        self.assertEqual(result.unresolved_code, "LLM_LOCKED")
        self.assertEqual(result.attempt_count, 0)
        self.assertEqual(client.responses.calls, [])

    def test_sensitive_content_is_rejected_before_serialization_or_call(self):
        cases = (
            "raw_user_id=42",
            "visit_id=123",
            "client_id=456",
            "user_behavior=row",
            "person@example.com",
            "+43 664 123 45 67",
            "METRIKA_TOKEN=secret",
            "Authorization: Bearer secret-value",
            "oauth access_token",
        )
        for sensitive in cases:
            with self.subTest(sensitive=sensitive):
                client = _FakeClient([_completed()])
                result = OpenAIContentClassifier(client=client).classify(
                    _request(content_excerpt=sensitive), LLM_PRIMARY_MODEL
                )
                self.assertEqual(result.status, "unresolved")
                self.assertEqual(result.unresolved_code, "LLM_INPUT_REJECTED")
                self.assertEqual(result.attempt_count, 0)
                self.assertEqual(client.responses.calls, [])

    def test_sensitive_nested_example_key_is_rejected(self):
        client = _FakeClient([_completed()])
        request = _request(approved_examples=({"email": "hidden"},))
        result = OpenAIContentClassifier(client=client).classify(
            request, LLM_PRIMARY_MODEL
        )
        self.assertEqual(result.unresolved_code, "LLM_INPUT_REJECTED")
        self.assertEqual(client.responses.calls, [])

    def test_free_form_input_taxonomy_is_rejected_before_call(self):
        cases = (
            {"taxonomy_version": ""},
            {"access_code": "manager"},
            {"material_type_hint": "archive"},
            {
                "deterministic_proposal": Proposal(
                    direction_code="invented",
                    material_type_code="articles",
                    access_code="doctors",
                    lifecycle_code="active",
                    rule_code="test",
                    confidence=0.8,
                )
            },
            {"approved_examples": ({"direction_code": "invented"},)},
        )
        for override in cases:
            with self.subTest(override=override):
                client = _FakeClient([_completed()])
                result = OpenAIContentClassifier(client=client).classify(
                    _request(**override), LLM_PRIMARY_MODEL
                )
                self.assertEqual(result.unresolved_code, "LLM_INPUT_REJECTED")
                self.assertEqual(client.responses.calls, [])

    def test_timeout_retries_exactly_once_with_identical_serialized_input(self):
        client = _FakeClient([APITimeoutError("private"), _completed()])
        result = OpenAIContentClassifier(client=client).classify(
            _request(), LLM_PRIMARY_MODEL
        )
        self.assertEqual(result.status, "success")
        self.assertEqual(result.attempt_count, 2)
        self.assertEqual(len(client.responses.calls), 2)
        self.assertEqual(
            client.responses.calls[0]["input"][1]["content"],
            client.responses.calls[1]["input"][1]["content"],
        )

    def test_rate_limit_and_5xx_retry_once_then_return_stable_codes(self):
        cases = (
            (RateLimitError("private"), "LLM_RATE_LIMIT"),
            (APIStatusError(503), "LLM_SERVER_ERROR"),
        )
        for error, code in cases:
            with self.subTest(code=code):
                client = _FakeClient([error, error])
                result = OpenAIContentClassifier(client=client).classify(
                    _request(), LLM_PRIMARY_MODEL
                )
                self.assertEqual(result.status, "unresolved")
                self.assertEqual(result.unresolved_code, code)
                self.assertEqual(result.attempt_count, 2)
                self.assertEqual(len(client.responses.calls), 2)
                self.assertFalse(hasattr(result, "response_body"))
                self.assertFalse(hasattr(result, "error_message"))

    def test_nonretryable_4xx_is_not_retried(self):
        client = _FakeClient([APIStatusError(400), _completed()])
        result = OpenAIContentClassifier(client=client).classify(
            _request(), LLM_PRIMARY_MODEL
        )
        self.assertEqual(result.unresolved_code, "LLM_PROVIDER_ERROR")
        self.assertEqual(result.attempt_count, 1)
        self.assertEqual(len(client.responses.calls), 1)

    def test_process_control_exceptions_are_not_swallowed(self):
        client = _FakeClient([KeyboardInterrupt()])
        with self.assertRaises(KeyboardInterrupt):
            OpenAIContentClassifier(client=client).classify(
                _request(), LLM_PRIMARY_MODEL
            )

    def test_incomplete_refusal_and_schema_failure_retry_once(self):
        cases = (
            (SimpleNamespace(status="incomplete", output_parsed=None), "LLM_INCOMPLETE"),
            (
                SimpleNamespace(status="completed", output_parsed=None, refusal="no"),
                "LLM_REFUSAL",
            ),
            (SimpleNamespace(status="completed", output_parsed={}), "LLM_SCHEMA_FAILURE"),
        )
        for response, code in cases:
            with self.subTest(code=code):
                client = _FakeClient([response, response])
                result = OpenAIContentClassifier(client=client).classify(
                    _request(), LLM_PRIMARY_MODEL
                )
                self.assertEqual(result.status, "unresolved")
                self.assertEqual(result.unresolved_code, code)
                self.assertEqual(result.attempt_count, 2)
                self.assertEqual(len(client.responses.calls), 2)

    def test_insufficient_evidence_response_fails_closed_without_retry(self):
        abstention = _classification(
            direction_code="undetermined",
            material_type_code=None,
            direction_confidence=0.0,
            material_type_confidence=0.0,
            evidence=(),
            insufficient_evidence=True,
        )
        client = _FakeClient([_completed(abstention)])
        result = OpenAIContentClassifier(client=client).classify(
            _request(), LLM_PRIMARY_MODEL
        )
        self.assertEqual(result.status, "unresolved")
        self.assertEqual(result.unresolved_code, "LLM_INSUFFICIENT_EVIDENCE")
        self.assertEqual(result.attempt_count, 1)


class RoutingTests(unittest.TestCase):
    def setUp(self):
        self.deterministic = _request().deterministic_proposal

    def test_high_confidence_agreement_does_not_invoke_verifier(self):
        calls = []
        result = route_llm(
            self.deterministic,
            _attempt(_classification()),
            lambda: calls.append(True),
        )
        self.assertEqual(result.status, "llm_primary")
        self.assertEqual(calls, [])

    def test_each_ambiguity_condition_invokes_sol(self):
        values = (
            _classification(direction_confidence=0.84),
            _classification(alternative_direction_codes=("gastroenterology",)),
            _classification(direction_code="gastroenterology"),
            _classification(requires_medical_review=True),
        )
        for primary_value in values:
            with self.subTest(primary_value=primary_value):
                calls = []

                def verifier():
                    calls.append(LLM_VERIFIER_MODEL)
                    verifier_value = _classification(
                        direction_code=primary_value.direction_code,
                        material_type_code=primary_value.material_type_code,
                        alternative_direction_codes=(),
                    )
                    return _attempt(
                        verifier_value, model=LLM_VERIFIER_MODEL
                    )

                result = route_llm(
                    self.deterministic, _attempt(primary_value), verifier
                )
                self.assertEqual(calls, [LLM_VERIFIER_MODEL])
                self.assertEqual(result.status, "llm_verified")

    def test_high_confidence_sol_agreement_verifies(self):
        primary_value = _classification(direction_confidence=0.8)
        verifier_value = _classification()
        result = route_llm(
            self.deterministic,
            _attempt(primary_value),
            lambda: _attempt(verifier_value, model=LLM_VERIFIER_MODEL),
        )
        self.assertEqual(result.status, "llm_verified")
        self.assertEqual(result.classification, verifier_value)
        self.assertIsNone(result.conflict_code)

    def test_sol_disagreement_is_a_stable_conflict(self):
        primary_value = _classification(direction_confidence=0.8)
        verifier_value = _classification(direction_code="gastroenterology")
        result = route_llm(
            self.deterministic,
            _attempt(primary_value),
            lambda: _attempt(verifier_value, model=LLM_VERIFIER_MODEL),
        )
        self.assertEqual(result.status, "conflict")
        self.assertEqual(result.conflict_code, "LLM_DISAGREEMENT")
        self.assertIsNone(result.classification)

    def test_low_confidence_or_unresolved_sol_fails_closed(self):
        cases = (
            _attempt(
                _classification(material_type_confidence=0.84),
                model=LLM_VERIFIER_MODEL,
            ),
            _attempt(
                status="unresolved",
                code="LLM_TIMEOUT",
                model=LLM_VERIFIER_MODEL,
            ),
        )
        for verifier in cases:
            with self.subTest(verifier=verifier):
                result = route_llm(
                    self.deterministic,
                    _attempt(_classification(direction_confidence=0.8)),
                    lambda: verifier,
                )
                self.assertEqual(result.status, "unresolved")
                self.assertIsNone(result.classification)

    def test_primary_abstention_does_not_invoke_verifier(self):
        calls = []
        result = route_llm(
            self.deterministic,
            _attempt(status="unresolved", code="LLM_INSUFFICIENT_EVIDENCE"),
            lambda: calls.append(True),
        )
        self.assertEqual(result.status, "unresolved")
        self.assertEqual(result.unresolved_code, "LLM_INSUFFICIENT_EVIDENCE")
        self.assertEqual(calls, [])

    def test_routing_rejects_swapped_model_roles(self):
        calls = []
        primary = _attempt(_classification(), model=LLM_VERIFIER_MODEL)
        result = route_llm(self.deterministic, primary, lambda: calls.append(True))
        self.assertEqual(result.status, "unresolved")
        self.assertEqual(result.unresolved_code, "LLM_PRIMARY_MODEL_INVALID")
        self.assertEqual(calls, [])

        result = route_llm(
            self.deterministic,
            _attempt(_classification(direction_confidence=0.8)),
            lambda: _attempt(_classification(), model=LLM_PRIMARY_MODEL),
        )
        self.assertEqual(result.status, "unresolved")
        self.assertEqual(result.unresolved_code, "LLM_VERIFIER_MODEL_INVALID")


if __name__ == "__main__":
    unittest.main()
