import { apiRequest } from "./queryClient";
import { getSessionId } from "./session";

// Override fetch to always include session header
const originalFetch = window.fetch;
window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("x-session-id", getSessionId());
  return originalFetch(input, { ...init, headers });
};

export { apiRequest };
