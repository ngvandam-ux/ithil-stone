import { useEffect } from "react";

export function usePageTracker() {
  useEffect(() => {
    try {
      // Parse UTM params from URL (works with hash routing)
      const fullUrl = window.location.href;
      const searchStr = fullUrl.includes("?") ? fullUrl.split("?").pop()?.split("#")[0] : "";
      const params = new URLSearchParams(searchStr || "");

      const source = params.get("utm_source");
      const medium = params.get("utm_medium");
      const campaign = params.get("utm_campaign");
      const referrer = document.referrer || "";
      const page = window.location.hash?.replace("#", "") || "/";

      // Get session ID from existing header pattern
      const sessionId = document.cookie.match(/session_id=([^;]+)/)?.[1] || "";

      fetch("/api/track", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-id": sessionId,
        },
        body: JSON.stringify({ page, source, medium, campaign, referrer }),
      }).catch(() => {}); // Silent fail
    } catch {
      // Never break the site for tracking
    }
  }, []);
}
