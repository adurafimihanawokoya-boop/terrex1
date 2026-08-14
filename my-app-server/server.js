// ============================================================
// TERREX — server.js
// Express + mysql2 API matching schema.sql (users, reports,
// trusted_circle, settings).
//
// Auth model:
//   - Users register/login with bcryptjs-hashed passwords.
//   - There's a public GET route for every table other than
//     `users` (reports, trusted_circle, settings).
//   - An admin logs in with a single password from
//     ADMIN_PASSWORD (env var) and gets back a random token.
//     That token must be sent as `x-admin-token` on every
//     POST/PUT/DELETE route, across ALL tables (including users).
//   - Admin tokens are kept in memory only — they reset if the
//     server restarts. Fine for a small admin panel, not meant
//     to replace a real auth system for production use.
// ============================================================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------------------------------------------
// Database pool
// ------------------------------------------------------------
const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "terrex",
  waitForConnections: true,
  connectionLimit: 10,
});

// ------------------------------------------------------------
// Admin token store (in-memory)
// ------------------------------------------------------------
const adminTokens = new Set();

function requireAdmin(req, res, next) {
  const token = req.header("x-admin-token");
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: "Missing or invalid admin token" });
  }
  next();
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function stripPassword(user) {
  if (!user) return user;
  const { password_hash, ...rest } = user;
  return rest;
}

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// ============================================================
// USER REGISTER / LOGIN
// ============================================================

app.post(
  "/api/register",
  asyncRoute(async (req, res) => {
    const { full_name, email, password } = req.body;

    if (!full_name || !email || !password) {
      return res
        .status(400)
        .json({ error: "full_name, email, and password are required" });
    }

    const [existing] = await pool.execute(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: "Email is already registered" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const [result] = await pool.execute(
      "INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)",
      [full_name, email, password_hash]
    );

    const [rows] = await pool.execute("SELECT * FROM users WHERE id = ?", [
      result.insertId,
    ]);

    res.status(201).json(stripPassword(rows[0]));
  })
);

app.post(
  "/api/login",
  asyncRoute(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const [rows] = await pool.execute("SELECT * FROM users WHERE email = ?", [
      email,
    ]);
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    res.json(stripPassword(user));
  })
);

// ============================================================
// ADMIN LOGIN
// ============================================================

app.post(
  "/api/admin/login",
  asyncRoute(async (req, res) => {
    const { password } = req.body;

    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Invalid admin password" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    adminTokens.add(token);

    res.json({ token });
  })
);

// (optional) admin logout — invalidates the token
app.post("/api/admin/logout", requireAdmin, (req, res) => {
  adminTokens.delete(req.header("x-admin-token"));
  res.json({ ok: true });
});

// ============================================================
// USERS  (admin-only write access; no public GET/list — the
// table holds password hashes)
// ============================================================

app.get(
  "/api/admin/users",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const [rows] = await pool.execute(
      "SELECT id, full_name, email, created_at FROM users ORDER BY id"
    );
    res.json(rows);
  })
);

app.put(
  "/api/admin/users/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { full_name, email } = req.body;
    const [result] = await pool.execute(
      "UPDATE users SET full_name = COALESCE(?, full_name), email = COALESCE(?, email) WHERE id = ?",
      [full_name || null, email || null, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const [rows] = await pool.execute(
      "SELECT id, full_name, email, created_at FROM users WHERE id = ?",
      [req.params.id]
    );
    res.json(rows[0]);
  })
);

app.delete(
  "/api/admin/users/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const [result] = await pool.execute("DELETE FROM users WHERE id = ?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.status(204).end();
  })
);

// ============================================================
// REPORTS  (public GET, admin-only write)
// ============================================================

app.get(
  "/api/reports",
  asyncRoute(async (req, res) => {
    const [rows] = await pool.execute(
      "SELECT * FROM reports ORDER BY created_at DESC"
    );
    res.json(rows);
  })
);

app.get(
  "/api/reports/:id",
  asyncRoute(async (req, res) => {
    const [rows] = await pool.execute("SELECT * FROM reports WHERE id = ?", [
      req.params.id,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Report not found" });
    }
    res.json(rows[0]);
  })
);

app.post(
  "/api/admin/reports",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const {
      user_id = null,
      is_anonymous = 1,
      title,
      category,
      severity,
      status = "active",
      location_text,
      latitude = null,
      longitude = null,
      distance_km = null,
      description,
      note = null,
    } = req.body;

    if (!title || !category || !severity || !location_text || !description) {
      return res.status(400).json({
        error:
          "title, category, severity, location_text, and description are required",
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO reports
        (user_id, is_anonymous, title, category, severity, status, location_text, latitude, longitude, distance_km, description, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        is_anonymous,
        title,
        category,
        severity,
        status,
        location_text,
        latitude,
        longitude,
        distance_km,
        description,
        note,
      ]
    );

    const [rows] = await pool.execute("SELECT * FROM reports WHERE id = ?", [
      result.insertId,
    ]);
    res.status(201).json(rows[0]);
  })
);

app.put(
  "/api/admin/reports/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const fields = [
      "user_id",
      "is_anonymous",
      "title",
      "category",
      "severity",
      "status",
      "location_text",
      "latitude",
      "longitude",
      "distance_km",
      "description",
      "note",
      "resolved_at",
    ];
    const updates = [];
    const values = [];
    for (const field of fields) {
      if (field in req.body) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }
    values.push(req.params.id);

    const [result] = await pool.execute(
      `UPDATE reports SET ${updates.join(", ")} WHERE id = ?`,
      values
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Report not found" });
    }
    const [rows] = await pool.execute("SELECT * FROM reports WHERE id = ?", [
      req.params.id,
    ]);
    res.json(rows[0]);
  })
);

