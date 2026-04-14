import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { getAuthToken, setAuthToken, clearAuthToken } from "./session";

interface User {
  id: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string) => Promise<{ success: boolean; error?: string }>;
  verifyToken: (token: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Check if already logged in on mount
  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      fetch("/api/auth/me")
        .then((r) => r.json())
        .then((data) => {
          if (data.user) {
            setUser(data.user);
          } else {
            clearAuthToken();
          }
        })
        .catch(() => clearAuthToken())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string) => {
    try {
      const res = await fetch("/api/auth/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || "Failed to send link" };
      }
      return { success: true };
    } catch {
      return { success: false, error: "Network error" };
    }
  }, []);

  const verifyToken = useCallback(async (token: string) => {
    try {
      const res = await fetch(`/api/auth/verify?token=${token}`);
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || "Invalid link" };
      }
      setAuthToken(data.authToken);
      setUser(data.user);
      return { success: true };
    } catch {
      return { success: false, error: "Network error" };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    clearAuthToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
