CREATE TABLE IF NOT EXISTS google_ads_recommendation_ai_analysis (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recommendation_id BIGINT UNSIGNED NOT NULL,
  model VARCHAR(255) NOT NULL,
  prompt_version VARCHAR(128) NOT NULL,
  input_json JSON NOT NULL,
  output_json JSON NOT NULL,
  intent_classification VARCHAR(64) NOT NULL,
  recommended_action VARCHAR(32) NOT NULL,
  refined_negative_keyword VARCHAR(255) NULL,
  match_type VARCHAR(16) NOT NULL,
  risk_level VARCHAR(16) NOT NULL,
  confidence VARCHAR(16) NOT NULL,
  reasoning_short TEXT NULL,
  specialist_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gads_ai_analysis_recommendation (recommendation_id),
  CONSTRAINT fk_gads_ai_analysis_recommendation
    FOREIGN KEY (recommendation_id)
    REFERENCES google_ads_negative_keyword_recommendations (id)
    ON DELETE CASCADE
);
