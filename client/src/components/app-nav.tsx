import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Coins, Sun, Moon, Eye, Scroll, Gem, User, LogOut, Mail, Loader2 } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@/lib/auth";

// Palantír SVG logo component
function PalantirLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-label="Ithil-stone"
    >
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      <ellipse cx="16" cy="16" rx="5" ry="7" stroke="currentColor" strokeWidth="1" opacity="0.8" />
      <circle cx="16" cy="16" r="2.5" fill="currentColor" opacity="0.7" />
      <circle cx="13.5" cy="13" r="1.2" fill="currentColor" opacity="0.4" />
      <circle cx="16" cy="4" r="0.8" fill="currentColor" opacity="0.5" />
      <circle cx="11" cy="5.5" r="0.6" fill="currentColor" opacity="0.35" />
      <circle cx="21" cy="5.5" r="0.6" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

// ── Login dialog (inline in nav) ─────────────────────────────────────
function LoginFlow() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return;
    setStatus("sending");
    const result = await login(email);
    if (result.success) {
      setStatus("sent");
    } else {
      setStatus("error");
      setErrorMsg(result.error || "Failed to send");
    }
  };

  if (!isOpen) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="text-xs gap-1.5 text-muted-foreground hover:text-primary"
      >
        <User className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Sign In</span>
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {status === "sent" ? (
        <div className="flex items-center gap-2 text-xs text-green-400">
          <Mail className="w-3.5 h-3.5" />
          <span>Check your email</span>
          <button
            onClick={() => { setIsOpen(false); setStatus("idle"); setEmail(""); }}
            className="text-muted-foreground hover:text-foreground ml-1"
          >
            ×
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="w-36 sm:w-44 h-7 px-2 text-xs bg-muted/50 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
            autoFocus
          />
          <Button
            type="submit"
            size="sm"
            disabled={status === "sending" || !email.includes("@")}
            className="h-7 px-3 text-xs"
          >
            {status === "sending" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              "Send Link"
            )}
          </Button>
          <button
            type="button"
            onClick={() => { setIsOpen(false); setStatus("idle"); setEmail(""); }}
            className="text-muted-foreground hover:text-foreground text-sm ml-0.5"
          >
            ×
          </button>
        </form>
      )}
      {status === "error" && (
        <span className="text-xs text-red-400">{errorMsg}</span>
      )}
    </div>
  );
}

// ── User menu (when logged in) ──────────────────────────────────────
function UserMenu() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    await logout();
    queryClient.invalidateQueries({ queryKey: ["/api/credits"] });
    queryClient.invalidateQueries({ queryKey: ["/api/analyses"] });
  };

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs gap-1.5 text-muted-foreground hover:text-primary max-w-[140px]"
        >
          <User className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate hidden sm:inline">{user.email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <div className="px-2 py-1.5">
          <p className="text-xs font-medium truncate">{user.email}</p>
          <p className="text-[10px] text-muted-foreground">Signed in</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="text-xs gap-2 text-red-400">
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AppNav() {
  const { theme, toggleTheme } = useTheme();
  const [location] = useLocation();
  const { user, loading } = useAuth();

  const { data: creditsData } = useQuery<{ coins: number }>({
    queryKey: ["/api/credits"],
  });

  const isActive = (path: string) => location === path;

  return (
    <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Left: Logo + nav */}
        <div className="flex items-center gap-4">
          <Link href="/">
            <div className="flex items-center gap-2.5 cursor-pointer" data-testid="nav-home">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <PalantirLogo className="w-5 h-5 text-primary" />
              </div>
              <span className="font-display font-semibold text-sm tracking-wide hidden sm:inline">
                Ithil-stone
              </span>
            </div>
          </Link>

          <nav className="flex items-center gap-1 ml-2">
            <Link href="/">
              <Button
                variant="ghost"
                size="sm"
                className={`text-xs gap-1.5 ${isActive("/") ? "text-primary bg-primary/8" : "text-muted-foreground"}`}
                data-testid="nav-consult"
              >
                <Eye className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Consult</span>
              </Button>
            </Link>
            <Link href="/chronicle">
              <Button
                variant="ghost"
                size="sm"
                className={`text-xs gap-1.5 ${isActive("/chronicle") ? "text-primary bg-primary/8" : "text-muted-foreground"}`}
                data-testid="nav-chronicle"
              >
                <Scroll className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Chronicle</span>
              </Button>
            </Link>
            <Link href="/mint">
              <Button
                variant="ghost"
                size="sm"
                className={`text-xs gap-1.5 ${isActive("/mint") ? "text-primary bg-primary/8" : "text-muted-foreground"}`}
                data-testid="nav-mint"
              >
                <Gem className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Mint</span>
              </Button>
            </Link>
          </nav>
        </div>

        {/* Right: Auth + Ring balance + theme */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Auth */}
          {!loading && (user ? <UserMenu /> : <LoginFlow />)}

          {/* Ring balance */}
          <Link href="/mint">
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium cursor-pointer hover:bg-primary/15 transition-colors"
                  data-testid="coin-balance"
                >
                  <Coins className="w-3.5 h-3.5" />
                  <span>{creditsData?.coins ?? "..."}</span>
                  <span className="text-primary/60 hidden sm:inline">rings</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Mithril Rings — click to get more</p>
              </TooltipContent>
            </Tooltip>
          </Link>

          {/* Theme toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="w-8 h-8"
                data-testid="button-theme"
              >
                {theme === "dark" ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{theme === "dark" ? "Light of the Two Trees" : "Shade of Ungoliant"}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
