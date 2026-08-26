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
const nodemailer = require('nodemailer');

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
// Email (Nodemailer) — sends both the 6-digit verification
// codes and the danger/update notification emails.
// ------------------------------------------------------------
const mailer = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT || 587),
  secure: Number(process.env.EMAIL_PORT) === 465,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendEmail(to, subject, text, html) {
  await mailer.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to,
    subject,
    text,
    html: html || `<p>${text}</p>`,
  });
}

async function sendVerificationEmail(to, code) {
  await sendEmail(
    to,
    'Your TERREX verification code',
    `Your verification code is ${code}. It expires in 10 minutes.`,
    `<p>Your verification code is <b>${code}</b>.</p><p>It expires in 10 minutes.</p>`
  );
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

async function issueVerificationCode(userId, email, purpose) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    .toISOString().slice(0, 19).replace('T', ' ');
  await pool.query(
    'INSERT INTO verification_codes (user_id, code, purpose, expires_at) VALUES (?, ?, ?, ?)',
    [userId, code, purpose, expiresAt]
  );
  await sendVerificationEmail(email, code);
}

// Emails a notification to one user, or to every user when userId is
// omitted (broadcast — e.g. a new community alert). Always logs the
// send to the notifications table, even if the email itself fails.
async function sendNotificationEmail({ userId = null, title, body, type = 'update' }) {
  await pool.query(
    'INSERT INTO notifications (user_id, title, body, type) VALUES (?, ?, ?, ?)',
    [userId, title, body, type]
  );

  const [rows] = userId
    ? await pool.query('SELECT email FROM users WHERE id = ?', [userId])
    : await pool.query('SELECT email FROM users');

  const recipients = rows.map((r) => r.email);
  let sent = 0;
  for (const to of recipients) {
    try {
      await sendEmail(to, title, body);
      sent++;
    } catch (err) {
      console.error(`Failed to email ${to}:`, err.message);
    }
  }
  return { sent, total: recipients.length };
}

// ------------------------------------------------------------
// Admin auth — single shared password from env, random token
// issued on login and held in memory. No user table for admins;
// this is a simple gate, not a full auth system.
// ------------------------------------------------------------
const adminTokens = new Set();

function requireAdmin(req, res, next) {
  const headerToken = req.headers['x-admin-token'];
  const bearerHeader = req.headers.authorization || '';
  const bearerToken = bearerHeader.startsWith('Bearer ') ? bearerHeader.slice(7) : null;
  const token = headerToken || bearerToken;
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
// User register / login / verify
// Both register and login now stop short of returning the user —
// they email a 6-digit code first. POST /api/verify-code is the
// step that actually completes sign-up or sign-in.
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

    await issueVerificationCode(result.insertId, email, 'register');
    res.status(201).json({
      user_id: result.insertId,
      email,
      message: 'Verification code sent to your email.',
    });
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

    await issueVerificationCode(user.id, user.email, 'login');
    res.json({
      user_id: user.id,
      email: user.email,
      message: 'Verification code sent to your email.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/verify-code', async (req, res) => {
  try {
    const { user_id, code } = req.body || {};
    if (!user_id || !code) {
      return res.status(400).json({ error: 'user_id and code are required' });
    }

    const [rows] = await pool.query(
      `SELECT * FROM verification_codes
       WHERE user_id = ? AND code = ? AND used = 0 AND expires_at >= NOW()
       ORDER BY id DESC LIMIT 1`,
      [user_id, code]
    );
    const record = rows[0];
    if (!record) {
      return res.status(400).json({ error: 'Code is incorrect or has expired' });
    }

    await pool.query('UPDATE verification_codes SET used = 1 WHERE id = ?', [record.id]);
    await pool.query('UPDATE users SET email_verified = 1 WHERE id = ?', [user_id]);

    const [userRows] = await pool.query('SELECT * FROM users WHERE id = ?', [user_id]);
    const { password_hash, ...safeUser } = userRows[0];
    res.json(safeUser);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

app.post('/api/resend-code', async (req, res) => {
  try {
    const { user_id, purpose } = req.body || {};
    if (!user_id || !purpose) {
      return res.status(400).json({ error: 'user_id and purpose are required' });
    }
    const [userRows] = await pool.query('SELECT id, email FROM users WHERE id = ?', [user_id]);
    if (!userRows.length) return res.status(404).json({ error: 'User not found' });

    await pool.query('UPDATE verification_codes SET used = 1 WHERE user_id = ? AND used = 0', [user_id]);
    await issueVerificationCode(user_id, userRows[0].email, purpose);
    res.json({ message: 'A new code has been sent to your email.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not resend code' });
  }
});

// ------------------------------------------------------------
// Admin-only user management (list/edit/delete; create goes
// through /api/register so passwords are always hashed there).
// ------------------------------------------------------------
app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, full_name, email, email_verified, created_at FROM users ORDER BY id DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, full_name, email, email_verified, created_at FROM users WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  try {
    const { full_name, email, password } = req.body || {};
    if (!full_name || !email || !password) {
      return res.status(400).json({ error: 'full_name, email, and password are required' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)',
      [full_name, email, password_hash]
    );
    res.status(201).json({ id: result.insertId, full_name, email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const { full_name, email, password } = req.body || {};
    const sets = [];
    const values = [];
    if (full_name !== undefined) { sets.push('full_name = ?'); values.push(full_name); }
    if (email !== undefined) { sets.push('email = ?'); values.push(email); }
    if (password) { sets.push('password_hash = ?'); values.push(await bcrypt.hash(password, 10)); }
    if (!sets.length) return res.status(400).json({ error: 'No valid fields to update' });

    values.push(req.params.id);
    const [result] = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);
    if (!result.affectedRows) return res.status(404).json({ error: 'User not found' });
    res.json({ id: Number(req.params.id), full_name, email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'User not found' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ------------------------------------------------------------
// Notifications (email)
// ------------------------------------------------------------

// Admin-only: email a one-off notification (e.g. "new app update
// available"). Omit user_id to email every registered user.
app.post('/api/notifications/send', requireAdmin, async (req, res) => {
  try {
    const { user_id, title, body, type } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
    const result = await sendNotificationEmail({ userId: user_id || null, title, body, type });
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

app.get('/api/notifications', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM notifications ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ------------------------------------------------------------
// Generic CRUD factory for the remaining tables.
// GET (list + single) is public. POST/PUT/DELETE require the
// admin token from /api/admin/login.
// ------------------------------------------------------------
function registerTableRoutes({ path, table, columns, afterCreate }) {
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
      const row = { id: result.insertId, ...req.body };
      if (afterCreate) await afterCreate(row);
      res.status(201).json(row);
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
  // New community alerts email every registered user a danger notice.
  afterCreate: (row) =>
    sendNotificationEmail({
      title: row.title,
      body: row.note || `${row.severity} alert reported ${row.distance_km ?? '?'}km away`,
      type: 'danger',
    }),
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
