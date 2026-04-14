// Session ID management — persisted to localStorage so rings survive refresh
const SESSION_KEY = "ithilstone_session_id";
const AUTH_TOKEN_KEY = "ithilstone_auth_token";

function generateId(): string {
  return crypto.randomUUID?.() ||
    'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

// ── Session ID (anonymous identity) ──────────────────────────────────
export function getSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = generateId();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // Fallback for sandboxed iframes
    return generateId();
  }
}

// ── Auth Token (logged-in identity) ──────────────────────────────────
export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {}
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {}
}
