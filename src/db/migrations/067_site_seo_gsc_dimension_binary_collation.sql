ALTER TABLE canonical_fact_gsc_manual_period_dimensions
  MODIFY COLUMN dimension_value VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
