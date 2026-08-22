-- ============================================================
-- TERREX (SkyGuard) — MySQL schema
-- Generated from the app mockup's mock data + UI surfaces:
-- auth, home dashboard, alerts feed, report form, trusted
-- circle, safe walk timer, SOS button, and settings page.
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS safety_checks;
DROP TABLE IF EXISTS sos_events;
DROP TABLE IF EXISTS safe_walk_sessions;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS trusted_circle;
DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS alerts;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

-- ------------------------------------------------------------
-- users
-- ------------------------------------------------------------
CREATE TABLE users (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name       VARCHAR(120)     NOT NULL,
  email           VARCHAR(190)     NOT NULL,
  password_hash   VARCHAR(255)     NOT NULL,
  created_at      DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO users (full_name, email, password_hash, created_at) VALUES
('Amaka Obi',   'amaka@example.com',  '$2y$10$demoHashPlaceholder0001', '2025-01-14 09:12:00'),
('Jide Taiwo',  'jide@example.com',   '$2y$10$demoHashPlaceholder0002', '2025-02-02 18:40:00'),
('Maya Bello',  'maya@example.com',   '$2y$10$demoHashPlaceholder0003', '2025-03-21 07:55:00');

-- ------------------------------------------------------------
-- alerts
-- Community incident feed shown on the home dashboard and the
-- alerts page (radar blips, feed cards, severity filter chips).
-- ------------------------------------------------------------
CREATE TABLE alerts (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title        VARCHAR(160)                             NOT NULL,
  severity     ENUM('critical','warning','resolved')     NOT NULL,
  distance_km  DECIMAL(4,1)                              NULL,
  note         VARCHAR(255)                              NULL,
  reported_at  DATETIME                                  NOT NULL,
  created_at   DATETIME                                  NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO alerts (title, severity, distance_km, note, reported_at) VALUES
('Attempted break-in reported', 'critical', 0.4, 'Unconfirmed',              '2026-08-17 08:05:00'),
('Suspicious loitering',        'warning',  0.6, NULL,                      '2026-08-17 07:30:00'),
('Road blocked — fallen tree',  'warning',  0.9, NULL,                      '2026-08-17 05:15:00'),
('Petty theft',                 'resolved', 1.2, 'Resolved by residents',   '2026-08-16 08:15:00'),
('False alarm — car alarm',     'resolved', 0.3, NULL,                      '2026-08-15 08:15:00');

-- ------------------------------------------------------------
-- reports
-- Submitted via the "Report" page (category, location, severity,
-- description, status). Tied to the user who filed it.
-- ------------------------------------------------------------
CREATE TABLE reports (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED                                                          NOT NULL,
  category     ENUM('Suspicious activity','Theft','Accident','Fire',
                     'Medical emergency','Infrastructure','Other')                   NOT NULL,
  location     VARCHAR(160)                                                          NOT NULL,
  description  TEXT                                                                  NULL,
  severity     ENUM('warning','critical')                                            NOT NULL DEFAULT 'warning',
  status       ENUM('submitted','reviewing','resolved')                              NOT NULL DEFAULT 'submitted',
  created_at   DATETIME                                                              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reports_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO reports (user_id, category, location, description, severity, status, created_at) VALUES
(1, 'Suspicious activity', 'Chevron Drive, near the roundabout', 'Two men were checking parked car doors around 7pm.', 'warning',  'submitted', '2026-08-16 19:10:00'),
(1, 'Infrastructure',      'Admiralty Way, opposite the bank',   'Streetlight has been out for a week.',               'warning',  'reviewing', '2026-08-14 12:00:00'),
(2, 'Theft',                'Ligali Ayorinde St',                  'Phone snatched from a rider stopped at the junction.', 'critical', 'submitted', '2026-08-17 06:40:00');

-- ------------------------------------------------------------
-- trusted_circle
-- Contacts added on the "Trusted circle" page — who gets
-- notified on SOS / safe-walk timeout.
-- ------------------------------------------------------------
CREATE TABLE trusted_circle (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED   NOT NULL,
  name        VARCHAR(120)   NOT NULL,
  relation    VARCHAR(60)    NULL,
  phone       VARCHAR(30)    NOT NULL,
  created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_circle_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO trusted_circle (user_id, name, relation, phone) VALUES
(1, 'Jide Taiwo', 'Brother',  '080 123 4567'),
(1, 'Maya Bello', 'Neighbor', '080 234 5678'),
(1, 'David Kalu', 'Friend',   '080 345 6789');

-- ------------------------------------------------------------
-- user_settings
-- One row per user — accent/theme, notification toggles, and
-- radius from the settings page. 1:1 with users.
-- ------------------------------------------------------------
CREATE TABLE user_settings (
  user_id           INT UNSIGNED PRIMARY KEY,
  accent_color      ENUM('emerald','azure','amber','violet','rose')      NOT NULL DEFAULT 'emerald',
  background_theme  ENUM('midnight','charcoal','navy','forest')          NOT NULL DEFAULT 'midnight',
  push_alerts       TINYINT(1)                                           NOT NULL DEFAULT 1,
  email_digest      TINYINT(1)                                           NOT NULL DEFAULT 0,
  sms_emergency     TINYINT(1)                                           NOT NULL DEFAULT 1,
  scan_radius_km    DECIMAL(3,1)                                         NOT NULL DEFAULT 0.8,
  auto_checkin      TINYINT(1)                                           NOT NULL DEFAULT 1,
  share_location    TINYINT(1)                                           NOT NULL DEFAULT 1,
  units             ENUM('km','mi')                                      NOT NULL DEFAULT 'km',
  language          VARCHAR(40)                                          NOT NULL DEFAULT 'English',
  CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO user_settings (user_id, accent_color, background_theme, push_alerts, email_digest, sms_emergency, scan_radius_km, auto_checkin, share_location, units, language) VALUES
(1, 'emerald', 'midnight', 1, 0, 1, 0.8, 1, 1, 'km', 'English'),
(2, 'azure',   'navy',     1, 1, 1, 1.2, 0, 1, 'km', 'English'),
(3, 'amber',   'charcoal', 1, 0, 0, 0.5, 1, 0, 'km', 'English');

-- ------------------------------------------------------------
-- safe_walk_sessions
-- One row per "Start walk" / "End walk" cycle from the safe
-- walk timer panel.
-- ------------------------------------------------------------
CREATE TABLE safe_walk_sessions (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id           INT UNSIGNED                                       NOT NULL,
  duration_seconds  INT UNSIGNED                                       NOT NULL,
  status            ENUM('active','completed','timed_out','cancelled') NOT NULL DEFAULT 'active',
  started_at        DATETIME                                           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at          DATETIME                                           NULL,
  CONSTRAINT fk_walk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO safe_walk_sessions (user_id, duration_seconds, status, started_at, ended_at) VALUES
(1, 900,  'completed', '2026-08-16 21:00:00', '2026-08-16 21:15:00'),
(1, 1200, 'timed_out', '2026-08-14 22:30:00', '2026-08-14 22:50:00'),
(2, 600,  'cancelled', '2026-08-15 07:45:00', '2026-08-15 07:47:00');

-- ------------------------------------------------------------
-- sos_events
-- One row per press-and-hold SOS trigger from the home page.
-- ------------------------------------------------------------
CREATE TABLE sos_events (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED                                 NOT NULL,
  latitude     DECIMAL(9,6)                                 NULL,
  longitude    DECIMAL(9,6)                                 NULL,
  status       ENUM('sent','acknowledged','resolved')       NOT NULL DEFAULT 'sent',
  created_at   DATETIME                                     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at  DATETIME                                     NULL,
  CONSTRAINT fk_sos_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO sos_events (user_id, latitude, longitude, status, created_at, resolved_at) VALUES
(1, 6.4531, 3.4483, 'resolved', '2026-08-10 20:12:00', '2026-08-10 20:40:00'),
(2, 6.4281, 3.4210, 'sent',     '2026-08-17 08:02:00', NULL);

-- ------------------------------------------------------------
-- safety_checks
-- One row per "Check a destination" lookup on the home/alerts
-- page (the caution / clear-to-go result card).
-- ------------------------------------------------------------
CREATE TABLE safety_checks (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED                    NOT NULL,
  location    VARCHAR(160)                    NOT NULL,
  result      ENUM('clear','caution')         NOT NULL,
  summary     VARCHAR(255)                    NULL,
  checked_at  DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_check_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO safety_checks (user_id, location, result, summary, checked_at) VALUES
(1, 'Chevron Drive',        'caution', 'A report was flagged along this route in the last few hours.', '2026-08-17 07:58:00'),
(1, 'Admiralty Way',        'clear',   'No incidents reported on the route to Admiralty Way.',          '2026-08-16 18:20:00'),
(2, 'Ligali Ayorinde St',   'caution', '2 unresolved reports within 1km in the last 6 hours.',          '2026-08-17 06:35:00');
