ALTER TABLE dashboards
  MODIFY COLUMN dashboard_type ENUM('awareness', 'performance', 'overview', 'multibrand')
  DEFAULT 'awareness';
