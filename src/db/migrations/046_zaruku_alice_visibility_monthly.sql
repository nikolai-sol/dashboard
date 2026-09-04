CREATE TABLE IF NOT EXISTS canonical_alice_visibility_snapshots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_key VARCHAR(64) NOT NULL DEFAULT 'yandex_webmaster_alice_manual',
  analytics_account_id VARCHAR(128) NOT NULL,
  domain VARCHAR(255) NOT NULL,
  period_month DATE NOT NULL,
  captured_at DATETIME NOT NULL,
  official_sov_pct DECIMAL(7,4) NOT NULL,
  exported_query_count INT DEFAULT NULL,
  portal_present_query_count INT DEFAULT NULL,
  sample_presence_pct DECIMAL(7,4) DEFAULT NULL,
  source_filename VARCHAR(255) DEFAULT NULL,
  source_sha256 CHAR(64) NOT NULL,
  snapshot_fingerprint_sha256 CHAR(64) DEFAULT NULL,
  publication_status VARCHAR(32) NOT NULL DEFAULT 'published',
  published_month_guard VARCHAR(135) GENERATED ALWAYS AS (CASE WHEN publication_status = 'published' THEN CONCAT(analytics_account_id, '|', EXTRACT(YEAR_MONTH FROM period_month)) ELSE NULL END) STORED,
  supersedes_snapshot_id BIGINT DEFAULT NULL,
  ingestion_run_id VARCHAR(128) NOT NULL,
  source_payload_json JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_alice_snapshot_fingerprint (analytics_account_id, source_key, snapshot_fingerprint_sha256),
  UNIQUE KEY uniq_alice_snapshot_run (ingestion_run_id),
  UNIQUE KEY uniq_alice_snapshot_published_month (published_month_guard),
  KEY idx_alice_snapshot_month (analytics_account_id, period_month, publication_status),
  KEY idx_alice_snapshot_supersedes (supersedes_snapshot_id),
  CONSTRAINT fk_alice_snapshot_supersedes FOREIGN KEY (supersedes_snapshot_id) REFERENCES canonical_alice_visibility_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_alice_visibility_queries (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  query_hash CHAR(64) NOT NULL,
  query_text TEXT NOT NULL,
  portal_present TINYINT(1) NOT NULL,
  portal_position TINYINT UNSIGNED DEFAULT NULL,
  portal_url TEXT DEFAULT NULL,
  alice_answer_url TEXT NOT NULL,
  source_count TINYINT UNSIGNED NOT NULL,
  raw_present_value VARCHAR(16) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_alice_query (snapshot_id, query_hash),
  KEY idx_alice_query_snapshot (snapshot_id, portal_present),
  CONSTRAINT fk_alice_query_snapshot FOREIGN KEY (snapshot_id) REFERENCES canonical_alice_visibility_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_alice_visibility_sources (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  query_id BIGINT NOT NULL,
  source_rank TINYINT UNSIGNED NOT NULL,
  source_url TEXT NOT NULL,
  source_domain VARCHAR(255) NOT NULL,
  is_portal TINYINT(1) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_alice_source_rank (query_id, source_rank),
  KEY idx_alice_source_domain (source_domain),
  CONSTRAINT fk_alice_source_query FOREIGN KEY (query_id) REFERENCES canonical_alice_visibility_queries(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_alice_visibility_featured_sites (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  display_order TINYINT UNSIGNED NOT NULL,
  site_url TEXT NOT NULL,
  site_domain VARCHAR(255) NOT NULL,
  list_kind VARCHAR(64) NOT NULL DEFAULT 'yandex_random_high_mentions',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_alice_featured_order (snapshot_id, list_kind, display_order),
  KEY idx_alice_featured_snapshot (snapshot_id),
  CONSTRAINT fk_alice_featured_snapshot FOREIGN KEY (snapshot_id) REFERENCES canonical_alice_visibility_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
