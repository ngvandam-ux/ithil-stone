import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export default function AuthVerify() {
  const params = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const { verifyToken } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const token = params.token;

    if (!token) {
      setStatus("error");
      setErrorMsg("No verification token found.");
      return;
    }

    verifyToken(token).then((result) => {
      if (result.success) {
        setStatus("success");
        // Invalidate queries so credits/analyses reflect the logged-in user
        queryClient.invalidateQueries({ queryKey: ["/api/credits"] });
        queryClient.invalidateQueries({ queryKey: ["/api/analyses"] });
        // Redirect to home after a moment
        setTimeout(() => navigate("/"), 2000);
      } else {
        setStatus("error");
        setErrorMsg(result.error || "Verification failed.");
      }
    });
  }, [params.token, verifyToken, navigate, queryClient]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto" />
            <h1 className="font-display text-xl tracking-wide">Verifying your key...</h1>
            <p className="text-muted-foreground text-sm">The palantír is authenticating your identity.</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
            <h1 className="font-display text-xl tracking-wide">Access Granted</h1>
            <p className="text-muted-foreground text-sm">
              The seeing-stone recognizes you. Redirecting to the council chamber...
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-red-400 mx-auto" />
            <h1 className="font-display text-xl tracking-wide">Access Denied</h1>
            <p className="text-muted-foreground text-sm">{errorMsg}</p>
            <button
              onClick={() => navigate("/")}
              className="mt-4 px-6 py-2 bg-primary/20 hover:bg-primary/30 text-primary rounded-lg transition-colors text-sm"
            >
              Return to the Stone
            </button>
          </>
        )}
      </div>
    </div>
  );
}
