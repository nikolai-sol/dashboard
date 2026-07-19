ALTER TABLE canonical_fact_gsc_queries_daily
  MODIFY property_url VARCHAR(255) NULL DEFAULT NULL,
  MODIFY device_type VARCHAR(32) NULL DEFAULT NULL,
  MODIFY query_text TEXT NULL;
