// Session ID management - stored in memory (no localStorage in sandboxed iframe)
let sessionId: string | null = null;

function generateId(): string {
  return crypto.randomUUID?.() || 
    'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

export function getSessionId(): string {
  if (!sessionId) {
    sessionId = generateId();
  }
  return sessionId;
}
