"""Offline contracts for the Abbott OpenAI classification adapter."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
import unittest

from openai import OpenAI
from pydantic import BaseModel

from agents.abbott_page_classifier.domain import (
    ACCESS_LABELS,
    DIRECTION_LABELS,
    LIFECYCLE_LABELS,
    MATERIAL_TYPE_LABELS,
    Proposal,
)
from agents.abbott_page_classifier.llm_classifier import (
    LLM_PRIMARY_MODEL,
    LLM_VERIFIER_MODEL,
    LlmAttempt,
    LlmClassification,
    LlmRequest,
    TAXONOMY_DEFINITIONS_V1,
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
    max_retries = 0

    def __init__(self, outcomes):
        self.responses = _FakeResponses(outcomes)


class APITimeoutError(Exception):
    pass


class RateLimitError(Exception):
    status_code = 429


class QuotaRateLimitError(Exception):
    status_code = 429
    code = "insufficient_quota"


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
                "material_type_hint": "articles",
            },
        ),
        "deterministic_direction_evidence": ("path:cardio",),
        "deterministic_material_type_evidence": ("path:articles",),
    }
    values.update(overrides)
    return LlmRequest(**values)


def _attempt(
    value=None,
    *,
    status="success",
    code=None,
    model=LLM_PRIMARY_MODEL,
    requested_fields=("direction_code", "material_type_code"),
):
    return LlmAttempt(
        status=status,
        model=model,
        classification=value,
        unresolved_code=code,
        attempt_count=1,
        requested_fields=requested_fields,
    )


class StructuredOutputTests(unittest.TestCase):
    def test_classifier_is_always_a_real_pydantic_model(self):
        self.assertTrue(issubclass(LlmClassification, BaseModel))
        source = Path(
            "agents/abbott_page_classifier/llm_classifier.py"
        ).read_text(encoding="utf-8")
        self.assertNotIn("except ModuleNotFoundError", source)
        self.assertNotIn("OPENAI_API_KEY", source)

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
        with self.assertRaises(ValueError):
            _classification(evidence=())

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
                "taxonomy",
                "title",
                "requested_fields",
            },
        )
        self.assertEqual(len(material["content_excerpt"]), 12_000)
        self.assertEqual(
            material["deterministic_evidence"], ["path:cardio", "path:articles"]
        )
        self.assertEqual(material["taxonomy_version"], "abbott-v1")
        self.assertEqual(material["approved_examples"][0]["title"], "Пример")
        self.assertEqual(
            material["requested_fields"], ["direction_code", "material_type_code"]
        )
        taxonomy = material["taxonomy"]
        self.assertEqual(taxonomy["version"], "abbott-v1")
        self.assertEqual(taxonomy["definitions"], TAXONOMY_DEFINITIONS_V1)
        self.assertEqual(
            taxonomy["direction_terms"],
            [{"code": code, "label": label} for code, label in DIRECTION_LABELS.items()],
        )
        self.assertEqual(
            taxonomy["material_type_terms"],
            [
                {"code": code, "label": label}
                for code, label in MATERIAL_TYPE_LABELS.items()
            ],
        )
        self.assertEqual(
            taxonomy["access_terms"],
            [{"code": code, "label": label} for code, label in ACCESS_LABELS.items()],
        )
        self.assertEqual(
            taxonomy["lifecycle_terms"],
            [
                {"code": code, "label": label}
                for code, label in LIFECYCLE_LABELS.items()
            ],
        )

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
            _request(direction_locked=True, material_type_locked=True),
            LLM_PRIMARY_MODEL,
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
            "Bearer secret-value-123456",
            "sk-secretvalue123456",
            "oauth access_token",
            "person%40example.com",
            "person&#64;example.com",
            "8 (999) 123-45-67",
            "RaW-UsEr-Id=42",
            "raw%55ser%49d=42",
            "raw&#95;user&#95;id=42",
            r"\u0072awUserId=42",
            "ＲＡＷ＿ＵＳＥＲ＿ＩＤ=42",
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

    def test_sensitive_url_query_is_rejected_before_client_construction(self):
        factory_calls = []

        def factory(**kwargs):
            factory_calls.append(kwargs)
            return _FakeClient([_completed()])

        result = OpenAIContentClassifier(client_factory=factory).classify(
            _request(
                normalized_url="https://abbottpro.ru/cardio?auth=secret",
                normalized_path="/cardio",
            ),
            LLM_PRIMARY_MODEL,
        )
        self.assertEqual(result.unresolved_code, "LLM_INPUT_REJECTED")
        self.assertEqual(factory_calls, [])

    def test_deeply_encoded_international_private_data_never_constructs_client(self):
        too_deep = "%40"
        for _ in range(20):
            too_deep = too_deep.replace("%", "%25")
        cases = (
            "person%25252540example.com",
            "+43/664/1234567",
            "имя@пример.рф",
            "+43\u00a0664\u202f123\u20094567",
            "raw%2525252555ser%2525252549d=42",
            too_deep,
        )
        for value in cases:
            with self.subTest(value=value):
                factory_calls = []

                def factory(**kwargs):
                    factory_calls.append(kwargs)
                    return _FakeClient([_completed()])

                result = OpenAIContentClassifier(client_factory=factory).classify(
                    _request(content_excerpt=value), LLM_PRIMARY_MODEL
                )
                self.assertEqual(result.unresolved_code, "LLM_INPUT_REJECTED")
                self.assertEqual(result.attempt_count, 0)
                self.assertEqual(factory_calls, [])

    def test_sensitive_nested_example_key_is_rejected(self):
        client = _FakeClient([_completed()])
        request = _request(approved_examples=({"email": "hidden"},))
        result = OpenAIContentClassifier(client=client).classify(
            request, LLM_PRIMARY_MODEL
        )
        self.assertEqual(result.unresolved_code, "LLM_INPUT_REJECTED")
        self.assertEqual(client.responses.calls, [])

    def test_sensitive_nested_example_values_are_canonically_decoded(self):
        cases = (
            {"title": "person%40example.com"},
            {"title": "8 (999) 123-45-67"},
            {"title": "OAUTH&#95;TOKEN=secret"},
            {"rawUserId": "42"},
            {"RAW%5FUSER%5FID": "42"},
        )
        for example in cases:
            with self.subTest(example=example):
                client = _FakeClient([_completed()])
                result = OpenAIContentClassifier(client=client).classify(
                    _request(approved_examples=(example,)), LLM_PRIMARY_MODEL
                )
                self.assertEqual(result.unresolved_code, "LLM_INPUT_REJECTED")
                self.assertEqual(client.responses.calls, [])

    def test_approved_examples_are_bounded(self):
        examples = tuple({"title": str(index)} for index in range(9))
        client = _FakeClient([_completed()])
        result = OpenAIContentClassifier(client=client).classify(
            _request(approved_examples=examples), LLM_PRIMARY_MODEL
        )
        self.assertEqual(result.unresolved_code, "LLM_INPUT_REJECTED")
        self.assertEqual(client.responses.calls, [])

    def test_approved_example_field_shapes_are_closed(self):
        cases = (
            {"title": {"safe": "value"}},
            {"breadcrumbs": "not-an-array"},
            {"evidence": ["x"] * 6},
            {"content_excerpt": "x" * 2_001},
            {"material_type_hint": {"code": "articles"}},
            {"material_type_hint": "archive"},
            {"material_type_hint": "articles" * 100},
        )
        for example in cases:
            with self.subTest(example=example):
                client = _FakeClient([_completed()])
                result = OpenAIContentClassifier(client=client).classify(
                    _request(approved_examples=(example,)), LLM_PRIMARY_MODEL
                )
                self.assertEqual(result.unresolved_code, "LLM_INPUT_REJECTED")
                self.assertEqual(client.responses.calls, [])

    def test_deterministic_proposal_rule_and_evidence_are_bounded(self):
        proposals = (
            Proposal(None, None, None, None, "", 0.8),
            Proposal(None, None, None, None, "x" * 129, 0.8),
            Proposal(None, None, None, None, {"nested": "rule"}, 0.8),
            Proposal(None, None, None, None, "rule", 0.8, ("x",) * 21),
            Proposal(None, None, None, None, "rule", 0.8, ("x" * 501,)),
            Proposal(None, None, None, None, "rule", 0.8, (42,)),
        )
        for proposal in proposals:
            with self.subTest(proposal=proposal):
                client = _FakeClient([_completed()])
                result = OpenAIContentClassifier(client=client).classify(
                    _request(deterministic_proposal=proposal), LLM_PRIMARY_MODEL
                )
                self.assertEqual(result.unresolved_code, "LLM_INPUT_REJECTED")
                self.assertEqual(client.responses.calls, [])

    def test_total_serialized_input_is_hard_capped_below_200kb(self):
        factory_calls = []

        def factory(**kwargs):
            factory_calls.append(kwargs)
            return _FakeClient([_completed()])

        result = OpenAIContentClassifier(client_factory=factory).classify(
            _request(
                content_excerpt="🙂" * 12_000,
                breadcrumbs=("🙂" * 500,) * 20,
                deterministic_direction_evidence=("🙂" * 500,) * 20,
                deterministic_material_type_evidence=("🙂" * 500,) * 20,
                approved_examples=tuple(
                    {"content_excerpt": "🙂" * 2_000} for _ in range(8)
                ),
            ),
            LLM_PRIMARY_MODEL,
        )
        self.assertEqual(result.unresolved_code, "LLM_INPUT_REJECTED")
        self.assertEqual(factory_calls, [])

    def test_partial_lock_requests_only_the_missing_field(self):
        value = _classification(direction_code=None, direction_confidence=None)
        client = _FakeClient([_completed(value)])
        result = OpenAIContentClassifier(client=client).classify(
            _request(direction_locked=True), LLM_PRIMARY_MODEL
        )
        self.assertEqual(result.status, "success")
        self.assertEqual(result.requested_fields, ("material_type_code",))
        material = json.loads(client.responses.calls[0]["input"][1]["content"])
        self.assertEqual(material["requested_fields"], ["material_type_code"])
        self.assertNotIn("direction_code", material["deterministic_proposal"])
        self.assertEqual(
            material["deterministic_evidence"], ["path:articles"]
        )
        self.assertIsNone(result.classification.direction_code)

    def test_material_lock_removes_the_locked_hint_and_only_requests_direction(self):
        value = _classification(
            material_type_code=None, material_type_confidence=None
        )
        client = _FakeClient([_completed(value)])
        result = OpenAIContentClassifier(client=client).classify(
            _request(material_type_locked=True), LLM_PRIMARY_MODEL
        )
        self.assertEqual(result.status, "success")
        self.assertEqual(result.requested_fields, ("direction_code",))
        material = json.loads(client.responses.calls[0]["input"][1]["content"])
        self.assertEqual(material["requested_fields"], ["direction_code"])
        self.assertNotIn("material_type_code", material["deterministic_proposal"])
        self.assertEqual(material["deterministic_evidence"], ["path:cardio"])
        self.assertIsNone(material["material_type_hint"])
        self.assertIsNone(result.classification.material_type_code)

    def test_returning_a_locked_field_is_schema_failure_and_never_used(self):
        client = _FakeClient([_completed(), _completed()])
        result = OpenAIContentClassifier(client=client).classify(
            _request(direction_locked=True), LLM_PRIMARY_MODEL
        )
        self.assertEqual(result.status, "unresolved")
        self.assertEqual(result.unresolved_code, "LLM_SCHEMA_FAILURE")
        self.assertIsNone(result.classification)
        self.assertEqual(result.attempt_count, 2)

    def test_free_form_input_taxonomy_is_rejected_before_call(self):
        cases = (
            {"taxonomy_version": ""},
            {"taxonomy_version": None},
            {"taxonomy_version": "v" * 129},
            {"title": "x" * 1_001},
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

    def test_generic_connection_failure_is_not_retried(self):
        client = _FakeClient([ConnectionError("private"), _completed()])
        result = OpenAIContentClassifier(client=client).classify(
            _request(), LLM_PRIMARY_MODEL
        )
        self.assertEqual(result.unresolved_code, "LLM_PROVIDER_ERROR")
        self.assertEqual(result.attempt_count, 1)
        self.assertEqual(len(client.responses.calls), 1)

    def test_rate_limit_and_5xx_retry_once_then_return_stable_codes(self):
        cases = (
            (RateLimitError("private"), "LLM_RATE_LIMIT"),
            (APIStatusError(408), "LLM_REQUEST_TIMEOUT"),
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

    def test_quota_429_is_not_treated_as_a_retryable_rate_limit(self):
        client = _FakeClient([QuotaRateLimitError("private"), _completed()])
        result = OpenAIContentClassifier(client=client).classify(
            _request(), LLM_PRIMARY_MODEL
        )
        self.assertEqual(result.unresolved_code, "LLM_QUOTA_ERROR")
        self.assertEqual(result.attempt_count, 1)
        self.assertEqual(len(client.responses.calls), 1)

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

    def test_other_noncompleted_statuses_are_distinct_and_not_retried(self):
        cases = (
            ("failed", "LLM_RESPONSE_FAILED"),
            ("cancelled", "LLM_RESPONSE_CANCELLED"),
            ("queued", "LLM_RESPONSE_NOT_COMPLETED"),
            (None, "LLM_RESPONSE_STATUS_INVALID"),
        )
        for status, code in cases:
            with self.subTest(status=status):
                client = _FakeClient(
                    [SimpleNamespace(status=status, output_parsed=None), _completed()]
                )
                result = OpenAIContentClassifier(client=client).classify(
                    _request(), LLM_PRIMARY_MODEL
                )
                self.assertEqual(result.unresolved_code, code)
                self.assertEqual(result.attempt_count, 1)
                self.assertEqual(len(client.responses.calls), 1)

    def test_internal_sdk_client_has_retries_disabled(self):
        client = _FakeClient([_completed()])
        calls = []

        def factory(**kwargs):
            calls.append(kwargs)
            return client

        result = OpenAIContentClassifier(client_factory=factory).classify(
            _request(), LLM_PRIMARY_MODEL
        )
        self.assertEqual(result.status, "success")
        self.assertEqual(calls, [{"max_retries": 0}])

    def test_injected_real_sdk_client_is_normalized_to_zero_internal_retries(self):
        sdk_client = OpenAI(api_key="unit-test-placeholder", max_retries=2)
        classifier = OpenAIContentClassifier(client=sdk_client)
        self.assertEqual(classifier._client.max_retries, 0)
        result = classifier.classify(
            _request(content_excerpt="person%40example.com"), LLM_PRIMARY_MODEL
        )
        self.assertEqual(result.unresolved_code, "LLM_INPUT_REJECTED")
        self.assertEqual(result.attempt_count, 0)

    def test_uncontracted_injected_fake_is_rejected(self):
        unsafe = SimpleNamespace(
            max_retries=2,
            responses=SimpleNamespace(parse=lambda **kwargs: _completed()),
        )
        with self.assertRaises(ValueError):
            OpenAIContentClassifier(client=unsafe)

    def test_sanitized_usage_and_elapsed_time_are_recorded(self):
        first = SimpleNamespace(
            status="incomplete",
            output_parsed=None,
            usage=SimpleNamespace(
                input_tokens=11,
                output_tokens=2,
                total_tokens=13,
                input_tokens_details=SimpleNamespace(cached_tokens=3),
            ),
        )
        second = _completed()
        second.usage = SimpleNamespace(
            input_tokens=7,
            output_tokens=5,
            total_tokens=12,
            input_tokens_details=SimpleNamespace(cached_tokens=1),
        )
        ticks = iter((100.0, 100.125))
        client = _FakeClient([first, second])
        result = OpenAIContentClassifier(
            client=client, monotonic=lambda: next(ticks)
        ).classify(_request(), LLM_PRIMARY_MODEL)
        self.assertEqual(result.elapsed_ms, 125)
        self.assertEqual(result.usage.input_tokens, 18)
        self.assertEqual(result.usage.output_tokens, 7)
        self.assertEqual(result.usage.total_tokens, 25)
        self.assertEqual(result.usage.cached_input_tokens, 4)
        self.assertFalse(hasattr(result.usage, "raw_response"))

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

    def test_sol_ambiguity_medical_review_or_abstention_never_verifies(self):
        cases = (
            (
                _attempt(
                    _classification(
                        alternative_direction_codes=("gastroenterology",)
                    ),
                    model=LLM_VERIFIER_MODEL,
                ),
                "LLM_VERIFIER_AMBIGUOUS",
            ),
            (
                _attempt(
                    _classification(requires_medical_review=True),
                    model=LLM_VERIFIER_MODEL,
                ),
                "LLM_VERIFIER_MEDICAL_REVIEW",
            ),
            (
                _attempt(
                    _classification(
                        direction_code="undetermined",
                        material_type_code=None,
                        direction_confidence=0.0,
                        material_type_confidence=0.0,
                        evidence=(),
                        insufficient_evidence=True,
                    ),
                    model=LLM_VERIFIER_MODEL,
                ),
                "LLM_INSUFFICIENT_EVIDENCE",
            ),
        )
        for verifier, code in cases:
            with self.subTest(code=code):
                result = route_llm(
                    self.deterministic,
                    _attempt(_classification(direction_confidence=0.8)),
                    lambda: verifier,
                )
                self.assertEqual(result.status, "unresolved")
                self.assertEqual(result.unresolved_code, code)
                self.assertIsNone(result.classification)

    def test_locked_direction_is_ignored_by_primary_and_verifier_routing(self):
        primary_value = _classification(
            direction_code=None,
            direction_confidence=None,
            material_type_confidence=0.80,
        )
        verifier_value = _classification(
            direction_code=None,
            direction_confidence=None,
        )
        primary = _attempt(
            primary_value, requested_fields=("material_type_code",)
        )
        verifier = _attempt(
            verifier_value,
            model=LLM_VERIFIER_MODEL,
            requested_fields=("material_type_code",),
        )
        deterministic = Proposal(
            direction_code="gastroenterology",
            material_type_code="articles",
            access_code=None,
            lifecycle_code=None,
            rule_code="locked_direction",
            confidence=0.9,
        )
        result = route_llm(deterministic, primary, lambda: verifier)
        self.assertEqual(result.status, "llm_verified")
        self.assertIsNone(result.classification.direction_code)
        self.assertIsNone(result.proposal.direction_code)

    def test_route_rejects_a_locked_field_return_from_either_model(self):
        primary = _attempt(
            _classification(), requested_fields=("material_type_code",)
        )
        calls = []
        result = route_llm(
            self.deterministic, primary, lambda: calls.append(True)
        )
        self.assertEqual(result.status, "unresolved")
        self.assertEqual(result.unresolved_code, "LLM_LOCKED_FIELD_RETURNED")
        self.assertEqual(calls, [])

        partial_primary = _attempt(
            _classification(
                direction_code=None,
                direction_confidence=None,
                material_type_confidence=0.8,
            ),
            requested_fields=("material_type_code",),
        )
        bad_verifier = _attempt(
            _classification(),
            model=LLM_VERIFIER_MODEL,
            requested_fields=("material_type_code",),
        )
        result = route_llm(
            self.deterministic, partial_primary, lambda: bad_verifier
        )
        self.assertEqual(result.status, "unresolved")
        self.assertEqual(result.unresolved_code, "LLM_LOCKED_FIELD_RETURNED")

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
