-- Additive, isolated regional research snapshots. No shared facts or config changes.
-- Apply separately only after release approval; the importer never runs DDL.
CREATE TABLE IF NOT EXISTS lyzobact_regions_snapshots (
  dashboard_id INT NOT NULL,
  id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  label VARCHAR(255) NOT NULL,
  checked_at DATE NOT NULL,
  input_sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
  register_sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
  sources_sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
  region_count INT UNSIGNED NOT NULL,
  source_count INT UNSIGNED NOT NULL,
  publication_status ENUM('staged','published') NOT NULL DEFAULT 'staged',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (dashboard_id,id),
  KEY idx_lyzobact_publication (dashboard_id,publication_status,checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lyzobact_regions_observations (
  dashboard_id INT NOT NULL,
  snapshot_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  region_key VARCHAR(100) NOT NULL,
  payload_json JSON NOT NULL,
  PRIMARY KEY (dashboard_id,snapshot_id,region_key),
  CONSTRAINT fk_lyzobact_observation_snapshot FOREIGN KEY (dashboard_id,snapshot_id)
    REFERENCES lyzobact_regions_snapshots(dashboard_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lyzobact_regions_source_pages (
  dashboard_id INT NOT NULL,
  snapshot_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_ordinal INT UNSIGNED NOT NULL,
  region_key VARCHAR(100) NOT NULL,
  payload_json JSON NOT NULL,
  PRIMARY KEY (dashboard_id,snapshot_id,source_ordinal),
  KEY idx_lyzobact_source_region (dashboard_id,snapshot_id,region_key),
  CONSTRAINT fk_lyzobact_source_observation FOREIGN KEY (dashboard_id,snapshot_id,region_key)
    REFERENCES lyzobact_regions_observations(dashboard_id,snapshot_id,region_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
