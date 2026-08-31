import { useState, useEffect, useRef, useCallback, useMemo, useId } from "react";

/* ============================================================
   TERREX — Live area monitoring
   Full app: auth (login/signup), home, alerts, report,
   trusted circle, profile, and settings pages.
   Single-file React component. Standalone demo — runs entirely
   on local mock data (no backend / server required). Every
   "action" below simulates a small network delay so the UI
   behaves the way it would against a real API.
   ============================================================ */

/* ---------------------------- API layer ---------------------------- */
/* Talks to server.js (Express + MySQL). Auth (/api/login, /api/register)
   is public. Every GET route is public. POST/PUT/DELETE on every other
   table currently requires the admin token from /api/admin/login — this
   app runs as a regular signed-in user, not an admin, so those write
   calls are included below but will 401 until user-scoped write routes
   (or an admin token) are added on the server. */

const API_BASE = "https://terrex-lfoq.onrender.com";

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // some endpoints (e.g. DELETE) return 204 with no body
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

async function apiLogin(email, password) {
  return apiFetch("/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

async function apiRegister(fields) {
  return apiFetch("/register", { method: "POST", body: JSON.stringify(fields) });
}

async function apiVerifyCode(userId, code) {
  return apiFetch("/verify-code", { method: "POST", body: JSON.stringify({ user_id: userId, code }) });
}

async function apiResendCode(userId, purpose) {
  return apiFetch("/resend-code", { method: "POST", body: JSON.stringify({ user_id: userId, purpose }) });
}

// Server user rows only have id/full_name/email/created_at. Fill in the
// extra display fields this UI expects (username, avatar, plan, memberSince).
function mapServerUser(u) {
  if (!u) return u;
  return {
    id: u.id,
    displayName: u.full_name,
    username: u.email.split("@")[0],
    email: u.email,
    avatar: null,
    plan: "Personal plan",
    memberSince: u.created_at
      ? new Date(u.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })
      : "",
  };
}

function timeAgo(dateString) {
  if (!dateString) return "";
  const then = new Date(dateString.replace(" ", "T"));
  const diffMs = Date.now() - then.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/* ---------------------------- helpers ---------------------------- */

function getGreeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function initialsOf(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function formatClock(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const ACCENT_PRESETS = [
  { id: "emerald", label: "Emerald", safe: "#35d28a", safeDim: "rgba(53,210,138,0.14)" },
  { id: "azure", label: "Azure", safe: "#4c8dff", safeDim: "rgba(76,141,255,0.14)" },
  { id: "amber", label: "Amber", safe: "#ffb648", safeDim: "rgba(255,182,72,0.14)" },
  { id: "violet", label: "Violet", safe: "#9b6dff", safeDim: "rgba(155,109,255,0.14)" },
  { id: "rose", label: "Rose", safe: "#ff6d94", safeDim: "rgba(255,109,148,0.14)" },
];

const BG_PRESETS = [
  { id: "midnight", label: "Midnight", bg: "#090d16", bgGrid: "#0d1424", panel: "#121a2e", panelRaised: "#16203a", border: "#212c46" },
  { id: "charcoal", label: "Charcoal", bg: "#0d0e12", bgGrid: "#14151b", panel: "#17181f", panelRaised: "#1d1f28", border: "#2a2c37" },
  { id: "navy", label: "Deep navy", bg: "#050a16", bgGrid: "#0a1226", panel: "#0e1930", panelRaised: "#12203e", border: "#1c2c4d" },
  { id: "forest", label: "Forest", bg: "#0a120e", bgGrid: "#0f1a14", panel: "#131f19", panelRaised: "#182920", border: "#233830" },
];

/* ---------------------------- icon system ---------------------------- */

const ICON_PATHS = {
  home: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  alerts: (
    <>
      <path d="M12 2v3M4.2 6.2l2 2M2 13h3M19 13h3M17.8 8.2l2-2M12 21a2 2 0 0 0 2-2H10a2 2 0 0 0 2 2z" />
      <path d="M6 13c0-4 2.5-6 6-6s6 2 6 6c0 2.5 1 3.5 1 3.5H5S6 15.5 6 13z" />
    </>
  ),
  report: (
    <>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 4.3 2.9 18a1.8 1.8 0 0 0 1.6 2.7h15a1.8 1.8 0 0 0 1.6-2.7L13.7 4.3a1.8 1.8 0 0 0-3.4 0z" />
    </>
  ),
  circle: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M2 20c0-3.3 3.1-6 7-6s7 2.7 7 6" />
      <circle cx="18" cy="8" r="2.4" />
      <path d="M17 14.2c2.8.5 4.5 2.5 5 5.8" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.7 7.7 0 0 0-1.7-1L15 3h-4l-.3 2.5a7.7 7.7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.7 7.7 0 0 0 1.7 1L9 21h4l.3-2.5a7.7 7.7 0 0 0 1.7-1l2.4 1 2-3.4L19.4 13z" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8a2 2 0 0 1 2-2h1.2a2 2 0 0 0 1.66-.9l.68-1.02A2 2 0 0 1 11.2 3h1.6a2 2 0 0 1 1.66.88l.68 1.02A2 2 0 0 0 16.8 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
      <circle cx="12" cy="13" r="3.4" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.9 17.9 0 0 1-3.5 4.5M6.6 6.6C4 8.3 2 12 2 12s3.5 7 10 7a10.3 10.3 0 0 0 4-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  check: <path d="M20 6L9 17l-5-5" />,
  x: (
    <>
      <path d="M18 6L6 18M6 6l12 12" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </>
  ),
  phone: (
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.4 2.1L8.1 9.7a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z" />
  ),
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2.5" />
      <path d="M2 6l10 7 10-7" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  mapPin: (
    <>
      <path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.4" />
    </>
  ),
  chevronRight: <path d="M9 6l6 6-6 6" />,
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 12 6 8z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  siren: (
    <>
      <path d="M12 2a5 5 0 0 1 5 5v6H7V7a5 5 0 0 1 5-5z" />
      <path d="M4 20a8 8 0 0 1 16 0" />
      <path d="M12 2v2" />
    </>
  ),
};

function Icon({ name, className = "" }) {
  const path = ICON_PATHS[name];
  if (!path) return null;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {path}
    </svg>
  );
}

function BrandMark({ size = 34 }) {
  return (
    <div className="brand-mark" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M12 2L4 5v6c0 5 3.4 8.7 8 9 4.6-.3 8-4 8-9V5l-8-3z" stroke="#06231a" strokeWidth="2" strokeLinejoin="round" />
        <path d="M9 12l2 2 4-4.5" stroke="#06231a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/**
 * TERREX logomark — shield + radar sweep, in the app's emerald/midnight
 * palette. Gradient/clip ids are namespaced with useId() so this can be
 * rendered more than once on the same page without the defs colliding.
 */
function TerrexLogoMark({ size = 96, className = "" }) {
  const uid = useId();
  const glowId = `terrex-glow-${uid}`;
  const shieldFillId = `terrex-shieldFill-${uid}`;
  const sweepId = `terrex-sweep-${uid}`;
  const clipId = `terrex-shieldClip-${uid}`;
  return (
    <svg
      className={`terrex-logomark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id={glowId} cx="50%" cy="42%" r="65%">
          <stop offset="0%" stopColor="#35d28a" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#35d28a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={shieldFillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#182420" />
          <stop offset="100%" stopColor="#0f1613" />
        </linearGradient>
        <linearGradient id={sweepId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#35d28a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#35d28a" stopOpacity="0" />
        </linearGradient>
        <clipPath id={clipId}>
          <path d="M100,26 C123,26 148,38 158,46 L158,102 C158,146 132,171 100,182 C68,171 42,146 42,102 L42,46 C52,38 77,26 100,26 Z" />
        </clipPath>
      </defs>

      <rect width="200" height="200" rx="42" fill="#0b0d10" />
      <rect width="200" height="200" rx="42" fill={`url(#${glowId})`} />

      <path
        d="M100,26 C123,26 148,38 158,46 L158,102 C158,146 132,171 100,182 C68,171 42,146 42,102 L42,46 C52,38 77,26 100,26 Z"
        fill={`url(#${shieldFillId})`}
        stroke="#35d28a"
        strokeWidth="3"
      />

      <g clipPath={`url(#${clipId})`}>
        <path d="M100,104 L100,54 A50,50 0 0,1 135,69 Z" fill={`url(#${sweepId})`} />
        <circle cx="100" cy="104" r="42" fill="none" stroke="#35d28a" strokeOpacity="0.35" strokeWidth="1.5" />
        <circle cx="100" cy="104" r="27" fill="none" stroke="#35d28a" strokeOpacity="0.5" strokeWidth="1.5" />
        <circle cx="100" cy="104" r="12" fill="none" stroke="#35d28a" strokeOpacity="0.7" strokeWidth="1.5" />
      </g>

      <circle cx="100" cy="104" r="5" fill="#35d28a" />

      <circle cx="126" cy="82" r="7" fill="#35d28a" opacity="0.18" />
      <circle cx="126" cy="82" r="3.5" fill="#35d28a" />
    </svg>
  );
}

/**
 * TERREX horizontal logo lockup — TerrexLogoMark plus the "TERREX /
 * LIVE AREA MONITORING" wordmark. Same id-namespacing approach as
 * TerrexLogoMark so it's safe to render alongside it.
 */
function TerrexLogoLockup({ height = 64, className = "" }) {
  const uid = useId();
  const glowId = `terrex-lockup-glow-${uid}`;
  const shieldFillId = `terrex-lockup-shieldFill-${uid}`;
  const sweepId = `terrex-lockup-sweep-${uid}`;
  const clipId = `terrex-lockup-shieldClip-${uid}`;
  return (
    <svg
      className={`terrex-logo-lockup ${className}`}
      height={height}
      viewBox="0 0 480 140"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id={glowId} cx="50%" cy="42%" r="65%">
          <stop offset="0%" stopColor="#35d28a" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#35d28a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={shieldFillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#182420" />
          <stop offset="100%" stopColor="#0f1613" />
        </linearGradient>
        <linearGradient id={sweepId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#35d28a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#35d28a" stopOpacity="0" />
        </linearGradient>
        <clipPath id={clipId}>
          <path d="M70,20 C88,20 108,29 116,35 L116,79 C116,114 96,134 70,143 C44,134 24,114 24,79 L24,35 C32,29 52,20 70,20 Z" />
        </clipPath>
      </defs>

      <rect width="480" height="140" fill="#0b0d10" />

      <g>
        <rect x="4" y="4" width="132" height="132" rx="30" fill={`url(#${glowId})`} />
        <path
          d="M70,20 C88,20 108,29 116,35 L116,79 C116,114 96,134 70,143 C44,134 24,114 24,79 L24,35 C32,29 52,20 70,20 Z"
          fill={`url(#${shieldFillId})`}
          stroke="#35d28a"
          strokeWidth="2.5"
        />
        <g clipPath={`url(#${clipId})`}>
          <path d="M70,79 L70,42 A37,37 0 0,1 96,53 Z" fill={`url(#${sweepId})`} />
          <circle cx="70" cy="79" r="31" fill="none" stroke="#35d28a" strokeOpacity="0.35" strokeWidth="1.2" />
          <circle cx="70" cy="79" r="20" fill="none" stroke="#35d28a" strokeOpacity="0.5" strokeWidth="1.2" />
          <circle cx="70" cy="79" r="9" fill="none" stroke="#35d28a" strokeOpacity="0.7" strokeWidth="1.2" />
        </g>
        <circle cx="70" cy="79" r="3.8" fill="#35d28a" />
        <circle cx="89" cy="62" r="5" fill="#35d28a" opacity="0.18" />
        <circle cx="89" cy="62" r="2.6" fill="#35d28a" />
      </g>

      <text x="156" y="82" fontFamily="'Space Grotesk','Helvetica Neue',Arial,sans-serif" fontSize="46" fontWeight="700" letterSpacing="4" fill="#e8ebf0">
        TERREX
      </text>
      <text x="158" y="106" fontFamily="'JetBrains Mono','Courier New',monospace" fontSize="13" letterSpacing="3" fill="#35d28a">
        LIVE AREA MONITORING
      </text>
    </svg>
  );
}

/* ---------------------------- small UI atoms ---------------------------- */

function Field({ label, error, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      className={`switch${checked ? " on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" />
    </button>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`toast${toast.tone ? ` ${toast.tone}` : ""}`}>
      <Icon name={toast.tone === "error" ? "x" : "check"} />
      <span>{toast.message}</span>
    </div>
  );
}

/* ---------------------------- auth pages ---------------------------- */

function AuthShell({ children }) {
  return (
    <div className="auth-wrap">
      <div className="bg-grid" />
      <div className="auth-lockup-header">
        <TerrexLogoLockup height={56} />
      </div>
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark size={44} />
        </div>
        {children}
      </div>
      <div className="auth-footnote">Demo interface — not connected to emergency services</div>
    </div>
  );
}

/* Shown after register/login instead of logging straight in — the
   user must enter the 6-digit code emailed to them first. */
function VerificationStep({ userId, purpose, onVerified, onBack }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim()) {
      setError("Enter the 6-digit code");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const user = await apiVerifyCode(userId, code.trim());
      setLoading(false);
      onVerified(mapServerUser(user));
    } catch (err) {
      setLoading(false);
      setError(err.message || "Incorrect or expired code");
    }
  };

  const resend = async () => {
    setResending(true);
    setError("");
    try {
      await apiResendCode(userId, purpose);
      setResent(true);
    } catch (err) {
      setError(err.message || "Could not resend code");
    }
    setResending(false);
  };

  return (
    <AuthShell>
      <div className="auth-welcome">WELCOME TO TERREX</div>
      <h1 className="auth-title">Check your email</h1>
      <p className="auth-sub">Enter the 6-digit code we just sent you to continue.</p>

      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label="Verification code" error={error}>
          <input
            className="text-input"
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
        </Field>

        <button className="auth-submit" type="submit" disabled={loading}>
          {loading ? <span className="btn-spinner" /> : null}
          {loading ? "Verifying…" : "Verify"}
        </button>
      </form>

      <div className="auth-switch">
        {resent ? (
          "A new code was sent — check your email."
        ) : (
          <>
            Didn't get a code?{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); if (!resending) resend(); }}>
              {resending ? "Sending…" : "Resend code"}
            </a>
          </>
        )}
      </div>
      <div className="auth-switch">
        <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>
          Use a different email
        </a>
      </div>
    </AuthShell>
  );
}

function LoginPage({ onLogin, onGoSignup }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [pendingUserId, setPendingUserId] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const nextErrors = {};
    if (!email.trim()) nextErrors.email = "Enter your email";
    if (!password) nextErrors.password = "Enter your password";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setLoading(true);
    try {
      const { user_id } = await apiLogin(email.trim(), password);
      setLoading(false);
      setPendingUserId(user_id);
    } catch (err) {
      setLoading(false);
      setErrors({ form: err.message || "Email or password is incorrect." });
    }
  };

  if (pendingUserId) {
    return (
      <VerificationStep
        userId={pendingUserId}
        purpose="login"
        onVerified={onLogin}
        onBack={() => setPendingUserId(null)}
      />
    );
  }

  return (
    <AuthShell>
      <div className="auth-welcome">WELCOME TO TERREX</div>
      <h1 className="auth-title">Sign in</h1>
      <p className="auth-sub">Keep watch over the streets that matter to you.</p>

      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label="Email" error={errors.email}>
          <input
            className="text-input"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label="Password" error={errors.password}>
          <div className="pw-wrap">
            <input
              className="text-input"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)} aria-label="Toggle password visibility">
              <Icon name={showPw ? "eyeOff" : "eye"} />
            </button>
          </div>
        </Field>

        {errors.form && <div className="form-error">{errors.form}</div>}

        <button className="auth-submit" type="submit" disabled={loading}>
          {loading ? <span className="btn-spinner" /> : null}
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="auth-switch">
        Don't have an account?{" "}
        <a href="#" onClick={(e) => { e.preventDefault(); onGoSignup(); }}>
          Create one
        </a>
      </div>
    </AuthShell>
  );
}

function SignupPage({ onSignup, onGoLogin }) {
  const [form, setForm] = useState({ displayName: "", username: "", email: "", password: "", confirm: "" });
  const [showPw, setShowPw] = useState(false);
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [pendingUserId, setPendingUserId] = useState(null);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const nextErrors = {};
    if (!form.displayName.trim()) nextErrors.displayName = "Enter your full name";
    if (!form.username.trim()) nextErrors.username = "Choose a username";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) nextErrors.email = "Enter a valid email";
    if (form.password.length < 6) nextErrors.password = "At least 6 characters";
    if (form.confirm !== form.password) nextErrors.confirm = "Passwords don't match";
    if (!agree) nextErrors.agree = "You must accept the terms";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setLoading(true);
    try {
      const { user_id } = await apiRegister({
        full_name: form.displayName.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      setLoading(false);
      setPendingUserId(user_id);
    } catch (err) {
      setLoading(false);
      setErrors({ form: err.message || "Could not create your account." });
    }
  };

  if (pendingUserId) {
    return (
      <VerificationStep
        userId={pendingUserId}
        purpose="register"
        onVerified={onSignup}
        onBack={() => setPendingUserId(null)}
      />
    );
  }

  return (
    <AuthShell>
      <div className="auth-welcome">WELCOME TO TERREX</div>
      <h1 className="auth-title">Create your account</h1>
      <p className="auth-sub">Join your neighbors already watching out for each other.</p>

      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label="Full name" error={errors.displayName}>
          <input className="text-input" type="text" placeholder="Amaka Obi" value={form.displayName} onChange={update("displayName")} />
        </Field>

        <Field label="Username" error={errors.username}>
          <input className="text-input" type="text" placeholder="amaka" value={form.username} onChange={update("username")} />
        </Field>

        <Field label="Email" error={errors.email}>
          <input className="text-input" type="email" placeholder="you@example.com" value={form.email} onChange={update("email")} />
        </Field>

        <Field label="Password" error={errors.password} hint="At least 6 characters">
          <div className="pw-wrap">
            <input
              className="text-input"
              type={showPw ? "text" : "password"}
              placeholder="••••••••"
              value={form.password}
              onChange={update("password")}
            />
            <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)} aria-label="Toggle password visibility">
              <Icon name={showPw ? "eyeOff" : "eye"} />
            </button>
          </div>
        </Field>

        <Field label="Confirm password" error={errors.confirm}>
          <input
            className="text-input"
            type={showPw ? "text" : "password"}
            placeholder="••••••••"
            value={form.confirm}
            onChange={update("confirm")}
          />
        </Field>

        <label className="agree-row">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I agree to the Terms of Service and Privacy Policy</span>
        </label>
        {errors.agree && <span className="field-error">{errors.agree}</span>}
        {errors.form && <div className="form-error">{errors.form}</div>}

        <button className="auth-submit" type="submit" disabled={loading}>
          {loading ? <span className="btn-spinner" /> : null}
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>

      <div className="auth-switch">
        Already have an account?{" "}
        <a href="#" onClick={(e) => { e.preventDefault(); onGoLogin(); }}>
          Sign in
        </a>
      </div>
    </AuthShell>
  );
}


/* ---------------------------- app shell (nav) ---------------------------- */

const NAV_ITEMS = [
  { key: "home", label: "Dashboard", icon: "home" },
  { key: "alerts", label: "Alerts", icon: "alerts" },
  { key: "circle", label: "Trusted circle", icon: "circle" },
  { key: "report", label: "Report", icon: "report" },
  { key: "profile", label: "Profile", icon: "profile" },
  { key: "settings", label: "Settings", icon: "settings" },
];

const TAB_ITEMS = [
  { key: "home", label: "Home", icon: "home" },
  { key: "alerts", label: "Alerts", icon: "alerts" },
  { key: "report", label: "Report", icon: "report" },
  { key: "circle", label: "Circle", icon: "circle" },
  { key: "profile", label: "Profile", icon: "profile" },
];

/* ---------------------------- HOME PAGE ---------------------------- */

const RADAR_BLIPS = [
  { top: "32%", left: "64%", danger: false, title: "Resolved · 2hr ago" },
  { top: "70%", left: "30%", danger: false, title: "Resolved · yesterday" },
];

function HomePage({ user, alerts, circle, onNavigate, onCheckLocation, onTriggerSos, onStartWalk, onEndWalk }) {
  const [radarSeconds, setRadarSeconds] = useState(2);
  useEffect(() => {
    const id = setInterval(() => setRadarSeconds((s) => (s > 30 ? 0 : s + 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const [dest, setDest] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const destInputRef = useRef(null);
  const checkTimeoutRef = useRef(null);

  const runCheck = useCallback(() => {
    const value = dest.trim();
    if (!value) {
      destInputRef.current?.focus();
      return;
    }
    setResult(null);
    setChecking(true);
    checkTimeoutRef.current = setTimeout(() => {
      setChecking(false);
      const caution = value.length % 4 === 0;
      const nextResult = caution
        ? { caution: true, icon: "⚠", title: `Caution near ${value}`, sub: "A report was flagged along this route in the last few hours." }
        : { caution: false, icon: "✓", title: "Clear to go", sub: `No incidents reported on the route to ${value}.` };
      setResult(nextResult);
      onCheckLocation?.({ location: value, caution, title: nextResult.title, summary: nextResult.sub });
    }, 900);
  }, [dest, onCheckLocation]);

  useEffect(() => () => clearTimeout(checkTimeoutRef.current), []);

  const HOLD_MS = 3000;
  const CIRCUMFERENCE = 2 * Math.PI * 42;
  const [sosOffset, setSosOffset] = useState(CIRCUMFERENCE);
  const [sosActivated, setSosActivated] = useState(false);
  const holdStartRef = useRef(null);
  const holdRAFRef = useRef(null);
  const holdTimeoutRef = useRef(null);
  const activatedRef = useRef(false);
  const resetTimeoutRef = useRef(null);

  const updateRing = useCallback(() => {
    const elapsed = Date.now() - holdStartRef.current;
    const pct = Math.min(elapsed / HOLD_MS, 1);
    setSosOffset(CIRCUMFERENCE * (1 - pct));
    if (pct < 1 && !activatedRef.current) holdRAFRef.current = requestAnimationFrame(updateRing);
  }, [CIRCUMFERENCE]);

  const startHold = useCallback(
    (e) => {
      e.preventDefault();
      if (activatedRef.current) return;
      holdStartRef.current = Date.now();
      holdRAFRef.current = requestAnimationFrame(updateRing);
      holdTimeoutRef.current = setTimeout(() => {
        activatedRef.current = true;
        setSosActivated(true);
        onTriggerSos?.();
        resetTimeoutRef.current = setTimeout(() => {
          activatedRef.current = false;
          setSosActivated(false);
          setSosOffset(CIRCUMFERENCE);
        }, 2600);
      }, HOLD_MS);
    },
    [updateRing, CIRCUMFERENCE, onTriggerSos]
  );

  const cancelHold = useCallback(() => {
    clearTimeout(holdTimeoutRef.current);
    cancelAnimationFrame(holdRAFRef.current);
    if (!activatedRef.current) setSosOffset(CIRCUMFERENCE);
  }, [CIRCUMFERENCE]);

  useEffect(
    () => () => {
      clearTimeout(holdTimeoutRef.current);
      clearTimeout(resetTimeoutRef.current);
      cancelAnimationFrame(holdRAFRef.current);
    },
    []
  );

  const TIMER_OPTIONS = [
    { value: 600, label: "10 minutes" },
    { value: 900, label: "15 minutes" },
    { value: 1200, label: "20 minutes" },
    { value: 1800, label: "30 minutes" },
  ];
  const [timerDuration, setTimerDuration] = useState(900);
  const [timerRunning, setTimerRunning] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [arrived, setArrived] = useState(false);
  const timerIntervalRef = useRef(null);
  const timerPanelRef = useRef(null);
  const walkSessionIdRef = useRef(null);

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m < 10 ? "0" : ""}${m}:${sec < 10 ? "0" : ""}${sec}`;
  };

  const stopTimer = useCallback(
    (status = "cancelled") => {
      clearInterval(timerIntervalRef.current);
      setTimerRunning(false);
      setArrived(false);
      if (walkSessionIdRef.current) {
        onEndWalk?.(walkSessionIdRef.current, status);
        walkSessionIdRef.current = null;
      }
    },
    [onEndWalk]
  );

  const toggleTimer = useCallback(async () => {
    if (!timerRunning) {
      setRemaining(timerDuration);
      setTimerRunning(true);
      setArrived(false);
      const sessionId = await onStartWalk?.(timerDuration);
      walkSessionIdRef.current = sessionId || null;
      timerIntervalRef.current = setInterval(() => {
        setRemaining((r) => {
          if (r <= 1) {
            clearInterval(timerIntervalRef.current);
            setArrived(true);
            setTimeout(() => stopTimer("arrived"), 2000);
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    } else {
      stopTimer("cancelled");
    }
  }, [timerRunning, timerDuration, stopTimer, onStartWalk]);

  useEffect(() => () => clearInterval(timerIntervalRef.current), []);

  const scrollToTimer = () => timerPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });

  const activeCount = alerts.filter((a) => a.severity !== "resolved").length;
  const recent = alerts.slice(0, 3);

  return (
    <div className="main-inner">
      <div className="page-head">
        <div>
          <div className="greeting-eyebrow">Dashboard · Lekki Phase 1</div>
          <h1 className="greeting">
            {getGreeting()}, {capitalize(user.displayName?.split(" ")[0] || user.username)}
          </h1>
          <div className="greeting-sub">Your area is quiet right now — last checked a few seconds ago.</div>
        </div>
        <span className="status-pill desktop-only">
          <span className="status-dot" />
          {activeCount > 0 ? `${activeCount} ACTIVE` : "ALL CLEAR"}
        </span>
      </div>

      <div className="dash-grid">
        <div className="dash-col">
          <section className="panel radar-panel">
            <div className="panel-label">
              <span className="lb">Live area scan</span>
              <span className="meta">updated {radarSeconds}s ago</span>
            </div>
            <div className="radar-stage">
              <div className="radar-sweep" />
              <div className="radar-rings"><i /></div>
              {RADAR_BLIPS.map((b, i) => (
                <div key={i} className={`radar-blip${b.danger ? " danger" : ""}`} style={{ top: b.top, left: b.left }} title={b.title} onClick={() => alert(b.title)} />
              ))}
              <div className="radar-center-pin" />
            </div>
            <div className="radar-readout">
              <span>0.8KM RADIUS</span>
              <span className="live">● SCANNING</span>
              <span>2 RESOLVED REPORTS NEARBY</span>
            </div>
          </section>

          <section className="panel">
            <div className="panel-label"><span className="lb">Check a destination</span></div>
            <div className="check-row">
              <input
                ref={destInputRef}
                className="check-input"
                type="text"
                placeholder="Where are you headed?"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runCheck(); }}
              />
              <button className="check-btn" disabled={checking} onClick={runCheck}>Check safety</button>
            </div>
            {checking && <div className="check-spin show"><span className="spinner" /> Checking live reports and route data…</div>}
            {result && (
              <div className={`check-result show${result.caution ? " caution" : " safe"}`}>
                <span className="icon">{result.icon}</span>
                <div>
                  <div className="title">{result.title}</div>
                  <div className="sub">{result.sub}</div>
                </div>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-label">
              <span className="lb">Recent activity</span>
              <button className="link-btn" onClick={() => onNavigate("alerts")}>View all →</button>
            </div>
            {recent.map((item) => (
              <div className="feed-item" key={item.id}>
                <span className={`feed-tag ${item.severity}`}>{item.severity.toUpperCase()}</span>
                <div className="feed-body">
                  <div className="t">{item.title}</div>
                  <div className="m">{item.distance} · {item.time}{item.note ? ` · ${item.note}` : ""}</div>
                </div>
              </div>
            ))}
          </section>
        </div>

        <div className="dash-col">
          <div className="stat-row">
            <div className="stat-card"><div className="num">92</div><div className="lb">Safety score</div></div>
            <div className="stat-card"><div className="num">{activeCount}</div><div className="lb">Active alerts</div></div>
            <div className="stat-card"><div className="num">{circle.length}</div><div className="lb">Trusted circle</div></div>
          </div>

          <section className="panel">
            <div className="panel-label"><span className="lb">Quick actions</span></div>
            <div className="quick-grid">
              <button className="quick-btn" onClick={() => onNavigate("alerts")}><span className="ic">🛰</span><span className="lb">Check a route</span></button>
              <button className="quick-btn" onClick={scrollToTimer}><span className="ic">⏱</span><span className="lb">Safe walk timer</span></button>
              <button className="quick-btn" onClick={() => onNavigate("report")}><span className="ic">📍</span><span className="lb">Report something</span></button>
              <button className="quick-btn" onClick={() => onNavigate("circle")}><span className="ic">👥</span><span className="lb">Manage circle</span></button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-label"><span className="lb">Emergency</span></div>
            <div className="sos-wrap">
              <button className="sos-btn" onPointerDown={startHold} onPointerUp={cancelHold} onPointerLeave={cancelHold}>
                <svg className="ring" viewBox="0 0 90 90">
                  <circle cx="45" cy="45" r="42" style={{ strokeDasharray: CIRCUMFERENCE, strokeDashoffset: sosOffset }} />
                </svg>
                <span>{sosActivated ? "SENT" : "HOLD"}</span>
              </button>
              <div className="sos-copy">
                <div className="t">{sosActivated ? "Alert sent to your trusted circle" : "Press and hold 3 seconds"}</div>
                <div className="d">Alerts your trusted circle with your live location.</div>
                <div className="demo-flag">Demo interface — not connected to emergency services</div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-label"><span className="lb">Trusted circle</span></div>
            <div className="circle-row">
              <div className="circle-avatars">
                {circle.slice(0, 3).map((m) => (
                  <div className="avatar-sm" key={m.id} style={{ background: m.color, color: m.textColor }}>{initialsOf(m.name)}</div>
                ))}
                {circle.length > 3 && <div className="avatar-sm">+{circle.length - 3}</div>}
                {circle.length === 0 && <div className="empty-inline">No members yet</div>}
              </div>
              <a className="manage-link" href="#" onClick={(e) => { e.preventDefault(); onNavigate("circle"); }}>Manage circle →</a>
            </div>
          </section>

          <section className="panel" ref={timerPanelRef}>
            <div className="panel-label"><span className="lb">Safe walk timer</span></div>
            <div className="timer-row">
              {!timerRunning && (
                <select className="timer-select" value={timerDuration} onChange={(e) => setTimerDuration(Number(e.target.value))}>
                  {TIMER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
              {timerRunning && <div className="timer-display show">{arrived ? "You've arrived" : formatTime(remaining)}</div>}
              <button className="timer-btn primary" onClick={toggleTimer}>{timerRunning ? "End walk" : "Start walk"}</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- ALERTS PAGE ---------------------------- */

function AlertsPage({ alerts, onCheckLocation }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);
  const timeoutRef = useRef(null);

  const runCheck = () => {
    const value = query.trim();
    if (!value) { inputRef.current?.focus(); return; }
    setResult(null);
    setChecking(true);
    timeoutRef.current = setTimeout(() => {
      setChecking(false);
      const caution = value.length % 3 === 0;
      const nextResult = caution
        ? { caution: true, icon: "⚠", title: `Elevated activity near ${value}`, sub: "2 unresolved reports within 1km in the last 6 hours." }
        : { caution: false, icon: "✓", title: `${value} looks quiet`, sub: "No active alerts reported in this area." };
      setResult(nextResult);
      onCheckLocation?.({ location: value, caution, title: nextResult.title, summary: nextResult.sub });
    }, 800);
  };
  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const filtered = useMemo(() => {
    if (filter === "all") return alerts;
    return alerts.filter((a) => a.severity === filter);
  }, [alerts, filter]);

  const counts = useMemo(
    () => ({
      all: alerts.length,
      critical: alerts.filter((a) => a.severity === "critical").length,
      warning: alerts.filter((a) => a.severity === "warning").length,
      resolved: alerts.filter((a) => a.severity === "resolved").length,
    }),
    [alerts]
  );

  return (
    <div className="main-inner">
      <div className="page-head">
        <div>
          <div className="greeting-eyebrow">Alerts</div>
          <h1 className="greeting">Nearby danger, tracked live</h1>
          <div className="greeting-sub">Search any area, or scan what's been reported around you.</div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-label"><span className="lb">Check an area</span></div>
        <div className="check-row">
          <input
            ref={inputRef}
            className="check-input"
            type="text"
            placeholder="Search a street, estate, or landmark…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runCheck(); }}
          />
          <button className="check-btn" disabled={checking} onClick={runCheck}>
            <Icon name="search" /> Scan
          </button>
        </div>
        {checking && <div className="check-spin show"><span className="spinner" /> Scanning nearby reports…</div>}
        {result && (
          <div className={`check-result show${result.caution ? " caution" : " safe"}`}>
            <span className="icon">{result.icon}</span>
            <div>
              <div className="title">{result.title}</div>
              <div className="sub">{result.sub}</div>
            </div>
          </div>
        )}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-label">
          <span className="lb">All alerts</span>
          <span className="meta">{filtered.length} shown</span>
        </div>

        <div className="chip-row">
          {[
            { key: "all", label: "All" },
            { key: "critical", label: "Critical" },
            { key: "warning", label: "Warning" },
            { key: "resolved", label: "Resolved" },
          ].map((c) => (
            <button key={c.key} className={`chip${filter === c.key ? " active" : ""}`} onClick={() => setFilter(c.key)}>
              {c.label} <span className="chip-count">{counts[c.key]}</span>
            </button>
          ))}
        </div>

        <div className="alert-list">
          {filtered.length === 0 && <div className="empty-state">No alerts in this category right now.</div>}
          {filtered.map((a) => (
            <div className="alert-card" key={a.id}>
              <span className={`feed-tag ${a.severity}`}>{a.severity.toUpperCase()}</span>
              <div className="feed-body">
                <div className="t">{a.title}</div>
                <div className="m">{a.distance} · {a.time}{a.note ? ` · ${a.note}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ---------------------------- REPORT PAGE ---------------------------- */

const REPORT_CATEGORIES = ["Suspicious activity", "Theft", "Accident", "Fire", "Medical emergency", "Infrastructure", "Other"];

function ReportPage({ reports, onAddReport }) {
  const [category, setCategory] = useState(REPORT_CATEGORIES[0]);
  const [severity, setSeverity] = useState("warning");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const nextErrors = {};
    if (!location.trim()) nextErrors.location = "Add a location or landmark";
    if (!description.trim() || description.trim().length < 10) nextErrors.description = "Give a few more details (10+ characters)";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    await onAddReport({
      category,
      severity,
      location: location.trim(),
      description: description.trim(),
    });
    setSubmitting(false);
    setLocation("");
    setDescription("");
    setSeverity("warning");
    setCategory(REPORT_CATEGORIES[0]);
  };

  return (
    <div className="main-inner">
      <div className="page-head">
        <div>
          <div className="greeting-eyebrow">Report</div>
          <h1 className="greeting">Report nearby danger</h1>
          <div className="greeting-sub">Your report is shared with neighbors within your area and stays anonymous by default.</div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-col">
          <section className="panel">
            <div className="panel-label"><span className="lb">New report</span></div>
            <form onSubmit={submit} noValidate className="report-form">
              <Field label="Category">
                <select className="text-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {REPORT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>

              <Field label="Location or landmark" error={errors.location}>
                <input className="text-input" type="text" placeholder="e.g. Chevron Drive, near the roundabout" value={location} onChange={(e) => setLocation(e.target.value)} />
              </Field>

              <Field label="Severity">
                <div className="severity-row">
                  {[
                    { key: "warning", label: "Low / Warning" },
                    { key: "critical", label: "High / Critical" },
                  ].map((s) => (
                    <button
                      type="button"
                      key={s.key}
                      className={`severity-pill ${s.key}${severity === s.key ? " active" : ""}`}
                      onClick={() => setSeverity(s.key)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="What did you see?" error={errors.description}>
                <textarea
                  className="text-input textarea"
                  rows={4}
                  placeholder="Describe what happened, when, and any details that could help others stay safe…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>

              <button className="auth-submit" type="submit" disabled={submitting}>
                {submitting ? <span className="btn-spinner" /> : <Icon name="report" />}
                {submitting ? "Submitting…" : "Submit report"}
              </button>
            </form>
          </section>
        </div>

        <div className="dash-col">
          <section className="panel">
            <div className="panel-label">
              <span className="lb">Your reports</span>
              <span className="meta">{reports.length} total</span>
            </div>
            {reports.length === 0 && <div className="empty-state">You haven't submitted any reports yet.</div>}
            {reports.map((r) => (
              <div className="feed-item" key={r.id}>
                <span className={`feed-tag ${r.severity}`}>{r.severity.toUpperCase()}</span>
                <div className="feed-body">
                  <div className="t">{r.title}</div>
                  <div className="m">{r.time} · {r.note}</div>
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- CIRCLE PAGE ---------------------------- */

const CIRCLE_COLORS = [
  { bg: "#8fe0c4", text: "#062017" },
  { bg: "#ffc062", text: "#3a1f00" },
  { bg: "#9eb6ff", text: "#0a1a3a" },
  { bg: "#ff9eb8", text: "#3a0a1a" },
  { bg: "#c6a8ff", text: "#1e0a3a" },
];

function CirclePage({ circle, onAdd, onRemove, showToast }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState({});

  const submit = async (e) => {
    e.preventDefault();
    const nextErrors = {};
    if (!name.trim()) nextErrors.name = "Enter a name";
    if (!phone.trim()) nextErrors.phone = "Enter a phone number";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    await onAdd({ name: name.trim(), relation: relation.trim() || "Trusted contact", phone: phone.trim() });
    setName("");
    setRelation("");
    setPhone("");
    setShowForm(false);
  };

  return (
    <div className="main-inner">
      <div className="page-head">
        <div>
          <div className="greeting-eyebrow">Trusted circle</div>
          <h1 className="greeting">People who watch out for you</h1>
          <div className="greeting-sub">They're notified when you send an SOS or don't complete a safe walk timer.</div>
        </div>
        <button className="check-btn" onClick={() => setShowForm((s) => !s)}>
          <Icon name="plus" /> Add member
        </button>
      </div>

      {showForm && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-label"><span className="lb">New trusted contact</span></div>
          <form className="report-form" onSubmit={submit} noValidate>
            <div className="grid-2">
              <Field label="Name" error={errors.name}>
                <input className="text-input" type="text" placeholder="e.g. Jide Taiwo" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Relation">
                <input className="text-input" type="text" placeholder="e.g. Brother, Neighbor" value={relation} onChange={(e) => setRelation(e.target.value)} />
              </Field>
            </div>
            <Field label="Phone number" error={errors.phone}>
              <input className="text-input" type="tel" placeholder="e.g. 080 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <div className="row-gap">
              <button className="auth-submit" type="submit" style={{ marginTop: 0 }}>Add to circle</button>
              <button type="button" className="timer-btn" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </section>
      )}

      <div className="circle-grid">
        {circle.length === 0 && <div className="empty-state">Your trusted circle is empty. Add someone you trust to get started.</div>}
        {circle.map((m) => (
          <div className="circle-card" key={m.id}>
            <div className="avatar-sm lg" style={{ background: m.color, color: m.textColor }}>{initialsOf(m.name)}</div>
            <div className="circle-card-body">
              <div className="who">{m.name}</div>
              <div className="role">{m.relation}</div>
              <div className="circle-phone"><Icon name="phone" /> {m.phone}</div>
            </div>
            <button className="icon-btn danger" onClick={() => onRemove(m.id)} aria-label={`Remove ${m.name}`}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------- PROFILE PAGE ---------------------------- */

function ProfilePage({ user, onUpdateProfile, onLogout, onNavigate, showToast }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const fileInputRef = useRef(null);

  const saveName = () => {
    if (!displayName.trim()) return;
    onUpdateProfile({ displayName: displayName.trim() });
    showToast("Profile updated");
  };

  const onPickAvatar = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onUpdateProfile({ avatar: reader.result });
      showToast("Profile picture updated");
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="main-inner">
      <div className="page-head">
        <div>
          <div className="greeting-eyebrow">Profile</div>
          <h1 className="greeting">Your account</h1>
          <div className="greeting-sub">Manage how you appear across TERREX.</div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-col">
          <section className="panel profile-card">
            <div className="avatar-upload">
              {user.avatar ? (
                <img src={user.avatar} alt="Profile" className="avatar-lg-img" />
              ) : (
                <div className="avatar-sm xl">{initialsOf(user.displayName || user.username)}</div>
              )}
              <button className="avatar-edit" onClick={() => fileInputRef.current?.click()} aria-label="Change profile picture">
                <Icon name="camera" />
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onPickAvatar} />
            </div>

            <Field label="Display name">
              <input className="text-input" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
            <button className="timer-btn primary" onClick={saveName} style={{ alignSelf: "flex-start" }}>Save name</button>

            <div className="profile-meta">
              <div className="profile-meta-row"><Icon name="mail" /> {user.email}</div>
              <div className="profile-meta-row"><Icon name="clock" /> Member since {user.memberSince}</div>
              <div className="profile-meta-row"><Icon name="mapPin" /> Lekki Phase 1</div>
            </div>
          </section>
        </div>

        <div className="dash-col">
          <section className="panel">
            <div className="panel-label"><span className="lb">Plan</span></div>
            <div className="feed-item" style={{ borderBottom: "none" }}>
              <div className="feed-body">
                <div className="t">{user.plan}</div>
                <div className="m">Username: {user.username}</div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-label"><span className="lb">Shortcuts</span></div>
            <button className="settings-link-row" onClick={() => onNavigate("settings")}>
              <Icon name="settings" />
              <span>Go to settings</span>
              <Icon name="chevronRight" className="chev" />
            </button>
          </section>

          <section className="panel">
            <div className="panel-label"><span className="lb">Session</span></div>
            {!confirmingLogout ? (
              <button className="danger-btn" onClick={() => setConfirmingLogout(true)}>
                <Icon name="logout" /> Log out
              </button>
            ) : (
              <div className="confirm-row">
                <span>Log out of TERREX?</span>
                <div className="row-gap">
                  <button className="danger-btn" onClick={onLogout}>Yes, log out</button>
                  <button className="timer-btn" onClick={() => setConfirmingLogout(false)}>Cancel</button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- SETTINGS PAGE ---------------------------- */

function SettingsPage({ theme, onChangeTheme, prefs, onChangePrefs, showToast, onLogout }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setPref = (key, value) => {
    onChangePrefs({ ...prefs, [key]: value });
  };

  return (
    <div className="main-inner">
      <div className="page-head">
        <div>
          <div className="greeting-eyebrow">Settings</div>
          <h1 className="greeting">Make TERREX yours</h1>
          <div className="greeting-sub">Appearance, notifications, and safety preferences.</div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-col">
          <section className="panel">
            <div className="panel-label"><span className="lb">Appearance</span></div>
            <div className="settings-block">
              <div className="settings-block-title">Accent color</div>
              <div className="swatch-row">
                {ACCENT_PRESETS.map((a) => (
                  <button
                    key={a.id}
                    className={`swatch${theme.accent === a.id ? " active" : ""}`}
                    style={{ background: a.safe }}
                    aria-label={a.label}
                    title={a.label}
                    onClick={() => { onChangeTheme({ ...theme, accent: a.id }); showToast("Accent color updated"); }}
                  >
                    {theme.accent === a.id && <Icon name="check" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-block">
              <div className="settings-block-title">Background</div>
              <div className="swatch-row">
                {BG_PRESETS.map((b) => (
                  <button
                    key={b.id}
                    className={`bg-swatch${theme.bg === b.id ? " active" : ""}`}
                    style={{ background: b.bg, borderColor: b.border }}
                    title={b.label}
                    onClick={() => { onChangeTheme({ ...theme, bg: b.id }); showToast("Background updated"); }}
                  >
                    {theme.bg === b.id && <Icon name="check" />}
                    <span className="bg-swatch-label">{b.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-label"><span className="lb">Notifications</span></div>
            <div className="settings-row">
              <div><div className="settings-row-title">Push alerts</div><div className="settings-row-sub">Get notified about nearby danger in real time</div></div>
              <Switch checked={prefs.pushAlerts} onChange={(v) => setPref("pushAlerts", v)} label="Push alerts" />
            </div>
            <div className="settings-row">
              <div><div className="settings-row-title">Email digest</div><div className="settings-row-sub">Weekly summary of activity in your area</div></div>
              <Switch checked={prefs.emailDigest} onChange={(v) => setPref("emailDigest", v)} label="Email digest" />
            </div>
            <div className="settings-row">
              <div><div className="settings-row-title">SMS for emergencies</div><div className="settings-row-sub">Text your trusted circle when you send an SOS</div></div>
              <Switch checked={prefs.smsEmergency} onChange={(v) => setPref("smsEmergency", v)} label="SMS emergencies" />
            </div>
          </section>
        </div>

        <div className="dash-col">
          <section className="panel">
            <div className="panel-label"><span className="lb">Safety</span></div>
            <div className="settings-block">
              <div className="settings-row-title">Live scan radius</div>
              <div className="settings-row-sub" style={{ marginBottom: 10 }}>{prefs.radius.toFixed(1)} km around your location</div>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={prefs.radius}
                onChange={(e) => setPref("radius", Number(e.target.value))}
                className="range-input"
              />
            </div>
            <div className="settings-row">
              <div><div className="settings-row-title">Auto check-in</div><div className="settings-row-sub">Ping your circle if a safe walk timer runs out</div></div>
              <Switch checked={prefs.autoCheckin} onChange={(v) => setPref("autoCheckin", v)} label="Auto check-in" />
            </div>
            <div className="settings-row">
              <div><div className="settings-row-title">Share location with circle</div><div className="settings-row-sub">Trusted circle can see your live location during a walk</div></div>
              <Switch checked={prefs.shareLocation} onChange={(v) => setPref("shareLocation", v)} label="Share location" />
            </div>
          </section>

          <section className="panel">
            <div className="panel-label"><span className="lb">Preferences</span></div>
            <div className="settings-row">
              <div><div className="settings-row-title">Distance units</div><div className="settings-row-sub">Used across alerts and route checks</div></div>
              <div className="segmented">
                <button className={prefs.units === "km" ? "active" : ""} onClick={() => setPref("units", "km")}>km</button>
                <button className={prefs.units === "mi" ? "active" : ""} onClick={() => setPref("units", "mi")}>mi</button>
              </div>
            </div>
            <div className="settings-row">
              <div><div className="settings-row-title">Language</div><div className="settings-row-sub">Display language for the app</div></div>
              <select className="text-input compact" value={prefs.language} onChange={(e) => setPref("language", e.target.value)}>
                <option>English</option>
                <option>Français</option>
                <option>Yoruba</option>
                <option>Hausa</option>
                <option>Igbo</option>
              </select>
            </div>
          </section>

          <section className="panel">
            <div className="panel-label"><span className="lb">Danger zone</span></div>
            <button className="timer-btn" onClick={onLogout} style={{ marginBottom: 10, width: "100%" }}>Log out of all devices</button>
            {!confirmDelete ? (
              <button className="danger-btn" style={{ width: "100%" }} onClick={() => setConfirmDelete(true)}>Delete account</button>
            ) : (
              <div className="confirm-row">
                <span>This is a demo — no account will actually be deleted. Continue?</span>
                <div className="row-gap">
                  <button className="danger-btn" onClick={() => { setConfirmDelete(false); showToast("Demo only — nothing was deleted"); }}>Confirm</button>
                  <button className="timer-btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- APP SHELL ---------------------------- */

function AppShell({ user, page, onNavigate, onLogout, children }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div className="brand-name">TERREX</div>
        </div>

        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.key}
              href="#"
              className={`nav-item${page === item.key ? " active" : ""}`}
              onClick={(e) => { e.preventDefault(); onNavigate(item.key); }}
            >
              <Icon name={item.icon} />
              {item.label}
            </a>
          ))}
        </nav>

        <button className="nav-item logout-item" onClick={onLogout}>
          <Icon name="logout" />
          Log out
        </button>

        <div className="sidebar-footer">
          {user.avatar ? <img src={user.avatar} alt="" className="avatar-sm-img" /> : <div className="avatar-sm">{initialsOf(user.displayName || user.username)}</div>}
          <div>
            <div className="who">{user.displayName || user.username}</div>
            <div className="role">{user.plan}</div>
          </div>
        </div>

        <div className="sidebar-watermark">
          <TerrexLogoMark size={28} />
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <div className="brand">
            <BrandMark />
            <div className="brand-name">TERREX</div>
          </div>
          <div className="topbar-right">
            <button className="icon-btn" onClick={() => onNavigate("settings")} aria-label="Settings">
              <Icon name="settings" />
            </button>
            <span className="status-pill"><span className="status-dot" />ALL CLEAR</span>
          </div>
        </header>

        <main className="main">{children}</main>
      </div>

      <nav className="tabbar">
        <div className="tabbar-inner">
          {TAB_ITEMS.map((item) => (
            <a
              key={item.key}
              href="#"
              className={`tab-item${page === item.key ? " active" : ""}`}
              onClick={(e) => { e.preventDefault(); onNavigate(item.key); }}
            >
              <Icon name={item.icon} />
              {item.label}
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}

/* ---------------------------- ROOT APP ---------------------------- */

// Row mappers: server table rows -> shapes the existing UI expects.
function mapAlertRow(a) {
  return {
    id: a.id,
    title: a.title,
    severity: a.severity,
    distance: a.distance_km != null ? `${a.distance_km}km` : "",
    time: timeAgo(a.reported_at),
    note: a.note || "",
  };
}
function mapCircleRow(c, index) {
  const color = CIRCLE_COLORS[index % CIRCLE_COLORS.length];
  return { id: c.id, name: c.name, relation: c.relation, phone: c.phone, color: color.bg, textColor: color.text };
}
function mapReportRow(r) {
  return {
    id: r.id,
    category: r.category,
    severity: r.severity,
    title: `${r.category} — ${r.location}`,
    description: r.description,
    distance: "Your report",
    time: timeAgo(r.created_at),
    note: r.status,
  };
}

export default function TerrexApp() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authView, setAuthView] = useState("login");
  const [page, setPage] = useState("home");
  const [booting, setBooting] = useState(false);

  const [theme, setTheme] = useState({ accent: "emerald", bg: "midnight" });
  const [prefs, setPrefs] = useState({
    pushAlerts: true,
    emailDigest: false,
    smsEmergency: true,
    radius: 0.8,
    autoCheckin: true,
    shareLocation: true,
    units: "km",
    language: "English",
  });
  const [settingsId, setSettingsId] = useState(null);

  const [alerts, setAlerts] = useState([]);
  const [reports, setReports] = useState([]);
  const [circle, setCircle] = useState([]);

  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);
  const showToast = useCallback((message, tone = "success") => {
    clearTimeout(toastTimeoutRef.current);
    setToast({ message, tone });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 2500);
  }, []);
  useEffect(() => () => clearTimeout(toastTimeoutRef.current), []);

  // Loads live data from server.js for the signed-in user.
  const loadAppData = useCallback(async (user) => {
    const [alertRows, circleRows, reportRows] = await Promise.all([
      apiFetch("/alerts"),
      apiFetch("/trusted-circle"),
      apiFetch("/reports"),
    ]);

    setAlerts(alertRows.map(mapAlertRow));
    setCircle(
      circleRows
        .filter((c) => c.user_id === user.id)
        .map(mapCircleRow)
    );
    setReports(
      reportRows
        .filter((r) => r.user_id === user.id)
        .map(mapReportRow)
    );

    try {
      const s = await apiFetch(`/user-settings/${user.id}`);
      setSettingsId(user.id);
      setTheme({ accent: s.accent_color, bg: s.background_theme });
      setPrefs({
        pushAlerts: !!s.push_alerts,
        emailDigest: !!s.email_digest,
        smsEmergency: !!s.sms_emergency,
        radius: Number(s.scan_radius_km),
        autoCheckin: !!s.auto_checkin,
        shareLocation: !!s.share_location,
        units: s.units,
        language: s.language,
      });
    } catch {
      // no settings row for this user yet — fall back to the defaults
      // already set in useState above.
      setSettingsId(user.id);
    }
  }, []);

  const handleLogin = async (user) => {
    setBooting(true);
    setCurrentUser(user);
    try {
      await loadAppData(user);
    } catch (err) {
      showToast(err.message || "Could not load your data", "error");
    }
    setPage("home");
    setBooting(false);
  };

  const handleSignup = (newUser) => handleLogin(newUser);

  const handleLogout = () => {
    setCurrentUser(null);
    setAuthView("login");
    setPage("home");
    setAlerts([]);
    setReports([]);
    setCircle([]);
    setSettingsId(null);
  };

  // Every handler below calls server.js. Note: POST/PUT/DELETE on these
  // tables currently require the admin token from /api/admin/login (see
  // server.js) — as a regular signed-in user these calls will 401 until
  // the server adds user-scoped write routes. They're wired up so the
  // moment that exists, this UI works unchanged.
  const updateProfile = async (patch) => {
    setCurrentUser((u) => ({ ...u, ...patch }));
    // No PUT /api/users/:id route exists yet on the server for editing
    // a profile — add one there to persist this.
  };

  const persistSettings = async (nextTheme, nextPrefs) => {
    if (!settingsId) return;
    try {
      await apiFetch(`/user-settings/${settingsId}`, {
        method: "PUT",
        body: JSON.stringify({
          accent_color: nextTheme.accent,
          background_theme: nextTheme.bg,
          push_alerts: nextPrefs.pushAlerts,
          email_digest: nextPrefs.emailDigest,
          sms_emergency: nextPrefs.smsEmergency,
          scan_radius_km: nextPrefs.radius,
          auto_checkin: nextPrefs.autoCheckin,
          share_location: nextPrefs.shareLocation,
          units: nextPrefs.units,
          language: nextPrefs.language,
        }),
      });
    } catch (err) {
      showToast(err.message || "Could not save settings", "error");
    }
  };

  const handleChangeTheme = (newTheme) => {
    setTheme(newTheme);
    persistSettings(newTheme, prefs);
  };

  const handleChangePrefs = (newPrefs) => {
    setPrefs(newPrefs);
    persistSettings(theme, newPrefs);
  };

  const handleAddReport = async (r) => {
    try {
      const row = await apiFetch("/reports", {
        method: "POST",
        body: JSON.stringify({
          user_id: currentUser.id,
          category: r.category,
          location: r.location,
          description: r.description,
          severity: r.severity,
          status: "submitted",
        }),
      });
      setReports((list) => [mapReportRow({ ...row, created_at: new Date().toISOString() }), ...list]);
      showToast("Report submitted — thank you");
    } catch (err) {
      showToast(err.message || "Could not submit report", "error");
    }
  };

  const handleAddCircleMember = async (m) => {
    try {
      const row = await apiFetch("/trusted-circle", {
        method: "POST",
        body: JSON.stringify({ user_id: currentUser.id, name: m.name, relation: m.relation, phone: m.phone }),
      });
      setCircle((list) => [...list, mapCircleRow(row, list.length)]);
      showToast("Trusted contact added");
    } catch (err) {
      showToast(err.message || "Could not add contact", "error");
    }
  };

  const handleRemoveCircleMember = async (id) => {
    try {
      await apiFetch(`/trusted-circle/${id}`, { method: "DELETE" });
      setCircle((list) => list.filter((m) => m.id !== id));
      showToast("Removed from circle");
    } catch (err) {
      showToast(err.message || "Could not remove contact", "error");
    }
  };

  // The clear-vs-caution result stays a lightweight demo heuristic
  // (no real geodata source) — this just saves the lookup for the record.
  const submitSafetyCheck = useCallback(async ({ location, caution, title, summary }) => {
    try {
      await apiFetch("/safety-checks", {
        method: "POST",
        body: JSON.stringify({
          user_id: currentUser?.id,
          location,
          result: caution ? "caution" : "clear",
          summary,
        }),
      });
    } catch {
      // non-critical — the result is already shown in the UI either way
    }
  }, [currentUser]);

  const triggerSos = useCallback(async () => {
    let coords = { latitude: null, longitude: null };
    if (navigator.geolocation) {
      try {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 2500 })
        );
        coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      } catch {
        // location unavailable/denied — still send the SOS with no coordinates
      }
    }
    try {
      await apiFetch("/sos-events", {
        method: "POST",
        body: JSON.stringify({ user_id: currentUser?.id, ...coords, status: "sent" }),
      });
    } catch (err) {
      showToast(err.message || "Could not send SOS", "error");
    }
  }, [currentUser, showToast]);

  const startSafeWalk = useCallback(async (durationSeconds) => {
    try {
      const row = await apiFetch("/safe-walk-sessions", {
        method: "POST",
        body: JSON.stringify({ user_id: currentUser?.id, duration_seconds: durationSeconds, status: "active" }),
      });
      return row.id;
    } catch (err) {
      showToast(err.message || "Could not start walk timer", "error");
      return null;
    }
  }, [currentUser, showToast]);

  const endSafeWalk = useCallback(async (sessionId, status) => {
    if (!sessionId) return;
    try {
      await apiFetch(`/safe-walk-sessions/${sessionId}`, {
        method: "PUT",
        body: JSON.stringify({ status, ended_at: new Date().toISOString().slice(0, 19).replace("T", " ") }),
      });
    } catch (err) {
      showToast(err.message || "Could not save walk status", "error");
    }
  }, [showToast]);

  const accent = ACCENT_PRESETS.find((a) => a.id === theme.accent) || ACCENT_PRESETS[0];
  const bg = BG_PRESETS.find((b) => b.id === theme.bg) || BG_PRESETS[0];

  const rootStyle = {
    "--bg": bg.bg,
    "--bg-grid": bg.bgGrid,
    "--panel": bg.panel,
    "--panel-raised": bg.panelRaised,
    "--border": bg.border,
    "--safe": accent.safe,
    "--safe-dim": accent.safeDim,
  };

  let content;
  if (!currentUser) {
    content = authView === "login" ? (
      <LoginPage onLogin={handleLogin} onGoSignup={() => setAuthView("signup")} />
    ) : (
      <SignupPage onSignup={handleSignup} onGoLogin={() => setAuthView("login")} />
    );
  } else if (booting) {
    content = (
      <div className="boot-screen">
        <BrandMark size={48} />
        <div className="boot-text">Loading your area…</div>
      </div>
    );
  } else {
    let pageContent;
    if (page === "home")
      pageContent = (
        <HomePage
          user={currentUser}
          alerts={alerts}
          circle={circle}
          onNavigate={setPage}
          onCheckLocation={submitSafetyCheck}
          onTriggerSos={triggerSos}
          onStartWalk={startSafeWalk}
          onEndWalk={endSafeWalk}
        />
      );
    else if (page === "alerts") pageContent = <AlertsPage alerts={alerts} onCheckLocation={submitSafetyCheck} />;
    else if (page === "report") pageContent = <ReportPage reports={reports} onAddReport={handleAddReport} />;
    else if (page === "circle")
      pageContent = (
        <CirclePage
          circle={circle}
          onAdd={handleAddCircleMember}
          onRemove={handleRemoveCircleMember}
          showToast={showToast}
        />
      );
    else if (page === "profile")
      pageContent = <ProfilePage user={currentUser} onUpdateProfile={updateProfile} onLogout={handleLogout} onNavigate={setPage} showToast={showToast} />;
    else if (page === "settings")
      pageContent = (
        <SettingsPage
          theme={theme}
          onChangeTheme={handleChangeTheme}
          prefs={prefs}
          onChangePrefs={handleChangePrefs}
          showToast={showToast}
          onLogout={handleLogout}
        />
      );

    content = (
      <AppShell user={currentUser} page={page} onNavigate={setPage} onLogout={handleLogout}>
        {pageContent}
      </AppShell>
    );
  }

  return (
    <div className="sg-root" style={rootStyle}>
      <style>{CSS}</style>
      <div className="bg-grid" />
      {content}
      <Toast toast={toast} />
    </div>
  );
}

/* ---------------------------- styles ---------------------------- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

.sg-root{
  --bg: #090d16;
  --bg-grid: #0d1424;
  --panel: #121a2e;
  --panel-raised: #16203a;
  --border: #212c46;
  --text: #eaf0f7;
  --text-dim: #8593ad;
  --text-faint: #566080;
  --safe: #35d28a;
  --safe-dim: rgba(53,210,138,0.14);
  --amber: #ffb648;
  --amber-dim: rgba(255,182,72,0.14);
  --danger: #ff5c5c;
  --danger-dim: rgba(255,92,92,0.15);
  --accent: #4c8dff;
  --font-display: 'Space Grotesk', sans-serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --radius-lg: 20px;
  --radius-md: 14px;
  --radius-sm: 9px;

  position: relative;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
  overflow-x: hidden;
  transition: background .25s ease;
}
.sg-root *{ box-sizing: border-box; }
.sg-root a{ color: inherit; text-decoration: none; }
.sg-root button{ font-family: inherit; cursor: pointer; }
.sg-root input, .sg-root select, .sg-root textarea{ font-family: inherit; }
.sg-root :focus-visible{ outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.sg-root ::selection{ background: var(--accent); color: #fff; }

.desktop-only{ display: none; }

.bg-grid{
  position: fixed; inset: 0; z-index: -1;
  background-image:
    linear-gradient(var(--bg-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--bg-grid) 1px, transparent 1px);
  background-size: 42px 42px;
  -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 90%);
  mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 90%);
  opacity: .6;
}

/* ---- auth pages ---- */
.auth-wrap{ position: relative; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 16px; }
.auth-card{
  width: 100%; max-width: 420px; background: var(--panel); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 32px 28px; animation: sg-fadeup .4s ease;
}
@keyframes sg-fadeup{ from{ opacity:0; transform: translateY(8px);} to{ opacity:1; transform: translateY(0);} }
.auth-brand{ display: flex; justify-content: center; margin-bottom: 18px; }
.auth-welcome{
  text-align: center; font-family: var(--font-mono); font-size: 12px; letter-spacing: 2px;
  color: var(--safe); font-weight: 700; margin-bottom: 10px;
}
.auth-title{ text-align: center; font-family: var(--font-display); font-size: 24px; font-weight: 700; }
.auth-sub{ text-align: center; color: var(--text-dim); font-size: 13.5px; margin-top: 6px; margin-bottom: 22px; }
.auth-form{ display: flex; flex-direction: column; gap: 14px; }
.auth-switch{ text-align: center; margin-top: 20px; font-size: 13.5px; color: var(--text-dim); }
.auth-switch a{ color: var(--safe); font-weight: 600; }
.auth-footnote{ font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); margin-top: 18px; text-align: center; }
.auth-demo-hint{ font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); text-align: center; }

.field{ display: flex; flex-direction: column; gap: 6px; }
.field-label{ font-size: 12.5px; font-weight: 600; color: var(--text-dim); }
.field-hint{ font-size: 11px; color: var(--text-faint); }
.field-error{ font-size: 11.5px; color: var(--danger); }
.form-error{
  background: var(--danger-dim); border: 1px solid rgba(255,92,92,0.3); color: #ff8a8a;
  font-size: 12.5px; padding: 10px 12px; border-radius: var(--radius-sm);
}

.text-input{
  background: var(--panel-raised); border: 1px solid var(--border); color: var(--text);
  border-radius: var(--radius-sm); padding: 11px 13px; font-size: 14px; width: 100%;
}
.text-input.compact{ padding: 8px 10px; font-size: 13px; width: auto; }
.text-input::placeholder{ color: var(--text-faint); }
.textarea{ resize: vertical; min-height: 90px; }

.pw-wrap{ position: relative; }
.pw-toggle{
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  background: none; border: none; color: var(--text-faint); padding: 4px; display: flex;
}
.pw-toggle svg{ width: 17px; height: 17px; }
.pw-toggle:hover{ color: var(--text-dim); }

.agree-row{ display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; color: var(--text-dim); }
.agree-row input{ margin-top: 2px; }

.auth-submit{
  margin-top: 4px; background: linear-gradient(135deg, #35d28a, #1aa97c); border: none; color: #06231a;
  font-weight: 700; font-size: 14px; border-radius: var(--radius-sm); padding: 13px 20px;
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.auth-submit:disabled{ opacity: .7; cursor: default; }
.auth-submit svg{ width: 16px; height: 16px; }

.btn-spinner{
  width: 15px; height: 15px; border-radius: 50%; border: 2px solid rgba(6,35,26,0.3);
  border-top-color: #06231a; animation: sg-spin .7s linear infinite;
}

.boot-screen{ min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
.boot-screen .brand-mark{ animation: sg-pulse 1.2s ease-in-out infinite; }
@keyframes sg-pulse{ 0%,100%{ transform: scale(1); opacity: 1;} 50%{ transform: scale(1.08); opacity: .8;} }
.boot-text{ font-family: var(--font-mono); font-size: 12.5px; color: var(--text-dim); letter-spacing: .5px; }

/* ---- app shell ---- */
.app-shell{ display: flex; min-height: 100vh; }

.sidebar{
  width: 248px; flex-shrink: 0; border-right: 1px solid var(--border);
  padding: 28px 20px; display: none; flex-direction: column;
  position: sticky; top: 0; height: 100vh;
}
.brand{ display: flex; align-items: center; gap: 10px; margin-bottom: 40px; padding-left: 4px; }
.brand-mark{
  width: 34px; height: 34px; border-radius: 10px;
  background: linear-gradient(135deg, #3ee0ab, #1aa97c);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.brand-mark svg{ width: 60%; height: 60%; }
.brand-name{ font-family: var(--font-display); font-weight: 700; font-size: 16.5px; letter-spacing: 1.5px; }

.nav{ display: flex; flex-direction: column; gap: 2px; flex: 1; }
.nav-item{
  display: flex; align-items: center; gap: 12px; padding: 11px 12px; border-radius: var(--radius-sm);
  color: var(--text-dim); font-size: 14px; font-weight: 500; background: none; border: none; width: 100%; text-align: left;
  transition: background .15s ease, color .15s ease;
}
.nav-item svg{ width: 18px; height: 18px; flex-shrink: 0; opacity: .85; }
.nav-item:hover{ background: var(--panel); color: var(--text); }
.nav-item.active{ background: var(--panel-raised); color: var(--text); box-shadow: inset 0 0 0 1px var(--border); }
.nav-item.active svg{ opacity: 1; color: var(--safe); }
.logout-item{ margin-top: 8px; color: #ff8a8a; }
.logout-item:hover{ background: var(--danger-dim); color: #ff8a8a; }

.sidebar-footer{
  display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); margin-top: 12px;
}
.avatar-sm{
  width: 30px; height: 30px; border-radius: 50%;
  background: linear-gradient(135deg,#8fe0c4,#4fbf98);
  display:flex; align-items:center; justify-content:center;
  font-size: 12px; font-weight: 700; color: #062017; flex-shrink:0;
}
.avatar-sm.lg{ width: 44px; height: 44px; font-size: 15px; }
.avatar-sm.xl{ width: 88px; height: 88px; font-size: 26px; }
.avatar-sm-img{ width: 30px; height: 30px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.sidebar-footer .who{ font-size: 13px; font-weight: 600; }
.sidebar-footer .role{ font-size: 11.5px; color: var(--text-faint); }

.main-col{ flex: 1; min-width: 0; display: flex; flex-direction: column; }

.topbar{
  display: flex; align-items: center; justify-content: space-between; padding: 16px 18px;
  border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 20;
  background: rgba(9,13,22,0.85); backdrop-filter: blur(10px);
}
.topbar .brand{ margin-bottom: 0; }
.topbar .brand-name{ font-size: 15px; }
.topbar-right{ display: flex; align-items: center; gap: 10px; }

.icon-btn{
  background: var(--panel-raised); border: 1px solid var(--border); color: var(--text-dim);
  border-radius: var(--radius-sm); width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
}
.icon-btn svg{ width: 16px; height: 16px; }
.icon-btn:hover{ color: var(--text); border-color: var(--accent); }
.icon-btn.danger{ color: #ff8a8a; background: var(--danger-dim); border-color: rgba(255,92,92,0.25); }
.icon-btn.danger:hover{ border-color: var(--danger); }

.status-pill{
  display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 20px;
  background: var(--safe-dim); color: var(--safe);
  font-family: var(--font-mono); font-size: 11.5px; font-weight: 600; letter-spacing: 0.4px;
}
.status-dot{
  width: 6px; height: 6px; border-radius: 50%; background: var(--safe);
  box-shadow: 0 0 0 0 rgba(53,210,138,0.6); animation: sg-dotpulse 2s infinite;
}
@keyframes sg-dotpulse{
  0%{ box-shadow: 0 0 0 0 rgba(53,210,138,0.55); }
  70%{ box-shadow: 0 0 0 6px rgba(53,210,138,0); }
  100%{ box-shadow: 0 0 0 0 rgba(53,210,138,0); }
}

.main{ flex: 1; min-width: 0; padding: 28px 20px 100px; }
.main-inner{ max-width: 1080px; margin: 0 auto; animation: sg-fadeup .3s ease; }

.page-head{ display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.greeting-eyebrow{ font-family: var(--font-mono); font-size: 11.5px; color: var(--text-faint); letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 6px; }
.greeting{ font-family: var(--font-display); font-size: clamp(22px, 4vw, 30px); font-weight: 600; }
.greeting-sub{ color: var(--text-dim); font-size: 14px; margin-top: 4px; max-width: 46ch; }

.dash-grid{ display: grid; grid-template-columns: 1fr; gap: 16px; }
.dash-col{ display: flex; flex-direction: column; gap: 16px; }
.grid-2{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.panel{ background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; }
.panel-label{ display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; gap: 10px; flex-wrap: wrap; }
.panel-label .lb{ font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); letter-spacing: 1px; text-transform: uppercase; }
.panel-label .meta{ font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); }
.link-btn{ background: none; border: none; color: var(--accent); font-size: 12.5px; font-weight: 600; padding: 0; }

.radar-panel{ position: relative; overflow: hidden; }
.radar-stage{
  position: relative; height: 240px; border-radius: var(--radius-md);
  background: radial-gradient(circle at 50% 50%, #0f1930 0%, #0a1120 70%);
  overflow: hidden; border: 1px solid var(--border);
}
.radar-rings{ position: absolute; top:50%; left:50%; transform: translate(-50%,-50%); width: 220px; height: 220px; }
.radar-rings::before, .radar-rings::after, .radar-rings i{
  content: ''; position: absolute; border-radius: 50%; border: 1px solid rgba(76,141,255,0.14);
}
.radar-rings::before{ inset: 0; }
.radar-rings::after{ inset: 36px; }
.radar-rings i{ position:absolute; inset: 72px; display:block; }
.radar-sweep{
  position: absolute; top:50%; left:50%; width: 220px; height: 220px; transform: translate(-50%,-50%);
  border-radius: 50%;
  background: conic-gradient(from 0deg, rgba(76,141,255,0.35), rgba(76,141,255,0) 28%);
  animation: sg-sweep 4s linear infinite;
}
@keyframes sg-sweep{ to{ transform: translate(-50%,-50%) rotate(360deg); } }

.radar-center-pin{
  position: absolute; top:50%; left:50%; transform: translate(-50%,-50%);
  width: 12px; height: 12px; border-radius: 50%; background: var(--safe);
  box-shadow: 0 0 0 5px rgba(53,210,138,0.18), 0 0 14px rgba(53,210,138,0.5); z-index: 3;
}
.radar-blip{
  position: absolute; width: 7px; height: 7px; border-radius: 50%;
  background: var(--amber); cursor: pointer; z-index: 2; box-shadow: 0 0 0 4px rgba(255,182,72,0.18);
}
.radar-blip.danger{ background: var(--danger); box-shadow: 0 0 0 4px rgba(255,92,92,0.18); }

.radar-readout{
  display: flex; justify-content: space-between; align-items: center; margin-top: 12px;
  font-family: var(--font-mono); font-size: 11.5px; color: var(--text-faint); flex-wrap: wrap; gap: 6px;
}
.radar-readout .live{ color: var(--safe); }

.stat-row{ display: grid; grid-template-columns: repeat(2,1fr); gap: 12px; }
.stat-card{ background: var(--panel-raised); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 16px; }
.stat-card .num{ font-family: var(--font-display); font-size: 26px; font-weight: 600; }
.stat-card .lb{ font-size: 12px; color: var(--text-dim); margin-top: 2px; }

.quick-grid{ display: grid; grid-template-columns: repeat(2,1fr); gap: 10px; }
.quick-btn{
  background: var(--panel-raised); border: 1px solid var(--border); color: var(--text);
  border-radius: var(--radius-md); padding: 14px 12px; text-align: left;
  display: flex; flex-direction: column; gap: 8px;
  transition: border-color .15s ease, transform .15s ease;
}
.quick-btn:hover{ border-color: var(--accent); transform: translateY(-1px); }
.quick-btn .ic{ font-size: 18px; }
.quick-btn .lb{ font-size: 13px; font-weight: 600; }

.sos-wrap{ display: flex; align-items: center; gap: 16px; }
.sos-btn{
  position: relative; width: 84px; height: 84px; border-radius: 50%; border: none; flex-shrink: 0;
  background: radial-gradient(circle at 35% 30%, #ff8a8a, #e04343 65%);
  color: #2b0808; font-family: var(--font-display); font-weight: 700; font-size: 15px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 0 6px rgba(255,92,92,0.12);
  user-select: none; -webkit-user-select: none; touch-action: none;
}
.sos-btn svg.ring{ position: absolute; inset: -6px; transform: rotate(-90deg); }
.sos-btn svg.ring circle{
  fill: none; stroke: #ffffff; stroke-width: 3;
  transition: stroke-dashoffset .05s linear;
}
.sos-copy .t{ font-weight: 600; font-size: 14px; }
.sos-copy .d{ font-size: 12.5px; color: var(--text-dim); margin-top: 3px; }
.sos-copy .demo-flag{ font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); margin-top: 6px; }

.check-row{ display: flex; gap: 10px; flex-wrap: wrap; }
.check-input{
  flex: 1; min-width: 180px; background: var(--panel-raised); border: 1px solid var(--border); color: var(--text);
  border-radius: var(--radius-sm); padding: 12px 14px; font-size: 14px;
}
.check-input::placeholder{ color: var(--text-faint); }
.check-btn{
  background: linear-gradient(135deg, #35d28a, #1aa97c); border: none; color: #06231a; font-weight: 700;
  font-size: 13.5px; border-radius: var(--radius-sm); padding: 12px 20px; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 6px;
}
.check-btn svg{ width: 15px; height: 15px; }
.check-btn:disabled{ opacity: .6; cursor: default; }

.check-result{ margin-top: 14px; padding: 14px; border-radius: var(--radius-md); display: none; align-items: center; gap: 12px; border: 1px solid var(--border); }
.check-result.show{ display: flex; }
.check-result.safe{ background: var(--safe-dim); border-color: rgba(53,210,138,0.3); }
.check-result.caution{ background: var(--amber-dim); border-color: rgba(255,182,72,0.3); }
.check-result .icon{ font-size: 20px; }
.check-result .title{ font-weight: 700; font-size: 13.5px; }
.check-result .sub{ font-size: 12.5px; color: var(--text-dim); margin-top: 2px; }

.check-spin{ display: none; align-items: center; gap: 8px; margin-top: 12px; font-family: var(--font-mono); font-size: 12px; color: var(--text-dim); }
.check-spin.show{ display: flex; }
.spinner{ width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--border); border-top-color: var(--accent); animation: sg-spin .7s linear infinite; }
@keyframes sg-spin{ to{ transform: rotate(360deg); } }

.feed-item{ display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.feed-item:last-child{ border-bottom: none; padding-bottom: 0; }
.feed-tag{ font-family: var(--font-mono); font-size: 10px; font-weight: 700; padding: 3px 7px; border-radius: 5px; height: fit-content; white-space: nowrap; letter-spacing: 0.4px; }
.feed-tag.critical{ background: var(--danger-dim); color: #ff8a8a; }
.feed-tag.warning{ background: var(--amber-dim); color: var(--amber); }
.feed-tag.resolved{ background: var(--safe-dim); color: var(--safe); }
.feed-body .t{ font-size: 13.5px; font-weight: 600; }
.feed-body .m{ font-family: var(--font-mono); font-size: 11.5px; color: var(--text-faint); margin-top: 3px; }

.empty-state{ font-size: 13px; color: var(--text-faint); padding: 18px 4px; text-align: center; }
.empty-inline{ font-size: 12px; color: var(--text-faint); }

.circle-row{ display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.circle-avatars{ display: flex; align-items: center; gap: 4px; }
.circle-avatars .avatar-sm{ margin-left: -8px; border: 2px solid var(--panel); }
.circle-avatars .avatar-sm:first-child{ margin-left: 0; }
.manage-link{ font-size: 12.5px; color: var(--accent); font-weight: 600; }

.circle-grid{ display: grid; grid-template-columns: 1fr; gap: 12px; }
.circle-card{
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-md);
  padding: 16px; display: flex; align-items: center; gap: 14px;
}
.circle-card-body{ flex: 1; min-width: 0; }
.circle-card-body .who{ font-size: 14px; font-weight: 600; }
.circle-card-body .role{ font-size: 12px; color: var(--text-dim); margin-top: 1px; }
.circle-phone{ display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11.5px; color: var(--text-faint); margin-top: 4px; }
.circle-phone svg{ width: 12px; height: 12px; }

.timer-row{ display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.timer-select{ background: var(--panel-raised); border: 1px solid var(--border); color: var(--text); border-radius: var(--radius-sm); padding: 10px 12px; font-size: 13px; }
.timer-display{ font-family: var(--font-mono); font-size: 22px; font-weight: 600; display:none; }
.timer-display.show{ display: block; }
.timer-btn{ background: var(--panel-raised); border: 1px solid var(--border); color: var(--text); border-radius: var(--radius-sm); padding: 10px 18px; font-weight: 600; font-size: 13px; }
.timer-btn.primary{ background: linear-gradient(135deg,#35d28a,#1aa97c); color:#06231a; border:none; }

/* ---- alerts page ---- */
.chip-row{ display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.chip{
  background: var(--panel-raised); border: 1px solid var(--border); color: var(--text-dim);
  border-radius: 20px; padding: 7px 13px; font-size: 12.5px; font-weight: 600; display: flex; gap: 6px; align-items: center;
}
.chip.active{ background: var(--safe-dim); border-color: rgba(53,210,138,0.35); color: var(--safe); }
.chip-count{ font-family: var(--font-mono); font-size: 10.5px; opacity: .8; }
.alert-list{ display: flex; flex-direction: column; }
.alert-card{ display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.alert-card:last-child{ border-bottom: none; }

/* ---- report page ---- */
.report-form{ display: flex; flex-direction: column; gap: 14px; }
.severity-row{ display: flex; gap: 8px; flex-wrap: wrap; }
.severity-pill{
  flex: 1; min-width: 130px; border-radius: var(--radius-sm); padding: 10px 12px; font-size: 12.5px; font-weight: 600;
  border: 1px solid var(--border); background: var(--panel-raised); color: var(--text-dim);
}
.severity-pill.warning.active{ background: var(--amber-dim); border-color: rgba(255,182,72,0.4); color: var(--amber); }
.severity-pill.critical.active{ background: var(--danger-dim); border-color: rgba(255,92,92,0.4); color: #ff8a8a; }
.row-gap{ display: flex; gap: 10px; flex-wrap: wrap; }

/* ---- profile page ---- */
.profile-card{ display: flex; flex-direction: column; gap: 14px; align-items: flex-start; }
.avatar-upload{ position: relative; align-self: center; }
.avatar-lg-img{ width: 88px; height: 88px; border-radius: 50%; object-fit: cover; }
.avatar-edit{
  position: absolute; bottom: -2px; right: -2px; width: 30px; height: 30px; border-radius: 50%;
  background: var(--safe); color: #06231a; border: 3px solid var(--panel); display: flex; align-items: center; justify-content: center;
}
.avatar-edit svg{ width: 14px; height: 14px; }
.profile-meta{ display: flex; flex-direction: column; gap: 8px; margin-top: 6px; width: 100%; }
.profile-meta-row{ display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-dim); }
.profile-meta-row svg{ width: 15px; height: 15px; color: var(--text-faint); flex-shrink: 0; }
.settings-link-row{
  width: 100%; display: flex; align-items: center; gap: 10px; background: var(--panel-raised); border: 1px solid var(--border);
  color: var(--text); border-radius: var(--radius-sm); padding: 12px 14px; font-size: 13.5px; font-weight: 600;
}
.settings-link-row svg{ width: 16px; height: 16px; }
.settings-link-row .chev{ margin-left: auto; color: var(--text-faint); }
.danger-btn{
  background: var(--danger-dim); border: 1px solid rgba(255,92,92,0.3); color: #ff8a8a;
  border-radius: var(--radius-sm); padding: 11px 16px; font-weight: 700; font-size: 13.5px;
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.danger-btn svg{ width: 15px; height: 15px; }
.confirm-row{ display: flex; flex-direction: column; gap: 10px; font-size: 13px; color: var(--text-dim); }

/* ---- settings page ---- */
.settings-block{ margin-bottom: 18px; }
.settings-block:last-child{ margin-bottom: 0; }
.settings-block-title{ font-size: 13px; font-weight: 600; margin-bottom: 10px; }
.swatch-row{ display: flex; gap: 10px; flex-wrap: wrap; }
.swatch{
  width: 34px; height: 34px; border-radius: 50%; border: 2px solid transparent; display: flex; align-items: center; justify-content: center;
  color: #06231a;
}
.swatch.active{ border-color: var(--text); }
.swatch svg{ width: 15px; height: 15px; }
.bg-swatch{
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px; border-radius: var(--radius-sm);
  border: 2px solid var(--border); width: 78px; color: var(--text);
}
.bg-swatch.active{ border-color: var(--safe); }
.bg-swatch svg{ width: 14px; height: 14px; }
.bg-swatch-label{ font-size: 10.5px; color: var(--text-dim); }

.settings-row{ display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.settings-row:last-child{ border-bottom: none; padding-bottom: 0; }
.settings-row-title{ font-size: 13.5px; font-weight: 600; }
.settings-row-sub{ font-size: 12px; color: var(--text-faint); margin-top: 2px; max-width: 32ch; }

.switch{ width: 40px; height: 22px; border-radius: 20px; background: var(--panel-raised); border: 1px solid var(--border); position: relative; flex-shrink: 0; }
.switch .knob{ position: absolute; top: 1px; left: 1px; width: 16px; height: 16px; border-radius: 50%; background: var(--text-faint); transition: transform .15s ease, background .15s ease; }
.switch.on{ background: var(--safe-dim); border-color: var(--safe); }
.switch.on .knob{ transform: translateX(18px); background: var(--safe); }

.range-input{ width: 100%; accent-color: var(--safe); }

.segmented{ display: flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.segmented button{ background: var(--panel-raised); color: var(--text-dim); border: none; padding: 7px 14px; font-size: 12.5px; font-weight: 600; }
.segmented button.active{ background: var(--safe-dim); color: var(--safe); }

/* ---- toast ---- */
.toast{
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 60;
  background: var(--panel-raised); border: 1px solid var(--border); color: var(--text);
  padding: 12px 18px; border-radius: var(--radius-md); font-size: 13px; font-weight: 600;
  display: flex; align-items: center; gap: 10px; box-shadow: 0 12px 28px rgba(0,0,0,0.35);
  animation: sg-toast-in .25s ease;
}
.toast svg{ width: 16px; height: 16px; color: var(--safe); flex-shrink: 0; }
.toast.error svg{ color: var(--danger); }
@keyframes sg-toast-in{ from{ opacity: 0; transform: translate(-50%, 10px);} to{ opacity: 1; transform: translate(-50%, 0);} }

/* ---- tab bar (mobile) ---- */
.tabbar{
  display: none; position: fixed; bottom: 0; left: 0; right: 0; z-index: 30;
  background: rgba(11,16,28,0.92); backdrop-filter: blur(14px);
  border-top: 1px solid var(--border); padding: 8px 6px calc(8px + env(safe-area-inset-bottom));
}
.tabbar-inner{ display: flex; justify-content: space-around; }
.tab-item{ display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--text-faint); font-size: 10.5px; font-weight: 600; padding: 6px 10px; border-radius: 10px; flex: 1; max-width: 84px; }
.tab-item svg{ width: 20px; height: 20px; }
.tab-item.active{ color: var(--safe); }

@media (min-width: 640px){
  .stat-row{ grid-template-columns: repeat(3, 1fr); }
}
@media (min-width: 900px){
  .sidebar{ display: flex; }
  .topbar{ display: none; }
  .main{ padding: 36px 40px 40px; }
  .dash-grid{ grid-template-columns: 1.3fr 1fr; align-items: start; }
  .stat-row{ grid-template-columns: repeat(3, 1fr); }
  .desktop-only{ display: inline-flex; }
}
@media (max-width: 899px){
  .tabbar{ display: block; }
  .main{ padding-bottom: 96px; }
}
@media (max-width: 560px){
  .grid-2{ grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce){
  .radar-sweep, .status-dot, .boot-screen .brand-mark{ animation: none !important; }
  .sg-root *{ transition: none !important; }
}

/* ---- added: TERREX logomark / lockup ---- */
.auth-lockup-header{
  display: flex;
  justify-content: center;
  margin-bottom: 18px;
}
.terrex-logo-lockup{ display: block; max-width: 100%; height: auto; }
.terrex-logomark{ display: block; border-radius: 22%; }
.sidebar-watermark{
  display: flex;
  justify-content: center;
  padding: 14px 0 4px;
  opacity: 0.7;
}
`;