-- Dashboard config layer for Next.js API

CREATE TABLE IF NOT EXISTS dashboards (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(50) NOT NULL,
    client_name VARCHAR(200) NOT NULL,
    dashboard_name VARCHAR(200) NOT NULL,
    dashboard_type ENUM('awareness', 'performance', 'overview') DEFAULT 'awareness',
    config JSON,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_client (client_id),
    INDEX idx_active (is_active)
);

CREATE TABLE IF NOT EXISTS dashboard_sources (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dashboard_id INT NOT NULL,
    platform VARCHAR(50) NOT NULL,
    schema_file VARCHAR(100) NOT NULL,
    role ENUM('actual', 'plan') DEFAULT 'actual',
    FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE,
    INDEX idx_dashboard (dashboard_id)
);

CREATE TABLE IF NOT EXISTS dashboard_campaign_filters (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dashboard_source_id INT NOT NULL,
    filter_type ENUM('name_pattern', 'id_list', 'all') DEFAULT 'all',
    filter_value TEXT,
    FOREIGN KEY (dashboard_source_id) REFERENCES dashboard_sources(id) ON DELETE CASCADE
);

INSERT INTO dashboards (client_id, client_name, dashboard_name, dashboard_type, config, is_active)
SELECT
    'rag_mp',
    'RAG Market Place',
    'Awareness Campaign Q1 2025',
    'awareness',
    JSON_OBJECT(
        'currency', 'EUR',
        'visible_metrics', JSON_ARRAY('impressions', 'clicks', 'ctr', 'cpm', 'spend'),
        'show_spend', true,
        'period_from', '2025-01-01',
        'period_to', '2025-03-31'
    ),
    TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM dashboards WHERE client_id = 'rag_mp'
);

SET @dash_id = (
    SELECT id
    FROM dashboards
    WHERE client_id = 'rag_mp'
    ORDER BY id DESC
    LIMIT 1
);

INSERT INTO dashboard_sources (dashboard_id, platform, schema_file, role)
SELECT @dash_id, 'linkedin', 'schemas/linkedin.yaml', 'actual'
WHERE NOT EXISTS (
    SELECT 1
    FROM dashboard_sources
    WHERE dashboard_id = @dash_id AND platform = 'linkedin' AND role = 'actual'
);

INSERT INTO dashboard_sources (dashboard_id, platform, schema_file, role)
SELECT @dash_id, 'reddit', 'schemas/reddit.yaml', 'actual'
WHERE NOT EXISTS (
    SELECT 1
    FROM dashboard_sources
    WHERE dashboard_id = @dash_id AND platform = 'reddit' AND role = 'actual'
);

INSERT INTO dashboard_sources (dashboard_id, platform, schema_file, role)
SELECT @dash_id, 'media_plan', 'schemas/media_plan.yaml', 'plan'
WHERE NOT EXISTS (
    SELECT 1
    FROM dashboard_sources
    WHERE dashboard_id = @dash_id AND platform = 'media_plan' AND role = 'plan'
);

SET @linkedin_source_id = (
    SELECT id
    FROM dashboard_sources
    WHERE dashboard_id = @dash_id AND platform = 'linkedin' AND role = 'actual'
    ORDER BY id DESC
    LIMIT 1
);

SET @reddit_source_id = (
    SELECT id
    FROM dashboard_sources
    WHERE dashboard_id = @dash_id AND platform = 'reddit' AND role = 'actual'
    ORDER BY id DESC
    LIMIT 1
);

SET @plan_source_id = (
    SELECT id
    FROM dashboard_sources
    WHERE dashboard_id = @dash_id AND platform = 'media_plan' AND role = 'plan'
    ORDER BY id DESC
    LIMIT 1
);

INSERT INTO dashboard_campaign_filters (dashboard_source_id, filter_type, filter_value)
SELECT @linkedin_source_id, 'all', NULL
WHERE @linkedin_source_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM dashboard_campaign_filters
      WHERE dashboard_source_id = @linkedin_source_id
  );

INSERT INTO dashboard_campaign_filters (dashboard_source_id, filter_type, filter_value)
SELECT @reddit_source_id, 'all', NULL
WHERE @reddit_source_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM dashboard_campaign_filters
      WHERE dashboard_source_id = @reddit_source_id
  );

INSERT INTO dashboard_campaign_filters (dashboard_source_id, filter_type, filter_value)
SELECT @plan_source_id, 'all', NULL
WHERE @plan_source_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM dashboard_campaign_filters
      WHERE dashboard_source_id = @plan_source_id
  );
