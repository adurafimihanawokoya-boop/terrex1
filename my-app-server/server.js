// ============================================================
// TERREX (SkyGuard) — Express API server
// Matches schema.sql: users, alerts, reports, trusted_circle,
// user_settings, safe_walk_sessions, sos_events, safety_checks
// ============================================================

require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors()); // allows requests from your React app's origin (e.g. localhost:3000)
app.use(express.json());

// ------------------------------------------------------------
// DB pool
// ------------------------------------------------------------
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

// ------------------------------------------------------------
// Admin auth — single shared password from env, random token
// issued on login and held in memory. No user table for admins;
// this is a simple gate, not a full auth system.
// ------------------------------------------------------------
const adminTokens = new Set();

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: 'Admin token missing or invalid' });
  }
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.add(token);
  res.json({ token });
});

// ------------------------------------------------------------
// User register / login
// ------------------------------------------------------------
app.post('/api/register', async (req, res) => {
  try {
    const { full_name, email, password } = req.body || {};
    if (!full_name || !email || !password) {
      return res.status(400).json({ error: 'full_name, email, and password are required' });
    }

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)',
      [full_name, email, password_hash]
    );

    res.status(201).json({ id: result.insertId, full_name, email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Email or password is incorrect' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Email or password is incorrect' });
    }

    const { password_hash, ...safeUser } = user;
    res.json(safeUser);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ------------------------------------------------------------
// Generic CRUD factory for the remaining tables.
// GET (list + single) is public. POST/PUT/DELETE require the
// admin token from /api/admin/login.
// ------------------------------------------------------------
function registerTableRoutes({ path, table, columns }) {
  const router = express.Router();

  // GET all
  router.get('/', async (req, res) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM ${table} ORDER BY id DESC`);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `Failed to fetch ${table}` });
    }
  });

  // GET one
  router.get('/:id', async (req, res) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: `${table} row not found` });
      res.json(rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `Failed to fetch ${table}` });
    }
  });

  // POST create (admin only)
  router.post('/', requireAdmin, async (req, res) => {
    try {
      const values = columns.map((col) => req.body[col] ?? null);
      const placeholders = columns.map(() => '?').join(', ');
      const [result] = await pool.query(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
        values
      );
      res.status(201).json({ id: result.insertId, ...req.body });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `Failed to create ${table} row` });
    }
  });

  // PUT update (admin only)
  router.put('/:id', requireAdmin, async (req, res) => {
    try {
      const updateCols = columns.filter((col) => req.body[col] !== undefined);
      if (!updateCols.length) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }
      const setClause = updateCols.map((col) => `${col} = ?`).join(', ');
      const values = updateCols.map((col) => req.body[col]);
      const [result] = await pool.query(
        `UPDATE ${table} SET ${setClause} WHERE id = ?`,
        [...values, req.params.id]
      );
      if (!result.affectedRows) return res.status(404).json({ error: `${table} row not found` });
      res.json({ id: Number(req.params.id), ...req.body });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `Failed to update ${table} row` });
    }
  });

  // DELETE (admin only)
  router.delete('/:id', requireAdmin, async (req, res) => {
    try {
      const [result] = await pool.query(`DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
      if (!result.affectedRows) return res.status(404).json({ error: `${table} row not found` });
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `Failed to delete ${table} row` });
    }
  });

  app.use(path, router);
}

// user_settings is keyed by user_id (not id), so it gets its own
// small route set instead of the generic factory above.
const userSettingsRouter = express.Router();

userSettingsRouter.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM user_settings');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user_settings' });
  }
});

userSettingsRouter.get('/:user_id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM user_settings WHERE user_id = ?', [req.params.user_id]);
    if (!rows.length) return res.status(404).json({ error: 'user_settings row not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user_settings' });
  }
});

const SETTINGS_COLUMNS = [
  'user_id', 'accent_color', 'background_theme', 'push_alerts', 'email_digest',
  'sms_emergency', 'scan_radius_km', 'auto_checkin', 'share_location', 'units', 'language',
];

userSettingsRouter.post('/', requireAdmin, async (req, res) => {
  try {
    const values = SETTINGS_COLUMNS.map((col) => req.body[col] ?? null);
    const placeholders = SETTINGS_COLUMNS.map(() => '?').join(', ');
    await pool.query(
      `INSERT INTO user_settings (${SETTINGS_COLUMNS.join(', ')}) VALUES (${placeholders})`,
      values
    );
    res.status(201).json(req.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create user_settings row' });
  }
});

userSettingsRouter.put('/:user_id', requireAdmin, async (req, res) => {
  try {
    const updateCols = SETTINGS_COLUMNS.filter((col) => col !== 'user_id' && req.body[col] !== undefined);
    if (!updateCols.length) return res.status(400).json({ error: 'No valid fields to update' });
    const setClause = updateCols.map((col) => `${col} = ?`).join(', ');
    const values = updateCols.map((col) => req.body[col]);
    const [result] = await pool.query(
      `UPDATE user_settings SET ${setClause} WHERE user_id = ?`,
      [...values, req.params.user_id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'user_settings row not found' });
    res.json({ user_id: Number(req.params.user_id), ...req.body });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user_settings row' });
  }
});

userSettingsRouter.delete('/:user_id', requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM user_settings WHERE user_id = ?', [req.params.user_id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'user_settings row not found' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user_settings row' });
  }
});

app.use('/api/user-settings', userSettingsRouter);

// ------------------------------------------------------------
// Register the standard id-keyed tables
// ------------------------------------------------------------
registerTableRoutes({
  path: '/api/alerts',
  table: 'alerts',
  columns: ['title', 'severity', 'distance_km', 'note', 'reported_at'],
});

registerTableRoutes({
  path: '/api/reports',
  table: 'reports',
  columns: ['user_id', 'category', 'location', 'description', 'severity', 'status'],
});

registerTableRoutes({
  path: '/api/trusted-circle',
  table: 'trusted_circle',
  columns: ['user_id', 'name', 'relation', 'phone'],
});

registerTableRoutes({
  path: '/api/safe-walk-sessions',
  table: 'safe_walk_sessions',
  columns: ['user_id', 'duration_seconds', 'status', 'started_at', 'ended_at'],
});

registerTableRoutes({
  path: '/api/sos-events',
  table: 'sos_events',
  columns: ['user_id', 'latitude', 'longitude', 'status', 'resolved_at'],
});

registerTableRoutes({
  path: '/api/safety-checks',
  table: 'safety_checks',
  columns: ['user_id', 'location', 'result', 'summary'],
});

// ------------------------------------------------------------
// Health check + startup
// ------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`TERREX API listening on port ${PORT}`);
});
