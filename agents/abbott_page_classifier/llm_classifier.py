"""Minimized OpenAI Structured Outputs adapter for Abbott material proposals.

The module deliberately accepts an injected client so unit tests and workflow dry
runs never need credentials or network access.  It stores only validated structured
results and stable status codes; raw provider responses and exception text are not
part of any returned contract.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
import re
from types import MappingProxyType
from typing import Annotated, Any, Callable, Literal, Mapping, Sequence

from .domain import (
    ACCESS_CODES,
    DIRECTION_CODES,
    LIFECYCLE_CODES,
    MATERIAL_TYPE_CODES,
    ConflictCode,
    Proposal,
)


LLM_PRIMARY_MODEL = "gpt-5.6-terra"
LLM_VERIFIER_MODEL = "gpt-5.6-sol"
LLM_CONFIDENCE_THRESHOLD = 0.85
MAX_CONTENT_EXCERPT_CHARS = 12_000
MAX_EVIDENCE_ITEMS = 5
MAX_EVIDENCE_CHARS = 240

SYSTEM_PROMPT_V1 = """Classify one Abbott professional-medical portal material.
Use only the supplied material JSON and the allowed taxonomy codes represented by
the response schema. Return concise source-grounded evidence, not hidden reasoning.
When the supplied evidence cannot support both classifications, abstain using the
schema's insufficient-evidence contract. Do not call tools or infer audience data.
"""


DirectionCode = Literal[
    "gastroenterology",
    "cardiology",
    "neurology_psychiatry",
    "womens_health",
    "respiratory_health",
    "diabetes_management",
    "pharmacists",
    "dermatology",
    "not_applicable",
    "undetermined",
]

MaterialTypeCode = Literal[
    "articles",
    "video",
    "tables",
    "clinical_guidelines",
    "calculators",
    "clinical_cases",
    "educational_brochures",
    "products",
    "pharmacist_assistant",
    "podcasts",
    "personal_effectiveness",
    "knowledge_check",
    "pharmacy_consulting_algorithms",
    "child_nutrition",
    "devices",
    "respiratory_assistant",
    "clinical_decision_support",
    "events",
    "general_materials",
    "section",
    "subsection",
    "special_project",
]


def _validate_classification_values(value: Any) -> None:
    """Apply semantic rules that JSON-schema field constraints cannot express."""

    if value.direction_code not in DIRECTION_CODES:
        raise ValueError("invalid direction code")
    if value.material_type_code is not None and value.material_type_code not in MATERIAL_TYPE_CODES:
        raise ValueError("invalid material type code")
    for confidence in (value.direction_confidence, value.material_type_confidence):
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
            raise ValueError("confidence must be numeric")
        if not 0 <= confidence <= 1:
            raise ValueError("confidence must be between zero and one")
    alternatives = tuple(value.alternative_direction_codes)
    if isinstance(value.alternative_direction_codes, (str, bytes)):
        raise ValueError("alternative directions must be an array")
    if len(alternatives) > 4 or len(set(alternatives)) != len(alternatives):
        raise ValueError("alternative direction codes must be short and unique")
    if any(code not in DIRECTION_CODES for code in alternatives):
        raise ValueError("invalid alternative direction code")
    if value.direction_code in alternatives:
        raise ValueError("the selected direction cannot also be an alternative")
    evidence = tuple(value.evidence)
    if isinstance(value.evidence, (str, bytes)):
        raise ValueError("evidence must be an array")
    if len(evidence) > MAX_EVIDENCE_ITEMS:
        raise ValueError("too many evidence signals")
    if any(not signal.strip() or len(signal) > MAX_EVIDENCE_CHARS for signal in evidence):
        raise ValueError("evidence signals must be nonempty and short")
    if value.insufficient_evidence:
        if (
            value.direction_code != "undetermined"
            or value.material_type_code is not None
            or value.direction_confidence != 0
            or value.material_type_confidence != 0
            or alternatives
            or evidence
        ):
            raise ValueError("insufficient evidence must be a complete abstention")
    elif value.direction_code == "undetermined" or value.material_type_code is None:
        raise ValueError("an unresolved classification must explicitly abstain")
    if not isinstance(value.requires_medical_review, bool) or not isinstance(
        value.insufficient_evidence, bool
    ):
        raise ValueError("review and abstention flags must be boolean")


try:  # The deployment dependency is bounded in requirements.txt.
    from pydantic import BaseModel, ConfigDict, Field, model_validator
except ModuleNotFoundError:  # pragma: no cover - exercised only by the offline dev image.
    BaseModel = None  # type: ignore[assignment,misc]


if BaseModel is not None:

    EvidenceSignal = Annotated[
        str, Field(min_length=1, max_length=MAX_EVIDENCE_CHARS)
    ]

    class LlmClassification(BaseModel):
        """Closed Pydantic schema passed directly to ``responses.parse``."""

        model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

        direction_code: DirectionCode
        material_type_code: MaterialTypeCode | None
        direction_confidence: float = Field(ge=0, le=1)
        material_type_confidence: float = Field(ge=0, le=1)
        alternative_direction_codes: tuple[DirectionCode, ...] = Field(max_length=4)
        evidence: tuple[EvidenceSignal, ...] = Field(max_length=MAX_EVIDENCE_ITEMS)
        requires_medical_review: bool
        insufficient_evidence: bool

        @model_validator(mode="after")
        def _validate_abstention(self) -> "LlmClassification":
            _validate_classification_values(self)
            return self

else:

    @dataclass(frozen=True)
    class LlmClassification:  # type: ignore[no-redef]
        """Offline-only equivalent used when dependencies have not been installed.

        A deployed workflow always uses the Pydantic definition above. Keeping the
        same closed constructor here permits fake-client unit tests in a networkless
        checkout before dependency installation.
        """

        direction_code: DirectionCode
        material_type_code: MaterialTypeCode | None
        direction_confidence: float
        material_type_confidence: float
        alternative_direction_codes: tuple[DirectionCode, ...]
        evidence: tuple[str, ...]
        requires_medical_review: bool
        insufficient_evidence: bool

        def __post_init__(self) -> None:
            object.__setattr__(
                self, "alternative_direction_codes", tuple(self.alternative_direction_codes)
            )
            object.__setattr__(self, "evidence", tuple(self.evidence))
            _validate_classification_values(self)


_APPROVED_EXAMPLE_FIELDS = frozenset(
    {
        "access_code",
        "breadcrumbs",
        "content_excerpt",
        "direction_code",
        "evidence",
        "h1",
        "material_type_code",
        "material_type_hint",
        "meta_description",
        "normalized_path",
        "normalized_url",
        "title",
    }
)


def _freeze_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({str(key): _freeze_json(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_json(item) for item in value)
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError("approved examples must contain JSON values only")


@dataclass(frozen=True)
class LlmRequest:
    """One immutable, content-only logical classification input."""

    title: str
    normalized_url: str
    normalized_path: str
    taxonomy_version: str
    breadcrumbs: tuple[str, ...] = ()
    h1: str = ""
    meta_description: str = ""
    content_excerpt: str = ""
    access_code: str | None = None
    material_type_hint: str | None = None
    deterministic_proposal: Proposal | None = None
    deterministic_evidence: tuple[str, ...] = ()
    approved_examples: tuple[Mapping[str, Any], ...] = ()
    classification_locked: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "breadcrumbs", tuple(self.breadcrumbs))
        object.__setattr__(self, "deterministic_evidence", tuple(self.deterministic_evidence))
        object.__setattr__(
            self,
            "approved_examples",
            tuple(_freeze_json(example) for example in self.approved_examples),
        )


@dataclass(frozen=True)
class LlmAttempt:
    status: Literal["success", "unresolved", "locked"]
    model: str
    classification: LlmClassification | None = None
    unresolved_code: str | None = None
    attempt_count: int = 0
    input_hash: str | None = None


@dataclass(frozen=True)
class LlmRouteResult:
    status: Literal["locked", "llm_primary", "llm_verified", "conflict", "unresolved"]
    primary: LlmAttempt
    verifier: LlmAttempt | None = None
    classification: LlmClassification | None = None
    proposal: Proposal | None = None
    conflict_code: str | None = None
    unresolved_code: str | None = None


class _AttemptFailure(Exception):
    def __init__(self, code: str, retryable: bool) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


# Explicit deny-list. These names are never fields in request construction.
_DENIED_FIELD_NAMES = frozenset(
    {
        "raw_user_id",
        "user_id",
        "visit_id",
        "client_id",
        "user_behavior",
        "email",
        "email_address",
        "phone",
        "phone_number",
        "oauth",
        "oauth_token",
        "access_token",
        "refresh_token",
        "METRIKA_TOKEN",
        "token",
        "api_key",
        "authorization",
    }
)
_DENIED_NORMALIZED_FIELD_NAMES = frozenset(
    item.casefold() for item in _DENIED_FIELD_NAMES
)
_DENIED_TEXT_MARKERS = tuple(_DENIED_NORMALIZED_FIELD_NAMES)
_EMAIL_PATTERN = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}(?![\w.-])")
_PHONE_PATTERN = re.compile(r"(?<!\w)\+\d(?:[\s().-]*\d){9,14}(?!\w)")
_BEARER_PATTERN = re.compile(r"\bauthorization\s*:\s*bearer\b", re.IGNORECASE)


def _plain_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _plain_json(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_plain_json(item) for item in value]
    return value


def _contains_denied_data(value: Any, *, key: str | None = None) -> bool:
    if key is not None:
        normalized_key = re.sub(r"[^a-z0-9]+", "_", key.casefold()).strip("_")
        if normalized_key in _DENIED_NORMALIZED_FIELD_NAMES or normalized_key.endswith("_token"):
            return True
    if isinstance(value, Mapping):
        return any(_contains_denied_data(item, key=str(item_key)) for item_key, item in value.items())
    if isinstance(value, (list, tuple)):
        return any(_contains_denied_data(item) for item in value)
    if not isinstance(value, str):
        return False
    folded = value.casefold()
    return (
        any(marker in folded for marker in _DENIED_TEXT_MARKERS)
        or _EMAIL_PATTERN.search(value) is not None
        or _PHONE_PATTERN.search(value) is not None
        or _BEARER_PATTERN.search(value) is not None
    )


def _proposal_json(value: Proposal | None) -> Mapping[str, Any] | None:
    if value is None:
        return None
    return {
        "access_code": value.access_code,
        "confidence": value.confidence,
        "direction_code": value.direction_code,
        "lifecycle_code": value.lifecycle_code,
        "material_type_code": value.material_type_code,
        "rule_code": value.rule_code,
    }


def _valid_optional(value: str | None, allowed: Sequence[str]) -> bool:
    return value is None or value in allowed


def _validate_request_taxonomy(request: LlmRequest, examples: Sequence[Mapping[str, Any]]) -> None:
    if not request.taxonomy_version.strip():
        raise ValueError("taxonomy version is required")
    if not _valid_optional(request.access_code, ACCESS_CODES):
        raise ValueError("invalid access code")
    if not _valid_optional(request.material_type_hint, MATERIAL_TYPE_CODES):
        raise ValueError("invalid material type hint")
    deterministic = request.deterministic_proposal
    if deterministic is not None and not (
        _valid_optional(deterministic.direction_code, DIRECTION_CODES)
        and _valid_optional(deterministic.material_type_code, MATERIAL_TYPE_CODES)
        and _valid_optional(deterministic.access_code, ACCESS_CODES)
        and _valid_optional(deterministic.lifecycle_code, LIFECYCLE_CODES)
    ):
        raise ValueError("invalid deterministic taxonomy code")
    for example in examples:
        if not _valid_optional(example.get("direction_code"), DIRECTION_CODES):
            raise ValueError("invalid example direction code")
        if not _valid_optional(example.get("material_type_code"), MATERIAL_TYPE_CODES):
            raise ValueError("invalid example material type code")
        if not _valid_optional(example.get("access_code"), ACCESS_CODES):
            raise ValueError("invalid example access code")


def _serialize_request(request: LlmRequest) -> tuple[str, str]:
    examples: list[dict[str, Any]] = []
    for immutable_example in request.approved_examples:
        example = _plain_json(immutable_example)
        if set(example) - _APPROVED_EXAMPLE_FIELDS:
            raise ValueError("unapproved example field")
        examples.append(example)
    _validate_request_taxonomy(request, examples)

    deterministic_evidence = request.deterministic_evidence
    if not deterministic_evidence and request.deterministic_proposal is not None:
        deterministic_evidence = request.deterministic_proposal.evidence
    payload = {
        "access_code": request.access_code,
        "approved_examples": examples,
        "breadcrumbs": list(request.breadcrumbs),
        "content_excerpt": request.content_excerpt[:MAX_CONTENT_EXCERPT_CHARS],
        "deterministic_evidence": list(deterministic_evidence),
        "deterministic_proposal": _proposal_json(request.deterministic_proposal),
        "h1": request.h1,
        "material_type_hint": request.material_type_hint,
        "meta_description": request.meta_description,
        "normalized_path": request.normalized_path,
        "normalized_url": request.normalized_url,
        "taxonomy_version": request.taxonomy_version,
        "title": request.title,
    }
    if _contains_denied_data(payload):
        raise ValueError("input contains denied data")
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return serialized, hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _response_has_refusal(response: Any) -> bool:
    if getattr(response, "refusal", None):
        return True
    for output_item in getattr(response, "output", ()) or ():
        if getattr(output_item, "type", None) == "refusal":
            return True
        for content_item in getattr(output_item, "content", ()) or ():
            if getattr(content_item, "type", None) == "refusal":
                return True
    return False


def _parse_response(response: Any) -> LlmClassification:
    status = getattr(response, "status", None)
    if status == "incomplete":
        raise _AttemptFailure("LLM_INCOMPLETE", True)
    if _response_has_refusal(response):
        raise _AttemptFailure("LLM_REFUSAL", True)
    parsed = getattr(response, "output_parsed", None)
    if not isinstance(parsed, LlmClassification):
        raise _AttemptFailure("LLM_SCHEMA_FAILURE", True)
    try:
        _validate_classification_values(parsed)
    except (TypeError, ValueError):
        raise _AttemptFailure("LLM_SCHEMA_FAILURE", True) from None
    return parsed


def _exception_failure(error: BaseException) -> _AttemptFailure:
    """Classify errors by type/status only; never inspect or retain their text."""

    name = type(error).__name__
    status_code = getattr(error, "status_code", None)
    if isinstance(error, TimeoutError) or name in {"APITimeoutError", "TimeoutException"}:
        return _AttemptFailure("LLM_TIMEOUT", True)
    if status_code == 429 or name == "RateLimitError":
        return _AttemptFailure("LLM_RATE_LIMIT", True)
    if isinstance(status_code, int) and 500 <= status_code <= 599:
        return _AttemptFailure("LLM_SERVER_ERROR", True)
    if name in {"InternalServerError", "ServiceUnavailableError"}:
        return _AttemptFailure("LLM_SERVER_ERROR", True)
    if isinstance(error, ConnectionError) or name in {
        "APIConnectionError",
        "ConnectError",
        "RemoteProtocolError",
    }:
        return _AttemptFailure("LLM_TRANSIENT_ERROR", True)
    if name in {"LengthFinishReasonError"}:
        return _AttemptFailure("LLM_INCOMPLETE", True)
    if name in {"ContentFilterFinishReasonError", "RefusalError"}:
        return _AttemptFailure("LLM_REFUSAL", True)
    if name in {"ValidationError", "SchemaError", "JSONDecodeError"}:
        return _AttemptFailure("LLM_SCHEMA_FAILURE", True)
    return _AttemptFailure("LLM_PROVIDER_ERROR", False)


class OpenAIContentClassifier:
    """Responses API adapter with a single sanitized retry."""

    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    def _client_for_call(self) -> Any:
        if self._client is None:
            from openai import OpenAI

            self._client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        return self._client

    def classify(self, request: LlmRequest, model: str) -> LlmAttempt:
        if request.classification_locked:
            return LlmAttempt(
                status="locked",
                model=model,
                unresolved_code="LLM_LOCKED",
            )
        if model not in {LLM_PRIMARY_MODEL, LLM_VERIFIER_MODEL}:
            return LlmAttempt(
                status="unresolved",
                model=model,
                unresolved_code="LLM_MODEL_NOT_ALLOWED",
            )
        try:
            immutable_json, input_hash = _serialize_request(request)
        except (TypeError, ValueError):
            return LlmAttempt(
                status="unresolved",
                model=model,
                unresolved_code="LLM_INPUT_REJECTED",
            )

        request_arguments = {
            "model": model,
            "input": [
                {"role": "system", "content": SYSTEM_PROMPT_V1},
                {"role": "user", "content": immutable_json},
            ],
            "text_format": LlmClassification,
            "store": False,
            "tools": [],
            "reasoning": {
                "effort": "low" if model == LLM_PRIMARY_MODEL else "medium"
            },
        }
        for attempt_number in (1, 2):
            try:
                response = self._client_for_call().responses.parse(**request_arguments)
                classification = _parse_response(response)
            except _AttemptFailure as failure:
                if failure.retryable and attempt_number == 1:
                    continue
                return LlmAttempt(
                    status="unresolved",
                    model=model,
                    unresolved_code=failure.code,
                    attempt_count=attempt_number,
                    input_hash=input_hash,
                )
            except Exception as error:
                failure = _exception_failure(error)
                if failure.retryable and attempt_number == 1:
                    continue
                return LlmAttempt(
                    status="unresolved",
                    model=model,
                    unresolved_code=failure.code,
                    attempt_count=attempt_number,
                    input_hash=input_hash,
                )
            if classification.insufficient_evidence:
                return LlmAttempt(
                    status="unresolved",
                    model=model,
                    unresolved_code="LLM_INSUFFICIENT_EVIDENCE",
                    attempt_count=attempt_number,
                    input_hash=input_hash,
                )
            return LlmAttempt(
                status="success",
                model=model,
                classification=classification,
                attempt_count=attempt_number,
                input_hash=input_hash,
            )
        raise AssertionError("unreachable retry state")


def _as_proposal(value: LlmClassification, rule_code: str) -> Proposal:
    return Proposal(
        direction_code=value.direction_code,
        material_type_code=value.material_type_code,
        access_code=None,
        lifecycle_code=None,
        rule_code=rule_code,
        confidence=min(value.direction_confidence, value.material_type_confidence),
        evidence=tuple(value.evidence),
    )


def _deterministic_disagreement(
    deterministic: Proposal, classification: LlmClassification
) -> bool:
    return any(
        expected is not None and expected != observed
        for expected, observed in (
            (deterministic.direction_code, classification.direction_code),
            (deterministic.material_type_code, classification.material_type_code),
        )
    )


def _classifications_agree(
    primary: LlmClassification, verifier: LlmClassification
) -> bool:
    return (
        primary.direction_code == verifier.direction_code
        and primary.material_type_code == verifier.material_type_code
    )


def _confidence_at_least(value: LlmClassification, threshold: float) -> bool:
    return (
        value.direction_confidence >= threshold
        and value.material_type_confidence >= threshold
    )


def route_llm(
    deterministic: Proposal,
    primary: LlmAttempt,
    verifier_factory: Callable[[], LlmAttempt],
) -> LlmRouteResult:
    """Apply deterministic Terra-to-Sol routing without invoking locked work."""

    if primary.status == "locked":
        return LlmRouteResult(
            status="locked",
            primary=primary,
            unresolved_code=primary.unresolved_code,
        )
    if primary.model != LLM_PRIMARY_MODEL:
        return LlmRouteResult(
            status="unresolved",
            primary=primary,
            unresolved_code="LLM_PRIMARY_MODEL_INVALID",
        )
    if primary.status != "success" or primary.classification is None:
        return LlmRouteResult(
            status="unresolved",
            primary=primary,
            unresolved_code=primary.unresolved_code or "LLM_PRIMARY_UNRESOLVED",
        )

    primary_value = primary.classification
    needs_verifier = (
        not _confidence_at_least(primary_value, LLM_CONFIDENCE_THRESHOLD)
        or bool(primary_value.alternative_direction_codes)
        or _deterministic_disagreement(deterministic, primary_value)
        or primary_value.requires_medical_review
    )
    if not needs_verifier:
        return LlmRouteResult(
            status="llm_primary",
            primary=primary,
            classification=primary_value,
            proposal=_as_proposal(primary_value, "llm_primary"),
        )

    verifier = verifier_factory()
    if verifier.model != LLM_VERIFIER_MODEL:
        return LlmRouteResult(
            status="unresolved",
            primary=primary,
            verifier=verifier,
            unresolved_code="LLM_VERIFIER_MODEL_INVALID",
        )
    if verifier.status != "success" or verifier.classification is None:
        return LlmRouteResult(
            status="unresolved",
            primary=primary,
            verifier=verifier,
            unresolved_code=verifier.unresolved_code or "LLM_VERIFIER_UNRESOLVED",
        )
    verifier_value = verifier.classification
    if not _classifications_agree(primary_value, verifier_value):
        return LlmRouteResult(
            status="conflict",
            primary=primary,
            verifier=verifier,
            conflict_code=ConflictCode.LLM_DISAGREEMENT.value,
        )
    if not _confidence_at_least(verifier_value, LLM_CONFIDENCE_THRESHOLD):
        return LlmRouteResult(
            status="unresolved",
            primary=primary,
            verifier=verifier,
            unresolved_code="LLM_VERIFIER_LOW_CONFIDENCE",
        )
    return LlmRouteResult(
        status="llm_verified",
        primary=primary,
        verifier=verifier,
        classification=verifier_value,
        proposal=_as_proposal(verifier_value, "llm_verified"),
    )


__all__ = [
    "LLM_CONFIDENCE_THRESHOLD",
    "LLM_PRIMARY_MODEL",
    "LLM_VERIFIER_MODEL",
    "LlmAttempt",
    "LlmClassification",
    "LlmRequest",
    "LlmRouteResult",
    "MAX_CONTENT_EXCERPT_CHARS",
    "OpenAIContentClassifier",
    "SYSTEM_PROMPT_V1",
    "route_llm",
]
