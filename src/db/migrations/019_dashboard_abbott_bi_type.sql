ALTER TABLE dashboards
  MODIFY COLUMN dashboard_type ENUM('awareness', 'performance', 'overview', 'multibrand', 'abbott_bi', 'zaruku_bi')
  DEFAULT 'awareness';
