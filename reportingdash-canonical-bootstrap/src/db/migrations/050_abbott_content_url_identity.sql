-- Migration 050: add canonical URL lookup keys without changing existing kinds.
ALTER TABLE portal_content_lookup_projection
  MODIFY COLUMN lookup_kind
    ENUM('title','slug','path','url') NOT NULL;
