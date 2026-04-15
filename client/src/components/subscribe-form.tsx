import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, Check } from "lucide-react";

interface SubscribeFormProps {
  source?: string;
  compact?: boolean;
}

export default function SubscribeForm({ source = "website", compact = false }: SubscribeFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return;
    setStatus("loading");
    try {
      await apiRequest("POST", "/api/subscribe", { email: email.trim(), source });
      setStatus("success");
      setEmail("");
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Failed to subscribe");
    }
  };

  if (status === "success") {
    return (
      <div className={`flex items-center gap-2 ${compact ? "" : "justify-center py-3"}`}>
        <div className="flex items-center gap-2 text-primary">
          <Check className="w-4 h-4" />
          <span className="text-sm font-medium">Subscribed to the dispatches</span>
        </div>
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
    </form>
  );
}
