ALTER TABLE seo_ai_visibility_weekly
  COMMENT = 'DEPRECATED / NO WRITER / DO NOT READ: use seo_ai_visibility and canonical AI visibility facts';

ALTER TABLE seo_webmaster_queries_weekly
  COMMENT = 'DEPRECATED / NO WRITER / DO NOT READ: use canonical_fact_webmaster_queries_daily aggregated by ISO week';

ALTER TABLE seo_webmaster_pages_weekly
  COMMENT = 'DEPRECATED / NO WRITER / DO NOT READ: use canonical_fact_webmaster_pages_daily aggregated by ISO week';
