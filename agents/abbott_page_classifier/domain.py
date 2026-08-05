"""Immutable Abbott content-registry taxonomy and workflow contracts."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from types import MappingProxyType
from typing import Literal, Mapping


TaxonomyKind = Literal["direction", "material_type", "access", "lifecycle"]


def _readonly(values: dict[str, str]) -> Mapping[str, str]:
    return MappingProxyType(values)


DIRECTION_LABELS = _readonly(
    {
        "gastroenterology": "Гастроэнтерология [262340]",
        "cardiology": "Кардиология [262338]",
        "neurology_psychiatry": "Неврология и психиатрия [262339]",
        "womens_health": "Женское здоровье [262337]",
        "respiratory_health": "Здоровье дыхательной системы [263746]",
        "diabetes_management": "Управление сахарным диабетом [620888]",
        "pharmacists": "Фармацевты",
        "dermatology": "Дерматология [624635]",
        "not_applicable": "Не относится / служебная",
        "undetermined": "Не определено",
    }
)

MATERIAL_TYPE_LABELS = _readonly(
    {
        "articles": "Статьи",
        "video": "Видео",
        "tables": "Таблицы",
        "clinical_guidelines": "Клинические рекомендации",
        "calculators": "Калькуляторы",
        "clinical_cases": "Клинические случаи",
        "educational_brochures": "Научно-образовательные брошюры",
        "products": "Препараты и продукты",
        "pharmacist_assistant": "Помощник фармацевта",
        "podcasts": "Подкасты",
        "personal_effectiveness": "Личная эффективность",
        "knowledge_check": "Проверить знания",
        "pharmacy_consulting_algorithms": "Алгоритмы фармацевтического консультирования",
        "child_nutrition": "Детское питание",
        "devices": "Приборы и устройства",
        "respiratory_assistant": "Респираторный помощник",
        "clinical_decision_support": "Цифровой консультант врача",
        "events": "Мероприятия",
        "general_materials": "Общие материалы",
        "section": "Раздел",
        "subsection": "Подраздел",
        "special_project": "Спецпроект",
    }
)

ACCESS_LABELS = _readonly(
    {
        "all": "Все",
        "doctors": "Врачи",
        "pharmacists": "Фармацевты",
        "unspecified": "Не указано",
    }
)

LIFECYCLE_LABELS = _readonly(
    {
        "active": "active",
        "archive_candidate": "archive_candidate",
        "archived": "archived",
        "unknown": "unknown",
    }
)

DIRECTION_CODES = frozenset(DIRECTION_LABELS)
MATERIAL_TYPE_CODES = frozenset(MATERIAL_TYPE_LABELS)
ACCESS_CODES = frozenset(ACCESS_LABELS)
LIFECYCLE_CODES = frozenset(LIFECYCLE_LABELS)

TAXONOMY_LABELS: Mapping[TaxonomyKind, Mapping[str, str]] = MappingProxyType(
    {
        "direction": DIRECTION_LABELS,
        "material_type": MATERIAL_TYPE_LABELS,
        "access": ACCESS_LABELS,
        "lifecycle": LIFECYCLE_LABELS,
    }
)

# Legacy classifier output historically omitted the dermatology section ID.  It
# remains a rendering concern only; canonical taxonomy always includes it.
LEGACY_DIRECTION_LABELS = _readonly(
    {**DIRECTION_LABELS, "dermatology": "Дерматология"}
)

DIRECTION_CODE_BY_SECTION_ID = _readonly(
    {
        "262337": "womens_health",
        "262338": "cardiology",
        "262339": "neurology_psychiatry",
        "262340": "gastroenterology",
        "263746": "respiratory_health",
        "620888": "diabetes_management",
        "624635": "dermatology",
    }
)

DIRECTION_CODE_BY_PREFIX = _readonly(
    {
        "cardio": "cardiology",
        "gastro": "gastroenterology",
        "nevro": "neurology_psychiatry",
        "wh": "womens_health",
        "pulmo": "respiratory_health",
        "respiratory-assistant": "respiratory_health",
        "farmatsevtam": "pharmacists",
        "dermatology": "dermatology",
        "diabet": "diabetes_management",
    }
)

MATERIAL_TYPE_CODE_BY_PREFIX = _readonly(
    {
        "articles": "articles",
        "video": "video",
        "klinicheskie-sluchai": "clinical_cases",
        "nauchno-obrazovatelnye-broshyury": "educational_brochures",
        "podcasts": "podcasts",
        "tables": "tables",
        "calculators": "calculators",
        "check-knowledge": "knowledge_check",
        "preparation": "products",
        "pribory": "devices",
        "cdss": "clinical_decision_support",
        "klinicheskie-rekomendatsii": "clinical_guidelines",
        "algoritmy-farmatsevticheskogo-konsultirovaniya": "pharmacy_consulting_algorithms",
        "events": "events",
        "academy": "articles",
    }
)

LEGACY_CLASSIFIER_MATERIAL_TYPE_CODES = (
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
)


class ConflictCode(str, Enum):
    """Stable review conflict codes; never use free-form conflict text."""

    IDENTITY_COLLISION = "IDENTITY_COLLISION"
    ANTI_FLIP_CONFLICT = "ANTI_FLIP_CONFLICT"
    DIRECTION_CONFLICT = "DIRECTION_CONFLICT"
    MATERIAL_TYPE_CONFLICT = "MATERIAL_TYPE_CONFLICT"
    ACCESS_CONFLICT = "ACCESS_CONFLICT"
    ARCHIVE_TYPE_INVALID = "ARCHIVE_TYPE_INVALID"
    LLM_DISAGREEMENT = "LLM_DISAGREEMENT"
    CONTENT_UNAVAILABLE = "CONTENT_UNAVAILABLE"
    LLM_SCHEMA_FAILURE = "LLM_SCHEMA_FAILURE"


@dataclass(frozen=True)
class NormalizedUrl:
    value: str
    path: str
    sha256: str
    path_sha256: str


@dataclass(frozen=True)
class TaxonomyVersion:
    version: str
    terms: Mapping[TaxonomyKind, tuple[str, ...]] = field(
        default_factory=lambda: MappingProxyType({})
    )
    digest: str = ""

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "terms",
            MappingProxyType({kind: tuple(codes) for kind, codes in self.terms.items()}),
        )


@dataclass(frozen=True)
class MaterialCandidate:
    source_name: str
    source_row_id: str
    title: str
    url: str
    material_id: str | None
    direction_code: str | None
    material_type_code: str | None
    access_code: str | None
    lifecycle_code: str
    source_fingerprint: str


@dataclass(frozen=True)
class CanonicalClassification:
    content_entity_id: int
    title: str
    url: str
    direction_code: str | None
    material_type_code: str | None
    access_code: str | None
    lifecycle_code: str
    event_id: int | None = None


@dataclass(frozen=True)
class Proposal:
    direction_code: str | None
    material_type_code: str | None
    access_code: str | None
    lifecycle_code: str | None
    rule_code: str
    confidence: float | None
    evidence: tuple[str, ...] = ()


@dataclass(frozen=True)
class ApprovalItem:
    content_entity_id: int | None
    input_hash: str
    title: str
    url: str
    final_direction_code: str | None
    final_material_type_code: str | None
    final_access_code: str | None
    final_lifecycle_code: str | None
    readiness_state: Literal["ready", "conflict", "unresolved", "rejected", "no_change"]
    conflict_codes: tuple[ConflictCode, ...] = ()
    row_hash: str = ""
    decision_reason: str | None = None


@dataclass(frozen=True)
class ApprovalBatch:
    batch_key: str
    taxonomy_version: str
    published_input_hash: str
    items: tuple[ApprovalItem, ...]
    prompt_version: str = ""


@dataclass(frozen=True)
class AcceptedBatchSnapshot:
    batch_key: str
    published_input_hash: str
    accepted_decision_hash: str
    items: tuple[ApprovalItem, ...]
    accepted_by: str
    accepted_at: str
    accepted_count: int | None = None
    skipped_count: int | None = None


@dataclass(frozen=True)
class ClassificationEvent:
    content_entity_id: int
    direction_code: str | None
    material_type_code: str | None
    access_code: str | None
    lifecycle_code: str
    event_kind: Literal["baseline", "approve", "correct", "reject", "revoke"]
    event_fingerprint: str
    predecessor_event_id: int | None = None
    approval_batch_id: int | None = None
    approval_item_id: int | None = None
    actor: str | None = None
    reason: str | None = None
    effective_at: str | None = None


@dataclass(frozen=True)
class IngestResult:
    status: str
    accepted_count: int = 0
    conflict_count: int = 0
    unresolved_count: int = 0
    rejected_count: int = 0
    message: str | None = None
