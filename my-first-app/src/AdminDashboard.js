import { useState, useEffect, useCallback } from "react";

/* ============================================================
   TERREX — Admin Dashboard
   Password-only login (POST /api/admin/login), then one tab per
   table in schema.sql. Every write sends the token back in an
   "x-admin-token" header, matching server.js's requireAdmin check.
   ============================================================ */

const API_BASE = "http://localhost:4000/api";

async function adminFetch(token, path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-admin-token": token } : {}),
      ...(options.headers || {}),
    },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // DELETE returns 204 with no body
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

/* ---------------------------- table configs ---------------------------- */
/* idField defaults to "id"; user_settings is keyed by user_id instead. */

const TABLES = [
  {
    key: "users",
    label: "Users",
    endpoint: "/users",
    idField: "id",
    fields: [
      { name: "full_name", label: "Full name", type: "text", required: true },
      { name: "email", label: "Email", type: "text", required: true },
      { name: "password", label: "Password", type: "password", required: (isEdit) => !isEdit, hint: "Leave blank to keep the current password when editing" },
    ],
    columns: ["id", "full_name", "email", "created_at"],
  },
  {
    key: "alerts",
    label: "Alerts",
    endpoint: "/alerts",
    idField: "id",
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "severity", label: "Severity", type: "select", options: ["critical", "warning", "resolved"], required: true },
      { name: "distance_km", label: "Distance (km)", type: "number", step: "0.1" },
      { name: "note", label: "Note", type: "text" },
      { name: "reported_at", label: "Reported at", type: "datetime-local", required: true },
    ],
    columns: ["id", "title", "severity", "distance_km", "reported_at"],
  },
  {
    key: "reports",
    label: "Reports",
    endpoint: "/reports",
    idField: "id",
    fields: [
      { name: "user_id", label: "User ID", type: "number", required: true },
      {
        name: "category", label: "Category", type: "select", required: true,
        options: ["Suspicious activity", "Theft", "Accident", "Fire", "Medical emergency", "Infrastructure", "Other"],
      },
      { name: "location", label: "Location", type: "text", required: true },
      { name: "description", label: "Description", type: "textarea" },
      { name: "severity", label: "Severity", type: "select", options: ["warning", "critical"], required: true },
      { name: "status", label: "Status", type: "select", options: ["submitted", "reviewing", "resolved"], required: true },
    ],
    columns: ["id", "user_id", "category", "location", "severity", "status"],
  },
  {
    key: "trusted_circle",
    label: "Trusted Circle",
    endpoint: "/trusted-circle",
    idField: "id",
    fields: [
      { name: "user_id", label: "User ID", type: "number", required: true },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "relation", label: "Relation", type: "text" },
      { name: "phone", label: "Phone", type: "text", required: true },
    ],
    columns: ["id", "user_id", "name", "relation", "phone"],
  },
  {
    key: "user_settings",
    label: "User Settings",
    endpoint: "/user-settings",
    idField: "user_id",
    fields: [
      { name: "user_id", label: "User ID", type: "number", required: true, lockOnEdit: true },
      { name: "accent_color", label: "Accent color", type: "select", options: ["emerald", "azure", "amber", "violet", "rose"] },
      { name: "background_theme", label: "Background theme", type: "select", options: ["midnight", "charcoal", "navy", "forest"] },
      { name: "push_alerts", label: "Push alerts", type: "checkbox" },
      { name: "email_digest", label: "Email digest", type: "checkbox" },
      { name: "sms_emergency", label: "SMS emergency", type: "checkbox" },
      { name: "scan_radius_km", label: "Scan radius (km)", type: "number", step: "0.1" },
      { name: "auto_checkin", label: "Auto check-in", type: "checkbox" },
      { name: "share_location", label: "Share location", type: "checkbox" },
      { name: "units", label: "Units", type: "select", options: ["km", "mi"] },
      { name: "language", label: "Language", type: "text" },
    ],
    columns: ["user_id", "accent_color", "background_theme", "scan_radius_km", "units"],
  },
  {
    key: "safe_walk_sessions",
    label: "Safe Walk Sessions",
    endpoint: "/safe-walk-sessions",
    idField: "id",
    fields: [
      { name: "user_id", label: "User ID", type: "number", required: true },
      { name: "duration_seconds", label: "Duration (seconds)", type: "number", required: true },
      { name: "status", label: "Status", type: "select", options: ["active", "completed", "timed_out", "cancelled"], required: true },
      { name: "started_at", label: "Started at", type: "datetime-local" },
      { name: "ended_at", label: "Ended at", type: "datetime-local" },
    ],
    columns: ["id", "user_id", "duration_seconds", "status", "started_at", "ended_at"],
  },
  {
    key: "sos_events",
    label: "SOS Events",
    endpoint: "/sos-events",
    idField: "id",
    fields: [
      { name: "user_id", label: "User ID", type: "number", required: true },
      { name: "latitude", label: "Latitude", type: "number", step: "0.000001" },
      { name: "longitude", label: "Longitude", type: "number", step: "0.000001" },
      { name: "status", label: "Status", type: "select", options: ["sent", "acknowledged", "resolved"], required: true },
      { name: "resolved_at", label: "Resolved at", type: "datetime-local" },
    ],
    columns: ["id", "user_id", "latitude", "longitude", "status", "resolved_at"],
  },
  {
    key: "safety_checks",
    label: "Safety Checks",
    endpoint: "/safety-checks",
    idField: "id",
    fields: [
      { name: "user_id", label: "User ID", type: "number", required: true },
      { name: "location", label: "Location", type: "text", required: true },
      { name: "result", label: "Result", type: "select", options: ["clear", "caution"], required: true },
      { name: "summary", label: "Summary", type: "textarea" },
    ],
    columns: ["id", "user_id", "location", "result", "summary"],
  },
];

