-- Add 'custom_table' to dashboard_sources.role enum
-- Custom table sources display arbitrary Google Sheets CSV as read-only tables on the dashboard.

ALTER TABLE dashboard_sources
  MODIFY COLUMN role ENUM('actual', 'plan', 'custom_table') DEFAULT 'actual';
