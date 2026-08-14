-- ============================================================
-- TERREX — schema.sql (MySQL 8+)
--
-- Note: I didn't have access to your original "things my app
-- needs to store" list in this conversation, so these tables are
-- built directly from what App.jsx actually stores/renders:
--   - alerts + user-submitted reports (ReportPage) -> one unified
--     `reports` table, since a submitted report IS an alert once
--     published (same shape: title, severity, distance, time, note)
--   - trusted circle contacts (CirclePage / MOCK_CIRCLE)
--   - per-user app settings (MOCK_SETTINGS)
-- If your real list differs, tell me and I'll adjust.
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

-- ------------------------------------------------------------
-- users
-- ------------------------------------------------------------
CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(150) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO users (full_name, email, password_hash, created_at) VALUES
  ('Amaka Obi',   'amaka@example.com',  '$2b$12$9f8a2f0d1c3b4e5a6d7c8b9e0OqQvXWZk1LmNoPqRsTuVwXyZ01a', '2025-01-14 09:12:00'),
  ('Jide Taiwo',  'jide@example.com',   '$2b$12$4c1a9e2b3d4f5061728394A5b6c7d8e9f0g1h2i3j4k5l6m7n8o9', '2025-02-02 18:30:00'),
  ('Maya Bello',  'maya@example.com',   '$2b$12$1a2b3c4d5e6f708192a3b4C5d6e7f8091a2b3c4d5e6f708192a3b', '2025-03-20 07:45:00');

-- ------------------------------------------------------------
-- reports  (submitted incidents; also the source for the public
-- alerts feed shown on the Home/Alerts pages)
-- ------------------------------------------------------------
CREATE TABLE reports (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NULL,                                -- NULL = anonymous (default per app copy)
  is_anonymous  TINYINT(1) NOT NULL DEFAULT 1,
  title         VARCHAR(200) NOT NULL,
  category      ENUM('Suspicious activity','Theft','Accident','Fire',
                      'Medical emergency','Infrastructure','Other') NOT NULL,
  severity      ENUM('warning','critical') NOT NULL,
  status        ENUM('active','resolved') NOT NULL DEFAULT 'active',
  location_text VARCHAR(255) NOT NULL,     -- e.g. "Chevron Drive, near the roundabout"
  latitude      DECIMAL(9,6) NULL,
  longitude     DECIMAL(9,6) NULL,
  distance_km   DECIMAL(6,2) NULL,         -- distance from viewing user at time of display
  description   TEXT NOT NULL,
  note          VARCHAR(255) NULL,         -- e.g. "Unconfirmed", "Resolved by residents"
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at   DATETIME NULL,
  CONSTRAINT fk_reports_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO reports (user_id, is_anonymous, title, category, severity, status, location_text, distance_km, description, note, created_at, resolved_at) VALUES
  (NULL, 1, 'Attempted break-in reported', 'Suspicious activity', 'critical', 'active',   'Chevron Drive, near the roundabout', 0.4, 'Neighbor saw someone trying a side gate around 2am.', 'Unconfirmed',           '2025-08-14 08:50:00', NULL),
  (2,    0, 'Suspicious loitering',        'Suspicious activity', 'warning',  'active',   'Behind the estate playground',       0.6, 'Two people sitting in a parked car for over an hour.', NULL,                   '2025-08-14 08:15:00', NULL),
  (3,    0, 'Road blocked — fallen tree',  'Infrastructure',      'warning',  'active',   'Aba Road junction',                  0.9, 'Storm brought down a large tree, blocking one lane.',  NULL,                   '2025-08-14 06:00:00', NULL),
  (1,    0, 'Petty theft',                 'Theft',               'warning',  'resolved', 'Market Street car park',             1.2, 'Phone snatched from an open car window.',              'Resolved by residents', '2025-08-13 09:00:00', '2025-08-13 15:00:00'),
  (NULL, 1, 'False alarm — car alarm',     'Accident',            'warning',  'resolved', 'Close to the estate gate',            0.3, 'Car alarm going off, turned out to be a low battery.', NULL,                   '2025-08-12 09:00:00', '2025-08-12 09:40:00');

-- ------------------------------------------------------------
-- trusted_circle  (each user's emergency contacts, from CirclePage)
-- ------------------------------------------------------------
CREATE TABLE trusted_circle (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,     -- owner of the circle
  contact_name  VARCHAR(150) NOT NULL,
  relation      VARCHAR(80) NOT NULL,      -- e.g. "Brother", "Neighbor", "Friend"
  phone         VARCHAR(30) NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_circle_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO trusted_circle (user_id, contact_name, relation, phone, created_at) VALUES
  (1, 'Jide Taiwo', 'Brother',  '080 123 4567', '2025-01-15 10:00:00'),
  (1, 'Maya Bello', 'Neighbor', '080 234 5678', '2025-01-20 10:00:00'),
  (1, 'David Kalu', 'Friend',   '080 345 6789', '2025-02-01 10:00:00');

-- ------------------------------------------------------------
-- settings  (one row per user, from MOCK_SETTINGS)
-- ------------------------------------------------------------
CREATE TABLE settings (
  user_id          INT UNSIGNED PRIMARY KEY,
  accent_color     ENUM('emerald','azure','amber','violet','rose') NOT NULL DEFAULT 'emerald',
  background_theme ENUM('midnight','charcoal','navy','forest') NOT NULL DEFAULT 'midnight',
  push_alerts      TINYINT(1) NOT NULL DEFAULT 1,
  email_digest     TINYINT(1) NOT NULL DEFAULT 0,
  sms_emergency    TINYINT(1) NOT NULL DEFAULT 1,
  scan_radius_km   DECIMAL(4,2) NOT NULL DEFAULT 0.8,
  auto_checkin     TINYINT(1) NOT NULL DEFAULT 1,
  share_location   TINYINT(1) NOT NULL DEFAULT 1,
  units            ENUM('km','mi') NOT NULL DEFAULT 'km',
  language         VARCHAR(50) NOT NULL DEFAULT 'English',
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO settings (user_id, accent_color, background_theme, push_alerts, email_digest, sms_emergency, scan_radius_km, auto_checkin, share_location, units, language) VALUES
  (1, 'emerald', 'midnight', 1, 0, 1, 0.8, 1, 1, 'km', 'English'),
  (2, 'azure',   'navy',     1, 1, 1, 1.2, 0, 1, 'km', 'English'),
  (3, 'amber',   'charcoal', 1, 0, 0, 0.5, 1, 0, 'km', 'English');
