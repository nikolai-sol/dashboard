-- Bind changing aggregate observed-page evidence into immutable Abbott
-- reconciliation run keys without exposing page URLs or query values.

ALTER TABLE portal_content_reconciliation_runs
  ADD COLUMN observed_pages_hash CHAR(64) NULL AFTER code_revision;
