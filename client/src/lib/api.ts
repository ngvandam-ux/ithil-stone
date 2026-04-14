import { apiRequest } from "./queryClient";
import { getSessionId, getAuthToken } from "./session";

// Override fetch to always include session + auth headers
const originalFetch = window.fetch;
window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("x-session-id", getSessionId());

  const authToken = getAuthToken();
  if (authToken) {
    headers.set("x-auth-token", authToken);
  }

  return originalFetch(input, { ...init, headers });
};

export { apiRequest };
