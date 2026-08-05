"""Privacy-minimized OpenAI Structured Outputs adapter for Abbott content.

Only immutable content metadata is serialized. Returned contracts contain validated
classification fields, stable status codes, aggregate token counts, and elapsed
milliseconds; provider response bodies and exception text are never retained.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import html
import json
import re
import time
from types import MappingProxyType
from typing import Annotated, Any, Callable, Literal, Mapping, Sequence
import unicodedata
from urllib.parse import parse_qsl, unquote, urlsplit

from openai import OpenAI
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .domain import (
    ACCESS_CODES,
    ACCESS_LABELS,
    DIRECTION_CODES,
    DIRECTION_LABELS,
    LIFECYCLE_CODES,
    LIFECYCLE_LABELS,
    MATERIAL_TYPE_CODES,
    MATERIAL_TYPE_LABELS,
    ConflictCode,
    Proposal,
)


LLM_PRIMARY_MODEL = "gpt-5.6-terra"
LLM_VERIFIER_MODEL = "gpt-5.6-sol"
LLM_CONFIDENCE_THRESHOLD = 0.85
MAX_CONTENT_EXCERPT_CHARS = 12_000
MAX_EVIDENCE_ITEMS = 5
MAX_EVIDENCE_CHARS = 240
MAX_APPROVED_EXAMPLES = 8
MAX_DETERMINISTIC_EVIDENCE_ITEMS = 20
MAX_DETERMINISTIC_EVIDENCE_CHARS = 500
MAX_RULE_CODE_CHARS = 128
MAX_SERIALIZED_INPUT_BYTES = 200_000
MAX_PRIVACY_SCAN_CHARS = 200_000
MAX_PRIVACY_DECODE_PASSES = 16
MAX_PRIVACY_DECODE_WORK_CHARS = 1_000_000

SYSTEM_PROMPT_V1 = """Classify one Abbott professional-medical portal material.
Use only the supplied material JSON and its requested_fields. Every field not named
in requested_fields must be null (and direction alternatives must be empty when
direction is not requested). Use only taxonomy codes supplied in the versioned
taxonomy object. Return concise source-grounded evidence, not hidden reasoning. If
the evidence cannot support every requested field, use the schema's complete
insufficient-evidence abstention. Do not call tools or infer audience data.
"""

TAXONOMY_DEFINITIONS_V1: Mapping[str, str] = MappingProxyType(
    {
        "direction": "Primary Abbott medical specialty or approved audience bucket.",
        "material_type": "Canonical content format or approved portal material class.",
        "access": "Audience allowed to access the material; context only, not predicted.",
        "lifecycle": "Canonical publication lifecycle; context only, not predicted.",
    }
)


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

EvidenceSignal = Annotated[
    str, Field(min_length=1, max_length=MAX_EVIDENCE_CHARS)
]


class LlmClassification(BaseModel):
    """Closed Pydantic schema passed directly to ``responses.parse``.

    Nullable classification fields remain required in the generated JSON Schema.
    Null is mandatory for a field excluded by the request's lock mask.
    """

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    direction_code: DirectionCode | None
    material_type_code: MaterialTypeCode | None
    direction_confidence: float | None = Field(ge=0, le=1)
    material_type_confidence: float | None = Field(ge=0, le=1)
    alternative_direction_codes: tuple[DirectionCode, ...] = Field(max_length=4)
    evidence: tuple[EvidenceSignal, ...] = Field(max_length=MAX_EVIDENCE_ITEMS)
    requires_medical_review: bool
    insufficient_evidence: bool

    @model_validator(mode="after")
    def _validate_semantics(self) -> "LlmClassification":
        if any(not item.strip() for item in self.evidence):
            raise ValueError("evidence signals must not be blank")
        if len(set(self.alternative_direction_codes)) != len(
            self.alternative_direction_codes
        ):
            raise ValueError("alternative direction codes must be unique")
        if self.direction_code in self.alternative_direction_codes:
            raise ValueError("selected direction cannot also be an alternative")
        if self.insufficient_evidence:
            if (
                self.direction_code not in {None, "undetermined"}
                or self.material_type_code is not None
                or self.direction_confidence not in {None, 0}
                or self.material_type_confidence not in {None, 0}
                or self.alternative_direction_codes
                or self.evidence
                or self.requires_medical_review
            ):
                raise ValueError("insufficient evidence must be a complete abstention")
            return self
        if self.direction_code is None and self.direction_confidence is not None:
            raise ValueError("direction confidence requires a direction")
        if self.direction_code is not None and self.direction_confidence is None:
            raise ValueError("direction requires confidence")
        if self.material_type_code is None and self.material_type_confidence is not None:
            raise ValueError("material-type confidence requires a material type")
        if self.material_type_code is not None and self.material_type_confidence is None:
            raise ValueError("material type requires confidence")
        if self.direction_code is None and self.alternative_direction_codes:
            raise ValueError("direction alternatives require a proposed direction")

        if self.direction_code == "undetermined":
            raise ValueError("undetermined direction requires explicit abstention")
        if self.direction_code is None and self.material_type_code is None:
            raise ValueError("a non-abstaining response must classify a field")
        if not self.evidence:
            raise ValueError("a non-abstaining response requires evidence")
        return self


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
        return MappingProxyType(
            {str(key): _freeze_json(item) for key, item in value.items()}
        )
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
    deterministic_direction_evidence: tuple[str, ...] = ()
    deterministic_material_type_evidence: tuple[str, ...] = ()
    approved_examples: tuple[Mapping[str, Any], ...] = ()
    direction_locked: bool = False
    material_type_locked: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "breadcrumbs", tuple(self.breadcrumbs))
        for field_name in (
            "deterministic_evidence",
            "deterministic_direction_evidence",
            "deterministic_material_type_evidence",
        ):
            object.__setattr__(self, field_name, tuple(getattr(self, field_name)))
        object.__setattr__(
            self,
            "approved_examples",
            tuple(_freeze_json(example) for example in self.approved_examples),
        )

    @property
    def requested_fields(self) -> tuple[str, ...]:
        values: list[str] = []
        if not self.direction_locked:
            values.append("direction_code")
        if not self.material_type_locked:
            values.append("material_type_code")
        return tuple(values)


@dataclass(frozen=True)
class LlmUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cached_input_tokens: int = 0


@dataclass(frozen=True)
class LlmAttempt:
    status: Literal["success", "unresolved", "locked"]
    model: str
    classification: LlmClassification | None = None
    unresolved_code: str | None = None
    attempt_count: int = 0
    input_hash: str | None = None
    requested_fields: tuple[str, ...] = ("direction_code", "material_type_code")
    usage: LlmUsage | None = None
    elapsed_ms: int | None = None


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


# Explicit deny-list. These values are detection rules only and never request fields.
_PRIVATE_IDENTIFIER_FIELD_NAMES = frozenset(
    {
        "raw_user_id",
        "user_id",
        "visit_id",
        "client_id",
        "user_behavior",
    }
)
_DENIED_FIELD_NAMES = _PRIVATE_IDENTIFIER_FIELD_NAMES | frozenset(
    {
        "email",
        "email_address",
        "phone",
        "phone_number",
        "auth",
        "authorization",
        "oauth",
        "oauth_token",
        "access_token",
        "refresh_token",
        "METRIKA_TOKEN",
        "token",
        "api_key",
    }
)

_UNICODE_ESCAPE = re.compile(r"\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})")
_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_SENSITIVE_LABEL = re.compile(
    r"(?:^|[?&#;\s])(?:auth(?:orization)?|oauth(?:[_-]?token)?|"
    r"(?:access|refresh)?[_-]?token|api[_-]?key)\s*[:=]",
    re.IGNORECASE,
)
_LABELED_VALUE = re.compile(r"(?:^|[?&#;\s])([^?&#;:=]{1,64})\s*[:=]")
_BEARER_VALUE = re.compile(r"\bbearer\s+[A-Za-z0-9._~-]{8,}", re.IGNORECASE)
_API_SECRET = re.compile(r"\bsk-[A-Za-z0-9_-]{8,}", re.IGNORECASE)
_PHONE_LABEL = re.compile(
    r"(?<!\w)(?:tel|telephone|phone|телефон|тел|мобильн\w*)\s*"
    r"(?::|(?=\s))",
    re.IGNORECASE,
)


def _decode_for_detection(value: str) -> str:
    if not isinstance(value, str) or len(value) > MAX_PRIVACY_SCAN_CHARS:
        raise ValueError("privacy scan input is invalid")
    decoded = unicodedata.normalize("NFKC", value)
    work_chars = len(decoded)
    for _ in range(MAX_PRIVACY_DECODE_PASSES):
        candidate = html.unescape(unquote(decoded))
        candidate = _UNICODE_ESCAPE.sub(
            lambda match: chr(int(match.group(1) or match.group(2), 16)), candidate
        )
        candidate = unicodedata.normalize("NFKC", candidate)
        work_chars += len(candidate)
        if (
            len(candidate) > MAX_PRIVACY_SCAN_CHARS
            or work_chars > MAX_PRIVACY_DECODE_WORK_CHARS
        ):
            raise ValueError("privacy decoding exceeded its safety bound")
        if candidate == decoded:
            return candidate
        decoded = candidate
    raise ValueError("privacy decoding did not converge")


def _is_phone_continuity(character: str) -> bool:
    category = unicodedata.category(character)
    return (
        character.isspace()
        or character in "+−"
        or category[0] in {"C", "M", "P", "Z"}
    )


def _has_phone_digit_run(value: str) -> bool:
    """Detect phone-like runs across visible and invisible Unicode separators."""

    digits = 0
    in_run = False
    plus_prefixed = False
    for character in value:
        if character.isdigit():
            digits += 1
            in_run = True
            if digits >= (7 if plus_prefixed else 10):
                return True
            continue
        if in_run and _is_phone_continuity(character):
            continue
        digits = 0
        plus_prefixed = character == "+"
        in_run = plus_prefixed
    return False


def _has_labeled_phone(value: str) -> bool:
    label_view = "".join(
        character
        for character in value.casefold()
        if unicodedata.category(character)[0] not in {"C", "M"}
    )
    for match in _PHONE_LABEL.finditer(label_view):
        fragment = label_view[match.end() : match.end() + 64]
        digits = 0
        for character in fragment:
            if character.isdigit():
                digits += 1
                if digits >= 7:
                    return True
            elif not _is_phone_continuity(character):
                break
    return False


def _canonical_key(value: str) -> str:
    decoded = _CAMEL_BOUNDARY.sub("_", _decode_for_detection(value))
    return "".join(character for character in decoded.casefold() if character.isalnum())


_DENIED_CANONICAL_KEYS = frozenset(
    _canonical_key(value) for value in _DENIED_FIELD_NAMES
)
_PRIVATE_VALUE_MARKERS = frozenset(
    _canonical_key(value) for value in _PRIVATE_IDENTIFIER_FIELD_NAMES
)


def _url_has_denied_query(value: str) -> bool:
    decoded = _decode_for_detection(value)
    try:
        query = urlsplit(decoded).query
    except ValueError:
        return True
    return any(_canonical_key(key) in _DENIED_CANONICAL_KEYS for key, _ in parse_qsl(query))


def _text_has_denied_data(value: str) -> bool:
    decoded = _decode_for_detection(value)
    folded = decoded.casefold()
    compact = _canonical_key(decoded)
    has_denied_label = any(
        _canonical_key(match.group(1)) in _DENIED_CANONICAL_KEYS
        for match in _LABELED_VALUE.finditer(decoded)
    )
    return (
        any(marker in compact for marker in _PRIVATE_VALUE_MARKERS)
        or "@" in decoded
        or _has_phone_digit_run(decoded)
        or _has_labeled_phone(decoded)
        or _SENSITIVE_LABEL.search(folded) is not None
        or has_denied_label
        or _BEARER_VALUE.search(decoded) is not None
        or _API_SECRET.search(decoded) is not None
        or "oauth" in compact
        or _url_has_denied_query(decoded)
    )


def _contains_denied_data(value: Any, *, key: str | None = None) -> bool:
    if key is not None and _canonical_key(key) in _DENIED_CANONICAL_KEYS:
        return True
    if isinstance(value, Mapping):
        return any(
            _contains_denied_data(item, key=str(item_key))
            for item_key, item in value.items()
        )
    if isinstance(value, (list, tuple)):
        return any(_contains_denied_data(item) for item in value)
    return isinstance(value, str) and _text_has_denied_data(value)


def _plain_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _plain_json(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_plain_json(item) for item in value]
    return value


def _valid_optional(value: str | None, allowed: Sequence[str]) -> bool:
    return value is None or value in allowed


def _validate_example_shape(example: Mapping[str, Any]) -> None:
    scalar_limits = {
        "title": 500,
        "normalized_url": 2_048,
        "normalized_path": 2_048,
        "h1": 500,
        "meta_description": 1_000,
        "content_excerpt": 2_000,
    }
    for field_name, limit in scalar_limits.items():
        if field_name in example and (
            not isinstance(example[field_name], str)
            or len(example[field_name]) > limit
        ):
            raise ValueError("invalid approved example text field")
    material_type_hint = example.get("material_type_hint")
    if material_type_hint is not None and (
        not isinstance(material_type_hint, str) or len(material_type_hint) > 128
    ):
        raise ValueError("invalid approved example material type hint")
    for field_name, item_limit, count_limit in (
        ("breadcrumbs", 240, 12),
        ("evidence", MAX_EVIDENCE_CHARS, MAX_EVIDENCE_ITEMS),
    ):
        if field_name not in example:
            continue
        items = example[field_name]
        if (
            not isinstance(items, list)
            or len(items) > count_limit
            or any(
                not isinstance(item, str)
                or not item.strip()
                or len(item) > item_limit
                for item in items
            )
        ):
            raise ValueError("invalid approved example list field")


def _validate_request_shape(request: LlmRequest) -> None:
    for field_name, limit in (
        ("title", 1_000),
        ("normalized_url", 4_096),
        ("normalized_path", 4_096),
        ("h1", 1_000),
        ("meta_description", 2_000),
        ("content_excerpt", MAX_CONTENT_EXCERPT_CHARS + 100_000),
    ):
        value = getattr(request, field_name)
        if not isinstance(value, str) or len(value) > limit:
            raise ValueError("invalid request text field")
    if (
        len(request.breadcrumbs) > 20
        or any(
            not isinstance(item, str) or len(item) > 500
            for item in request.breadcrumbs
        )
    ):
        raise ValueError("invalid breadcrumbs")
    for values in (
        request.deterministic_evidence,
        request.deterministic_direction_evidence,
        request.deterministic_material_type_evidence,
    ):
        if len(values) > MAX_DETERMINISTIC_EVIDENCE_ITEMS or any(
            not isinstance(item, str)
            or not item.strip()
            or len(item) > MAX_DETERMINISTIC_EVIDENCE_CHARS
            for item in values
        ):
            raise ValueError("invalid deterministic evidence")
    if not isinstance(request.direction_locked, bool) or not isinstance(
        request.material_type_locked, bool
    ):
        raise ValueError("invalid lock mask")
    if request.deterministic_proposal is not None and not isinstance(
        request.deterministic_proposal, Proposal
    ):
        raise ValueError("invalid deterministic proposal")
    proposal = request.deterministic_proposal
    if proposal is not None:
        if (
            not isinstance(proposal.rule_code, str)
            or not proposal.rule_code.strip()
            or len(proposal.rule_code) > MAX_RULE_CODE_CHARS
        ):
            raise ValueError("invalid deterministic proposal rule")
        if proposal.confidence is not None and (
            not isinstance(proposal.confidence, (int, float))
            or isinstance(proposal.confidence, bool)
            or not 0 <= proposal.confidence <= 1
        ):
            raise ValueError("invalid deterministic proposal confidence")
        if (
            not isinstance(proposal.evidence, tuple)
            or len(proposal.evidence) > MAX_DETERMINISTIC_EVIDENCE_ITEMS
            or any(
                not isinstance(item, str)
                or not item.strip()
                or len(item) > MAX_DETERMINISTIC_EVIDENCE_CHARS
                for item in proposal.evidence
            )
        ):
            raise ValueError("invalid deterministic proposal evidence")


def _validate_request_taxonomy(
    request: LlmRequest, examples: Sequence[Mapping[str, Any]]
) -> None:
    if (
        not isinstance(request.taxonomy_version, str)
        or not request.taxonomy_version.strip()
        or len(request.taxonomy_version) > 128
    ):
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
        if not _valid_optional(example.get("material_type_hint"), MATERIAL_TYPE_CODES):
            raise ValueError("invalid example material type hint")
        if not _valid_optional(example.get("access_code"), ACCESS_CODES):
            raise ValueError("invalid example access code")


def _term_rows(labels: Mapping[str, str]) -> list[dict[str, str]]:
    return [{"code": code, "label": label} for code, label in labels.items()]


def _taxonomy_payload(version: str) -> dict[str, Any]:
    return {
        "version": version,
        "definitions": dict(TAXONOMY_DEFINITIONS_V1),
        "direction_terms": _term_rows(DIRECTION_LABELS),
        "material_type_terms": _term_rows(MATERIAL_TYPE_LABELS),
        "access_terms": _term_rows(ACCESS_LABELS),
        "lifecycle_terms": _term_rows(LIFECYCLE_LABELS),
    }


def _deterministic_payload(
    value: Proposal | None, requested_fields: Sequence[str]
) -> Mapping[str, Any] | None:
    if value is None:
        return None
    payload: dict[str, Any] = {
        "confidence": value.confidence,
        "rule_code": value.rule_code,
    }
    if "direction_code" in requested_fields:
        payload["direction_code"] = value.direction_code
    if "material_type_code" in requested_fields:
        payload["material_type_code"] = value.material_type_code
    return payload


def _requested_evidence(request: LlmRequest) -> tuple[str, ...]:
    explicit: list[str] = []
    if "direction_code" in request.requested_fields:
        explicit.extend(request.deterministic_direction_evidence)
    if "material_type_code" in request.requested_fields:
        explicit.extend(request.deterministic_material_type_evidence)
    if explicit:
        return tuple(explicit)
    if request.direction_locked or request.material_type_locked:
        return ()
    if request.deterministic_evidence:
        return request.deterministic_evidence
    if request.deterministic_proposal is not None:
        return request.deterministic_proposal.evidence
    return ()


def _serialize_request(request: LlmRequest) -> tuple[str, str]:
    _validate_request_shape(request)
    if len(request.approved_examples) > MAX_APPROVED_EXAMPLES:
        raise ValueError("too many approved examples")
    examples: list[dict[str, Any]] = []
    for immutable_example in request.approved_examples:
        example = _plain_json(immutable_example)
        if not isinstance(example, dict):
            raise ValueError("approved example must be an object")
        if _contains_denied_data(example):
            raise ValueError("example contains denied data")
        if set(example) - _APPROVED_EXAMPLE_FIELDS:
            raise ValueError("unapproved example field")
        _validate_example_shape(example)
        examples.append(example)
    _validate_request_taxonomy(request, examples)

    payload = {
        "access_code": request.access_code,
        "approved_examples": examples,
        "breadcrumbs": list(request.breadcrumbs),
        "content_excerpt": request.content_excerpt[:MAX_CONTENT_EXCERPT_CHARS],
        "deterministic_evidence": list(_requested_evidence(request)),
        "deterministic_proposal": _deterministic_payload(
            request.deterministic_proposal, request.requested_fields
        ),
        "h1": request.h1,
        "material_type_hint": (
            None if request.material_type_locked else request.material_type_hint
        ),
        "meta_description": request.meta_description,
        "normalized_path": request.normalized_path,
        "normalized_url": request.normalized_url,
        "requested_fields": list(request.requested_fields),
        "taxonomy": _taxonomy_payload(request.taxonomy_version),
        "taxonomy_version": request.taxonomy_version,
        "title": request.title,
    }
    if _contains_denied_data(payload):
        raise ValueError("input contains denied data")
    serialized = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    )
    encoded = serialized.encode("utf-8")
    if len(encoded) >= MAX_SERIALIZED_INPUT_BYTES:
        raise ValueError("serialized input exceeds its safety bound")
    return serialized, hashlib.sha256(encoded).hexdigest()


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
    if status == "failed":
        raise _AttemptFailure("LLM_RESPONSE_FAILED", False)
    if status == "cancelled":
        raise _AttemptFailure("LLM_RESPONSE_CANCELLED", False)
    if status in {"queued", "in_progress"}:
        raise _AttemptFailure("LLM_RESPONSE_NOT_COMPLETED", False)
    if status != "completed":
        raise _AttemptFailure("LLM_RESPONSE_STATUS_INVALID", False)
    if _response_has_refusal(response):
        raise _AttemptFailure("LLM_REFUSAL", True)
    parsed = getattr(response, "output_parsed", None)
    if not isinstance(parsed, LlmClassification):
        raise _AttemptFailure("LLM_SCHEMA_FAILURE", True)
    return parsed


_NONRETRYABLE_RATE_CODES = frozenset(
    {
        "credit_balance_exhausted",
        "organization_spend_limit_exceeded",
        "project_spend_limit_exceeded",
        "organization_usage_limit_exceeded",
        "insufficient_quota",
    }
)


def _exception_failure(error: Exception) -> _AttemptFailure:
    """Classify errors by type/status/code only; never retain their text or body."""

    name = type(error).__name__
    status_code = getattr(error, "status_code", None)
    error_code = getattr(error, "code", None)
    if isinstance(error, TimeoutError) or name in {"APITimeoutError", "TimeoutException"}:
        return _AttemptFailure("LLM_TIMEOUT", True)
    if status_code == 408:
        return _AttemptFailure("LLM_REQUEST_TIMEOUT", True)
    if status_code == 429 or name == "RateLimitError":
        if error_code in _NONRETRYABLE_RATE_CODES:
            return _AttemptFailure("LLM_QUOTA_ERROR", False)
        return _AttemptFailure("LLM_RATE_LIMIT", True)
    if isinstance(status_code, int) and 500 <= status_code <= 599:
        return _AttemptFailure("LLM_SERVER_ERROR", True)
    if name in {"InternalServerError", "ServiceUnavailableError"}:
        return _AttemptFailure("LLM_SERVER_ERROR", True)
    if name == "LengthFinishReasonError":
        return _AttemptFailure("LLM_INCOMPLETE", True)
    if name in {"ContentFilterFinishReasonError", "RefusalError"}:
        return _AttemptFailure("LLM_REFUSAL", True)
    if name in {"ValidationError", "SchemaError", "JSONDecodeError"}:
        return _AttemptFailure("LLM_SCHEMA_FAILURE", True)
    return _AttemptFailure("LLM_PROVIDER_ERROR", False)


def _safe_count(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _usage_from_response(response: Any) -> LlmUsage | None:
    usage = getattr(response, "usage", None)
    if usage is None:
        return None
    details = getattr(usage, "input_tokens_details", None)
    result = LlmUsage(
        input_tokens=_safe_count(getattr(usage, "input_tokens", None)),
        output_tokens=_safe_count(getattr(usage, "output_tokens", None)),
        total_tokens=_safe_count(getattr(usage, "total_tokens", None)),
        cached_input_tokens=_safe_count(getattr(details, "cached_tokens", None)),
    )
    return result


def _add_usage(left: LlmUsage | None, right: LlmUsage | None) -> LlmUsage | None:
    if left is None:
        return right
    if right is None:
        return left
    return LlmUsage(
        input_tokens=left.input_tokens + right.input_tokens,
        output_tokens=left.output_tokens + right.output_tokens,
        total_tokens=left.total_tokens + right.total_tokens,
        cached_input_tokens=left.cached_input_tokens + right.cached_input_tokens,
    )


def _classification_respects_fields(
    value: LlmClassification, requested_fields: Sequence[str]
) -> bool:
    requested = frozenset(requested_fields)
    if "direction_code" not in requested and (
        value.direction_code is not None
        or value.direction_confidence is not None
        or value.alternative_direction_codes
    ):
        return False
    if "material_type_code" not in requested and (
        value.material_type_code is not None
        or value.material_type_confidence is not None
    ):
        return False
    if value.insufficient_evidence:
        return True
    if "direction_code" in requested and value.direction_code is None:
        return False
    if "material_type_code" in requested and value.material_type_code is None:
        return False
    return True


class OpenAIContentClassifier:
    """Responses adapter with one local retry and no hidden SDK retries.

    Injected clients and client-factory results must themselves be configured with
    ``max_retries=0``. Real SDK clients are safely cloned with that setting,
    keeping the adapter-wide maximum at two provider calls.
    """

    def __init__(
        self,
        client: Any | None = None,
        *,
        client_factory: Callable[..., Any] = OpenAI,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = None if client is None else self._without_hidden_retries(client)
        self._client_factory = client_factory
        self._monotonic = monotonic

    @staticmethod
    def _without_hidden_retries(client: Any) -> Any:
        if isinstance(client, OpenAI):
            return client.with_options(max_retries=0)
        if getattr(client, "max_retries", None) != 0:
            raise ValueError("clients must declare max_retries=0")
        return client

    def _client_for_call(self) -> Any:
        if self._client is None:
            candidate = self._client_factory(max_retries=0)
            self._client = self._without_hidden_retries(candidate)
        return self._client

    def classify(self, request: LlmRequest, model: str) -> LlmAttempt:
        requested_fields = request.requested_fields
        if not requested_fields:
            return LlmAttempt(
                status="locked",
                model=model,
                unresolved_code="LLM_LOCKED",
                requested_fields=(),
            )
        if model not in {LLM_PRIMARY_MODEL, LLM_VERIFIER_MODEL}:
            return LlmAttempt(
                status="unresolved",
                model=model,
                unresolved_code="LLM_MODEL_NOT_ALLOWED",
                requested_fields=requested_fields,
            )
        try:
            immutable_json, input_hash = _serialize_request(request)
        except (TypeError, ValueError):
            return LlmAttempt(
                status="unresolved",
                model=model,
                unresolved_code="LLM_INPUT_REJECTED",
                requested_fields=requested_fields,
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
        started = self._monotonic()
        aggregate_usage: LlmUsage | None = None

        def finish(
            *,
            status: Literal["success", "unresolved"],
            attempt_count: int,
            classification: LlmClassification | None = None,
            unresolved_code: str | None = None,
        ) -> LlmAttempt:
            elapsed_ms = max(0, round((self._monotonic() - started) * 1000))
            return LlmAttempt(
                status=status,
                model=model,
                classification=classification,
                unresolved_code=unresolved_code,
                attempt_count=attempt_count,
                input_hash=input_hash,
                requested_fields=requested_fields,
                usage=aggregate_usage,
                elapsed_ms=elapsed_ms,
            )

        for attempt_number in (1, 2):
            try:
                response = self._client_for_call().responses.parse(**request_arguments)
                aggregate_usage = _add_usage(
                    aggregate_usage, _usage_from_response(response)
                )
                classification = _parse_response(response)
                if not _classification_respects_fields(
                    classification, requested_fields
                ):
                    raise _AttemptFailure("LLM_SCHEMA_FAILURE", True)
            except _AttemptFailure as failure:
                if failure.retryable and attempt_number == 1:
                    continue
                return finish(
                    status="unresolved",
                    unresolved_code=failure.code,
                    attempt_count=attempt_number,
                )
            except Exception as error:
                failure = _exception_failure(error)
                if failure.retryable and attempt_number == 1:
                    continue
                return finish(
                    status="unresolved",
                    unresolved_code=failure.code,
                    attempt_count=attempt_number,
                )
            if classification.insufficient_evidence:
                return finish(
                    status="unresolved",
                    unresolved_code="LLM_INSUFFICIENT_EVIDENCE",
                    attempt_count=attempt_number,
                )
            return finish(
                status="success",
                classification=classification,
                attempt_count=attempt_number,
            )
        raise AssertionError("unreachable retry state")


def _as_proposal(value: LlmClassification, rule_code: str) -> Proposal:
    confidences = tuple(
        confidence
        for confidence in (
            value.direction_confidence,
            value.material_type_confidence,
        )
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


def _deterministic_disagreement(
    deterministic: Proposal,
    classification: LlmClassification,
    requested_fields: Sequence[str],
) -> bool:
    comparisons: list[tuple[str | None, str | None]] = []
    if "direction_code" in requested_fields:
        comparisons.append((deterministic.direction_code, classification.direction_code))
    if "material_type_code" in requested_fields:
        comparisons.append(
            (deterministic.material_type_code, classification.material_type_code)
        )
    return any(
        expected is not None and expected != observed
        for expected, observed in comparisons
    )


def _classifications_agree(
    primary: LlmClassification,
    verifier: LlmClassification,
    requested_fields: Sequence[str],
) -> bool:
    return all(
        getattr(primary, field_name) == getattr(verifier, field_name)
        for field_name in requested_fields
    )


def _confidence_at_least(
    value: LlmClassification, requested_fields: Sequence[str], threshold: float
) -> bool:
    confidence_by_field = {
        "direction_code": value.direction_confidence,
        "material_type_code": value.material_type_confidence,
    }
    return all(
        confidence_by_field[field_name] is not None
        and confidence_by_field[field_name] >= threshold
        for field_name in requested_fields
    )


def _locked_field_returned(attempt: LlmAttempt) -> bool:
    return attempt.classification is not None and not _classification_respects_fields(
        attempt.classification, attempt.requested_fields
    )


def route_llm(
    deterministic: Proposal,
    primary: LlmAttempt,
    verifier_factory: Callable[[], LlmAttempt],
) -> LlmRouteResult:
    """Apply deterministic Terra-to-Sol routing while preserving field locks."""

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
    if _locked_field_returned(primary):
        return LlmRouteResult(
            status="unresolved",
            primary=primary,
            unresolved_code="LLM_LOCKED_FIELD_RETURNED",
        )
    if primary.status != "success" or primary.classification is None:
        return LlmRouteResult(
            status="unresolved",
            primary=primary,
            unresolved_code=primary.unresolved_code or "LLM_PRIMARY_UNRESOLVED",
        )

    primary_value = primary.classification
    if primary_value.insufficient_evidence:
        return LlmRouteResult(
            status="unresolved",
            primary=primary,
            unresolved_code="LLM_INSUFFICIENT_EVIDENCE",
        )
    needs_verifier = (
        not _confidence_at_least(
            primary_value, primary.requested_fields, LLM_CONFIDENCE_THRESHOLD
        )
        or bool(primary_value.alternative_direction_codes)
        or _deterministic_disagreement(
            deterministic, primary_value, primary.requested_fields
        )
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
    if verifier.requested_fields != primary.requested_fields:
        return LlmRouteResult(
            status="unresolved",
            primary=primary,
            verifier=verifier,
            unresolved_code="LLM_VERIFIER_FIELD_MASK_MISMATCH",
        )
    if _locked_field_returned(verifier):
        return LlmRouteResult(
            status="unresolved",
            primary=primary,
            verifier=verifier,
            unresolved_code="LLM_LOCKED_FIELD_RETURNED",
        )
    if verifier.status != "success" or verifier.classification is None:
        return LlmRouteResult(
            status="unresolved",
            primary=primary,
            verifier=verifier,
            unresolved_code=verifier.unresolved_code or "LLM_VERIFIER_UNRESOLVED",
        )
    verifier_value = verifier.classification
    if verifier_value.insufficient_evidence:
        return LlmRouteResult(
            status="unresolved",
            primary=primary,
            verifier=verifier,
            unresolved_code="LLM_INSUFFICIENT_EVIDENCE",
        )
    if verifier_value.alternative_direction_codes:
        return LlmRouteResult(
            status="unresolved",
            primary=primary,
            verifier=verifier,
            unresolved_code="LLM_VERIFIER_AMBIGUOUS",
        )
    if verifier_value.requires_medical_review:
        return LlmRouteResult(
            status="unresolved",
            primary=primary,
            verifier=verifier,
            unresolved_code="LLM_VERIFIER_MEDICAL_REVIEW",
        )
    if not _classifications_agree(
        primary_value, verifier_value, primary.requested_fields
    ):
        return LlmRouteResult(
            status="conflict",
            primary=primary,
            verifier=verifier,
            conflict_code=ConflictCode.LLM_DISAGREEMENT.value,
        )
    if not _confidence_at_least(
        verifier_value, verifier.requested_fields, LLM_CONFIDENCE_THRESHOLD
    ):
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
    "LlmUsage",
    "MAX_CONTENT_EXCERPT_CHARS",
    "OpenAIContentClassifier",
    "SYSTEM_PROMPT_V1",
    "TAXONOMY_DEFINITIONS_V1",
    "route_llm",
]
