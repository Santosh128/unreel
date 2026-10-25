-- One row per device per day per source ('manual' or an app name like 'Instagram')
CREATE TABLE IF NOT EXISTS reel_counts (
  device_id  VARCHAR(64)  NOT NULL,
  day        DATE         NOT NULL,
  source     VARCHAR(64)  NOT NULL DEFAULT 'manual',
  count      INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id, day, source)
);

CREATE TABLE IF NOT EXISTS settings (
  device_id   VARCHAR(64)  NOT NULL PRIMARY KEY,
  daily_limit INT UNSIGNED NOT NULL DEFAULT 20
);
