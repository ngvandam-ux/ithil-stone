import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, Check, Coins } from "lucide-react";

interface SubscribeFormProps {
  source?: string;
  compact?: boolean;
}

export default function SubscribeForm({ source = "website", compact = false }: SubscribeFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [bonusGranted, setBonusGranted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return;
    setStatus("loading");
    try {
      const res = await apiRequest("POST", "/api/subscribe", { email: email.trim(), source });
      const data = await res.json();
      setBonusGranted(data.bonusGranted || false);
      setStatus("success");
      setEmail("");
      // Refresh credit balance in nav
      queryClient.invalidateQueries({ queryKey: ["/api/credits"] });
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Failed to subscribe");
    }
  };

  if (status === "success") {
    return (
      <div className={`flex flex-col items-center gap-1 ${compact ? "" : "py-3"}`}>
        <div className="flex items-center gap-2 text-primary">
          <Check className="w-4 h-4" />
          <span className="text-sm font-medium">Subscribed to the dispatches</span>
        </div>
        {bonusGranted && (
          <div className="flex items-center gap-1.5 text-xs text-primary/70 animate-in fade-in">
            <Coins className="w-3 h-3" />
            <span>+1 bonus ring granted</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`flex items-center gap-2 ${compact ? "" : "justify-center"}`}>
      <div className="relative">
        <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setStatus("idle"); }}
          placeholder="your@email.com"
          className="h-8 w-44 sm:w-52 pl-8 pr-2 text-xs bg-muted/50 border border-border/50 rounded-md
            focus:outline-none focus:ring-1 focus:ring-primary/50
            placeholder:text-muted-foreground/40"
          data-testid="input-subscribe-email"
        />
      </div>
      <Button
        type="submit"
        size="sm"
        disabled={status === "loading" || !email.includes("@")}
        className="h-8 px-3 text-xs gap-1.5"
        data-testid="button-subscribe"
      >
        {status === "loading" ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <>
            <Mail className="w-3 h-3" />
            Subscribe
          </>
        )}
      </Button>
      {status === "error" && (
        <span className="text-xs text-destructive">{errorMsg}</span>
      )}
      {status === "idle" && (
        <span className="text-[10px] text-primary/50 flex items-center gap-1">
          <Coins className="w-2.5 h-2.5" />+1 free ring
        </span>
      )}
    </form>
  );
}
