-- One row per device per day per source ('manual' or an app name like 'Instagram')
CREATE TABLE IF NOT EXISTS reel_counts (
  device_id  VARCHAR(64)  NOT NULL,
  day        DATE         NOT NULL,
  source     VARCHAR(64)  NOT NULL DEFAULT 'manual',
  count      INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id, day, source)
);

-- YouTube ads the Android app skipped, per device per day
CREATE TABLE IF NOT EXISTS ad_skips (
  device_id VARCHAR(64)  NOT NULL,
  day       DATE         NOT NULL,
  count     INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, day)
);

-- One row per phone/browser, so devices can be told apart
CREATE TABLE IF NOT EXISTS devices (
  device_id  VARCHAR(64)  NOT NULL PRIMARY KEY,
  model      VARCHAR(100) NULL,
  first_seen TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  device_id   VARCHAR(64)  NOT NULL PRIMARY KEY,
  daily_limit INT UNSIGNED NOT NULL DEFAULT 20
);
