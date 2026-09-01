-- Abbott taxonomy v2 adds the reviewed service-page material type without
-- mutating the content-addressed abbott.v1 predecessor.

SET @abbott_taxonomy_v1_id := (
  SELECT id
  FROM portal_content_taxonomy_versions
  WHERE dataset_key = 'abbott' AND version = 'abbott.v1'
);
SET @abbott_taxonomy_v2_id := (
  SELECT id
  FROM portal_content_taxonomy_versions
  WHERE dataset_key = 'abbott' AND version = 'abbott.v2'
);
SET @abbott_taxonomy_v2_preexisting := IF(@abbott_taxonomy_v2_id IS NULL, 0, 1);

DROP TEMPORARY TABLE IF EXISTS abbott_expected_taxonomy_v2_terms;
CREATE TEMPORARY TABLE abbott_expected_taxonomy_v2_terms (
  taxonomy_kind VARCHAR(64) NOT NULL,
  term_code VARCHAR(128) NOT NULL,
  term_label VARCHAR(255) NOT NULL,
  term_status VARCHAR(32) NOT NULL,
  source_evidence JSON NOT NULL,
  PRIMARY KEY (taxonomy_kind, term_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO abbott_expected_taxonomy_v2_terms (
  taxonomy_kind, term_code, term_label, term_status, source_evidence
)
SELECT
  taxonomy_kind, term_code, term_label, term_status,
  JSON_OBJECT('authority', 'migration-052-reviewed-taxonomy-v2')
FROM portal_content_taxonomy_terms
WHERE taxonomy_version_id = @abbott_taxonomy_v1_id;

INSERT INTO abbott_expected_taxonomy_v2_terms (
  taxonomy_kind, term_code, term_label, term_status, source_evidence
) VALUES (
  'material_type', 'service_page', 'Служебная страница', 'active',
  JSON_OBJECT('authority', 'migration-052-reviewed-taxonomy-v2')
);

DROP TEMPORARY TABLE IF EXISTS abbott_taxonomy_v1_guard;
CREATE TEMPORARY TABLE abbott_taxonomy_v1_guard (
  attestation_ok TINYINT NOT NULL,
  CONSTRAINT ABBOTT_M052_TAXONOMY_V1_FAIL CHECK (attestation_ok = 1)
);
INSERT INTO abbott_taxonomy_v1_guard (attestation_ok)
SELECT IF(
  @abbott_taxonomy_v1_id IS NOT NULL
  AND (
    SELECT COUNT(*)
    FROM portal_content_taxonomy_versions
    WHERE id = @abbott_taxonomy_v1_id
      AND dataset_key = 'abbott'
      AND version = 'abbott.v1'
      AND taxonomy_digest = 'd6a2bfc39d970a873e309223604f9ae7c37cd83d6c046c107eed08e73ec435d4'
      AND taxonomy_status = 'active'
  ) = 1
  AND (
    SELECT COUNT(*)
    FROM portal_content_taxonomy_terms
    WHERE taxonomy_version_id = @abbott_taxonomy_v1_id
  ) = 40
  AND (
    SELECT COUNT(*)
    FROM portal_content_taxonomy_terms
    WHERE taxonomy_version_id = @abbott_taxonomy_v1_id
      AND term_status <> 'active'
  ) = 0
  AND (
    SELECT COUNT(*)
    FROM portal_content_taxonomy_terms
    WHERE taxonomy_version_id = @abbott_taxonomy_v1_id
      AND taxonomy_kind = 'material_type'
      AND term_code = 'service_page'
  ) = 0
  AND (
    SELECT COUNT(*) FROM abbott_expected_taxonomy_v2_terms
  ) = 41,
  1,
  0
);
DROP TEMPORARY TABLE abbott_taxonomy_v1_guard;

INSERT INTO portal_content_taxonomy_versions (
  dataset_key, version, taxonomy_digest, taxonomy_status, source_evidence,
  activated_at
)
SELECT
  'abbott', 'abbott.v2',
  '472159bf7ed72b60df97e5e1efa2bfc8b33fc4edbfcef112182a0eb843aaa34b',
  'active',
  JSON_OBJECT('authority', 'migration-052-reviewed-taxonomy-v2'),
  CURRENT_TIMESTAMP(6)
WHERE @abbott_taxonomy_v2_preexisting = 0;

SET @abbott_taxonomy_v2_id := (
  SELECT id
  FROM portal_content_taxonomy_versions
  WHERE dataset_key = 'abbott' AND version = 'abbott.v2'
);

INSERT INTO portal_content_taxonomy_terms (
  taxonomy_version_id, taxonomy_kind, term_code, term_label, term_status,
  source_evidence
)
SELECT
  @abbott_taxonomy_v2_id, taxonomy_kind, term_code, term_label, term_status,
  source_evidence
FROM abbott_expected_taxonomy_v2_terms
WHERE @abbott_taxonomy_v2_preexisting = 0
ORDER BY taxonomy_kind, term_code;

SET @abbott_taxonomy_v2_mismatched_count := (
  SELECT COUNT(*)
  FROM portal_content_taxonomy_terms AS actual
  LEFT JOIN abbott_expected_taxonomy_v2_terms AS expected
    ON expected.taxonomy_kind = actual.taxonomy_kind
   AND expected.term_code = actual.term_code
  WHERE actual.taxonomy_version_id = @abbott_taxonomy_v2_id
    AND (
      expected.term_code IS NULL
      OR actual.term_label <> expected.term_label
      OR actual.term_status <> expected.term_status
      OR NOT (
        JSON_LENGTH(actual.source_evidence) = 1
        AND JSON_UNQUOTE(JSON_EXTRACT(actual.source_evidence, '$.authority'))
            <=> JSON_UNQUOTE(JSON_EXTRACT(expected.source_evidence, '$.authority'))
      )
    )
);
SET @abbott_taxonomy_v2_missing_count := (
  SELECT COUNT(*)
  FROM abbott_expected_taxonomy_v2_terms AS expected
  LEFT JOIN portal_content_taxonomy_terms AS actual
    ON actual.taxonomy_version_id = @abbott_taxonomy_v2_id
   AND actual.taxonomy_kind = expected.taxonomy_kind
   AND actual.term_code = expected.term_code
  WHERE actual.id IS NULL
);

DROP TEMPORARY TABLE IF EXISTS abbott_taxonomy_v2_guard;
CREATE TEMPORARY TABLE abbott_taxonomy_v2_guard (
  attestation_ok TINYINT NOT NULL,
  CONSTRAINT ABBOTT_M052_TAXONOMY_V2_FAIL CHECK (attestation_ok = 1)
);
INSERT INTO abbott_taxonomy_v2_guard (attestation_ok)
SELECT IF(
  (
    SELECT COUNT(*)
    FROM portal_content_taxonomy_versions
    WHERE id = @abbott_taxonomy_v2_id
      AND dataset_key = 'abbott'
      AND version = 'abbott.v2'
      AND taxonomy_digest = '472159bf7ed72b60df97e5e1efa2bfc8b33fc4edbfcef112182a0eb843aaa34b'
      AND taxonomy_status = 'active'
      AND JSON_LENGTH(source_evidence) = 1
      AND JSON_UNQUOTE(JSON_EXTRACT(source_evidence, '$.authority'))
          = 'migration-052-reviewed-taxonomy-v2'
  ) = 1
  AND (
    SELECT COUNT(*)
    FROM portal_content_taxonomy_terms
    WHERE taxonomy_version_id = @abbott_taxonomy_v2_id
  ) = 41
  AND @abbott_taxonomy_v2_mismatched_count = 0
  AND @abbott_taxonomy_v2_missing_count = 0,
  1,
  0
);

DROP TEMPORARY TABLE abbott_taxonomy_v2_guard;
DROP TEMPORARY TABLE abbott_expected_taxonomy_v2_terms;