app.delete(
  "/api/admin/reports/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const [result] = await pool.execute("DELETE FROM reports WHERE id = ?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Report not found" });
    }
    res.status(204).end();
  })
);

// ============================================================
// TRUSTED_CIRCLE  (public GET, admin-only write)
// ============================================================

app.get(
  "/api/trusted_circle",
  asyncRoute(async (req, res) => {
    const [rows] = await pool.execute(
      "SELECT * FROM trusted_circle ORDER BY id"
    );
    res.json(rows);
  })
);

app.get(
  "/api/trusted_circle/:id",
  asyncRoute(async (req, res) => {
    const [rows] = await pool.execute(
      "SELECT * FROM trusted_circle WHERE id = ?",
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Contact not found" });
    }
    res.json(rows[0]);
  })
);

app.post(
  "/api/admin/trusted_circle",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { user_id, contact_name, relation, phone } = req.body;
    if (!user_id || !contact_name || !relation || !phone) {
      return res.status(400).json({
        error: "user_id, contact_name, relation, and phone are required",
      });
    }
    const [result] = await pool.execute(
      "INSERT INTO trusted_circle (user_id, contact_name, relation, phone) VALUES (?, ?, ?, ?)",
      [user_id, contact_name, relation, phone]
    );
    const [rows] = await pool.execute(
      "SELECT * FROM trusted_circle WHERE id = ?",
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  "/api/admin/trusted_circle/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const fields = ["user_id", "contact_name", "relation", "phone"];
    const updates = [];
    const values = [];
    for (const field of fields) {
      if (field in req.body) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }
    values.push(req.params.id);

    const [result] = await pool.execute(
      `UPDATE trusted_circle SET ${updates.join(", ")} WHERE id = ?`,
      values
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Contact not found" });
    }
    const [rows] = await pool.execute(
      "SELECT * FROM trusted_circle WHERE id = ?",
      [req.params.id]
    );
    res.json(rows[0]);
  })
);

app.delete(
  "/api/admin/trusted_circle/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const [result] = await pool.execute(
      "DELETE FROM trusted_circle WHERE id = ?",
      [req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Contact not found" });
    }
    res.status(204).end();
  })
);

// ============================================================
// SETTINGS  (public GET, admin-only write; PK is user_id)
// ============================================================

app.get(
  "/api/settings",
  asyncRoute(async (req, res) => {
    const [rows] = await pool.execute("SELECT * FROM settings ORDER BY user_id");
    res.json(rows);
  })
);

app.get(
  "/api/settings/:user_id",
  asyncRoute(async (req, res) => {
    const [rows] = await pool.execute(
      "SELECT * FROM settings WHERE user_id = ?",
      [req.params.user_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Settings not found for that user" });
    }
    res.json(rows[0]);
  })
);

app.post(
  "/api/admin/settings",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const {
      user_id,
      accent_color = "emerald",
      background_theme = "midnight",
      push_alerts = 1,
      email_digest = 0,
      sms_emergency = 1,
      scan_radius_km = 0.8,
      auto_checkin = 1,
      share_location = 1,
      units = "km",
      language = "English",
    } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }

    await pool.execute(
      `INSERT INTO settings
        (user_id, accent_color, background_theme, push_alerts, email_digest, sms_emergency, scan_radius_km, auto_checkin, share_location, units, language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        accent_color,
        background_theme,
        push_alerts,
        email_digest,
        sms_emergency,
        scan_radius_km,
        auto_checkin,
        share_location,
        units,
        language,
      ]
    );

    const [rows] = await pool.execute(
      "SELECT * FROM settings WHERE user_id = ?",
      [user_id]
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  "/api/admin/settings/:user_id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const fields = [
      "accent_color",
      "background_theme",
      "push_alerts",
      "email_digest",
      "sms_emergency",
      "scan_radius_km",
      "auto_checkin",
      "share_location",
      "units",
      "language",
    ];
    const updates = [];
    const values = [];
    for (const field of fields) {
      if (field in req.body) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }
    values.push(req.params.user_id);

    const [result] = await pool.execute(
      `UPDATE settings SET ${updates.join(", ")} WHERE user_id = ?`,
      values
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Settings not found for that user" });
    }
    const [rows] = await pool.execute(
      "SELECT * FROM settings WHERE user_id = ?",
      [req.params.user_id]
    );
    res.json(rows[0]);
  })
);

app.delete(
  "/api/admin/settings/:user_id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const [result] = await pool.execute(
      "DELETE FROM settings WHERE user_id = ?",
      [req.params.user_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Settings not found for that user" });
    }
    res.status(204).end();
  })
);

// ============================================================
// Health check + error handling
// ============================================================

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TERREX API listening on port ${PORT}`);
});