/* ---------------------------- login screen ---------------------------- */

function AdminLogin({ onLogin }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await adminFetch(null, "/admin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      onLogin(data.token);
    } catch (err) {
      setError(err.message || "Login failed");
    }
    setLoading(false);
  };

  return (
    <div style={styles.loginWrap}>
      <form style={styles.loginCard} onSubmit={submit}>
        <h1 style={styles.loginTitle}>TERREX Admin</h1>
        <p style={styles.loginSubtitle}>Enter the admin password to continue.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin password"
          style={styles.input}
          autoFocus
        />
        {error && <div style={styles.error}>{error}</div>}
        <button type="submit" style={styles.primaryBtn} disabled={loading || !password}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

/* ---------------------------- record form ---------------------------- */

function RecordForm({ table, initial, onCancel, onSubmit }) {
  const isEdit = !!initial;
  const [values, setValues] = useState(() => {
    const base = {};
    table.fields.forEach((f) => {
      base[f.name] = initial ? initial[f.name] ?? "" : f.type === "checkbox" ? false : "";
    });
    return base;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const setField = (name, val) => setValues((v) => ({ ...v, [name]: val }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const payload = { ...values };
      // Skip sending a blank password on edit — leave the current one alone.
      if ("password" in payload && isEdit && !payload.password) delete payload.password;
      await onSubmit(payload);
    } catch (err) {
      setError(err.message || "Save failed");
    }
    setSaving(false);
  };

  return (
    <form style={styles.formCard} onSubmit={submit}>
      <h3 style={styles.formTitle}>{isEdit ? `Edit ${table.label}` : `Add ${table.label}`}</h3>
      {table.fields.map((f) => {
        const required = typeof f.required === "function" ? f.required(isEdit) : f.required;
        const disabled = isEdit && f.lockOnEdit;
        return (
          <label key={f.name} style={styles.fieldLabel}>
            {f.label}{required ? " *" : ""}
            {f.type === "select" ? (
              <select
                style={styles.input}
                value={values[f.name]}
                required={required}
                disabled={disabled}
                onChange={(e) => setField(f.name, e.target.value)}
              >
                <option value="" disabled>Select…</option>
                {f.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                style={{ ...styles.input, minHeight: 70 }}
                value={values[f.name]}
                required={required}
                onChange={(e) => setField(f.name, e.target.value)}
              />
            ) : f.type === "checkbox" ? (
              <input
                type="checkbox"
                checked={!!values[f.name]}
                onChange={(e) => setField(f.name, e.target.checked)}
                style={{ marginLeft: 8 }}
              />
            ) : (
              <input
                type={f.type}
                step={f.step}
                style={styles.input}
                value={values[f.name]}
                required={required}
                disabled={disabled}
                onChange={(e) => setField(f.name, e.target.value)}
              />
            )}
            {f.hint && <div style={styles.hint}>{f.hint}</div>}
          </label>
        );
      })}
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.formActions}>
        <button type="button" style={styles.secondaryBtn} onClick={onCancel}>Cancel</button>
        <button type="submit" style={styles.primaryBtn} disabled={saving}>
          {saving ? "Saving…" : isEdit ? "Save changes" : "Add"}
        </button>
      </div>
    </form>
  );
}

/* ---------------------------- table panel ---------------------------- */

function TablePanel({ token, table }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingRow, setEditingRow] = useState(null); // null = closed, {} = add, {...row} = edit
  const idField = table.idField || "id";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminFetch(token, table.endpoint);
      setRows(data);
    } catch (err) {
      setError(err.message || "Failed to load");
    }
    setLoading(false);
  }, [token, table.endpoint]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (payload) => {
    await adminFetch(token, table.endpoint, { method: "POST", body: JSON.stringify(payload) });
    setEditingRow(null);
    load();
  };

  const handleUpdate = async (payload) => {
    const id = editingRow[idField];
    await adminFetch(token, `${table.endpoint}/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    setEditingRow(null);
    load();
  };

  const handleDelete = async (row) => {
    const id = row[idField];
    if (!window.confirm(`Delete this ${table.label.toLowerCase()} row?`)) return;
    try {
      await adminFetch(token, `${table.endpoint}/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      alert(err.message || "Delete failed");
    }
  };

  return (
    <div>
      <div style={styles.panelHeader}>
        <h2 style={styles.panelTitle}>{table.label}</h2>
        <button style={styles.primaryBtn} onClick={() => setEditingRow({})}>+ Add</button>
      </div>

      {editingRow !== null && (
        <RecordForm
          table={table}
          initial={Object.keys(editingRow).length ? editingRow : null}
          onCancel={() => setEditingRow(null)}
          onSubmit={Object.keys(editingRow).length ? handleUpdate : handleCreate}
        />
      )}

      {loading && <p style={styles.muted}>Loading…</p>}
      {error && <div style={styles.error}>{error}</div>}

      {!loading && !error && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {table.columns.map((c) => <th key={c} style={styles.th}>{c}</th>)}
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row[idField]}>
                  {table.columns.map((c) => (
                    <td key={c} style={styles.td}>{String(row[c] ?? "")}</td>
                  ))}
                  <td style={styles.td}>
                    <button style={styles.linkBtn} onClick={() => setEditingRow(row)}>Edit</button>
                    <button style={{ ...styles.linkBtn, color: "#f87171" }} onClick={() => handleDelete(row)}>Delete</button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td style={styles.td} colSpan={table.columns.length + 1}>No rows yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------------------- root dashboard ---------------------------- */

export default function AdminDashboard() {
  const [token, setToken] = useState(null);
  const [activeKey, setActiveKey] = useState(TABLES[0].key);

  if (!token) {
    return <AdminLogin onLogin={setToken} />;
  }

  const activeTable = TABLES.find((t) => t.key === activeKey);

  return (
    <div style={styles.shell}>
      <aside style={styles.sidebar}>
        <div style={styles.brand}>TERREX Admin</div>
        <nav>
          {TABLES.map((t) => (
            <button
              key={t.key}
              style={{ ...styles.navItem, ...(t.key === activeKey ? styles.navItemActive : {}) }}
              onClick={() => setActiveKey(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <button style={styles.logoutBtn} onClick={() => setToken(null)}>Log out</button>
      </aside>
      <main style={styles.main}>
        <TablePanel token={token} table={activeTable} />
      </main>
    </div>
  );
}

/* ---------------------------- inline styles ---------------------------- */

const styles = {
  shell: { display: "flex", minHeight: "100vh", background: "#0b0f14", color: "#e5e7eb", fontFamily: "system-ui, sans-serif" },
  sidebar: { width: 220, background: "#0f1620", borderRight: "1px solid #1f2937", padding: 16, display: "flex", flexDirection: "column" },
  brand: { fontWeight: 700, fontSize: 16, marginBottom: 20 },
  navItem: { display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "#9ca3af", padding: "10px 12px", borderRadius: 8, cursor: "pointer", marginBottom: 4, fontSize: 14 },
  navItemActive: { background: "#1f2937", color: "#fff" },
  logoutBtn: { marginTop: "auto", background: "none", border: "1px solid #374151", color: "#9ca3af", padding: "8px 12px", borderRadius: 8, cursor: "pointer" },
  main: { flex: 1, padding: 28, overflowY: "auto" },
  panelHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  panelTitle: { fontSize: 20, margin: 0 },
  muted: { color: "#9ca3af" },
  error: { color: "#f87171", fontSize: 13, margin: "8px 0" },
  tableWrap: { overflowX: "auto", border: "1px solid #1f2937", borderRadius: 10 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #1f2937", color: "#9ca3af", fontWeight: 600, whiteSpace: "nowrap" },
  td: { padding: "10px 12px", borderBottom: "1px solid #161e2b", whiteSpace: "nowrap" },
  linkBtn: { background: "none", border: "none", color: "#60a5fa", cursor: "pointer", marginRight: 12, fontSize: 13, padding: 0 },
  formCard: { background: "#0f1620", border: "1px solid #1f2937", borderRadius: 12, padding: 20, marginBottom: 20, maxWidth: 480 },
  formTitle: { marginTop: 0, marginBottom: 14, fontSize: 16 },
  fieldLabel: { display: "block", fontSize: 13, color: "#9ca3af", marginBottom: 12 },
  hint: { fontSize: 11, color: "#6b7280", marginTop: 4 },
  input: { display: "block", width: "100%", marginTop: 6, padding: "8px 10px", background: "#0b0f14", border: "1px solid #374151", borderRadius: 8, color: "#e5e7eb", fontSize: 14, boxSizing: "border-box" },
  formActions: { display: "flex", gap: 10, marginTop: 6 },
  primaryBtn: { background: "#10b981", border: "none", color: "#04140e", padding: "9px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  secondaryBtn: { background: "none", border: "1px solid #374151", color: "#e5e7eb", padding: "9px 16px", borderRadius: 8, cursor: "pointer", fontSize: 14 },
  loginWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0b0f14" },
  loginCard: { background: "#0f1620", border: "1px solid #1f2937", borderRadius: 14, padding: 32, width: 320, color: "#e5e7eb", fontFamily: "system-ui, sans-serif" },
  loginTitle: { margin: "0 0 4px", fontSize: 20 },
  loginSubtitle: { margin: "0 0 18px", fontSize: 13, color: "#9ca3af" },
};
