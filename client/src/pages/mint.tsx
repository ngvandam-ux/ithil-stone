import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Coins,
  Gem,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Shield,
  Sparkles,
  ChevronLeft,
  CreditCard,
} from "lucide-react";
import { Link } from "wouter";

// ── Your Solana wallet address ──
const SOLANA_WALLET = "5purmEfPT59dbTupSXjk7XxZqQGmbsvLsXmBNSsBE2us";

// ── Stripe Payment Links ──
const STRIPE_LINKS: Record<string, string> = {
  "pack-3": "https://buy.stripe.com/6oUeVe3rXaQCaZS5ax1kA02",   // Scout's Pouch — $1.99
  "pack-10": "https://buy.stripe.com/aFa4gA1jPbUGgkc6eB1kA01",  // Ranger's Satchel — $4.99
  "pack-30": "https://buy.stripe.com/7sY4gAgeJ8Iuec432p1kA00",  // War Chest — $12.99
};

interface RingPack {
  id: string;
  rings: number;
  priceUsd: number;
  priceSol: number;
  label: string;
}

const PACK_LORE: Record<string, { desc: string; icon: string }> = {
  "pack-3": {
    desc: "A small pouch of mithril, enough for a scout's errand.",
    icon: "🗡️",
  },
  "pack-10": {
    desc: "The trusted satchel of a Ranger of the North — provisions for many roads.",
    icon: "⚔️",
  },
  "pack-30": {
    desc: "A chest fit for a lord of war. With this, counsel without end.",
    icon: "👑",
  },
};

type PaymentMethod = "solana" | "stripe" | null;
type PaymentStep = "select" | "method" | "pay" | "confirm";

export default function Mint() {
  const { toast } = useToast();
  const [selectedPack, setSelectedPack] = useState<RingPack | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(null);
  const [step, setStep] = useState<PaymentStep>("select");
  const [copied, setCopied] = useState(false);
  const [txSignature, setTxSignature] = useState("");

  const { data: packs } = useQuery<RingPack[]>({
    queryKey: ["/api/ring-packs"],
  });

  const { data: creditsData } = useQuery<{ coins: number }>({
    queryKey: ["/api/credits"],
  });

  // Solana confirmation mutation
  const solanaConfirm = useMutation({
    mutationFn: async (data: { packId: string; txSignature: string }) => {
      const res = await apiRequest("POST", "/api/payments/solana/confirm", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credits"] });
      setStep("confirm");
      toast({
        title: "The Forge Rings True",
        description: `${selectedPack?.rings} Mithril Rings have been added to your coffers.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "The Forge Falters",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Stripe confirmation mutation
  const stripeConfirm = useMutation({
    mutationFn: async (data: { packId: string; sessionIdOrRef: string }) => {
      const res = await apiRequest("POST", "/api/payments/stripe/confirm", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credits"] });
      setStep("confirm");
      toast({
        title: "The Forge Rings True",
        description: `${selectedPack?.rings} Mithril Rings have been added to your coffers.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "The Forge Falters",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(SOLANA_WALLET);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for sandboxed environments
      const ta = document.createElement("textarea");
      ta.value = SOLANA_WALLET;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSolanaConfirm = () => {
    if (!selectedPack || !txSignature.trim()) {
      toast({
        title: "Missing Transaction",
        description: "Paste your Solana transaction signature to confirm.",
        variant: "destructive",
      });
      return;
    }
    solanaConfirm.mutate({ packId: selectedPack.id, txSignature: txSignature.trim() });
  };

  const handleStripePayment = () => {
    if (!selectedPack) return;
    const link = STRIPE_LINKS[selectedPack.id];
    if (link && !link.startsWith("STRIPE_LINK")) {
      // Open real Stripe payment link in new tab
      window.open(link, "_blank", "noopener,noreferrer");
    }
  };

  const handleStripePaid = () => {
    if (!selectedPack) return;
    const ref = `stripe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    stripeConfirm.mutate({ packId: selectedPack.id, sessionIdOrRef: ref });
  };

  const resetFlow = () => {
    setSelectedPack(null);
    setPaymentMethod(null);
    setStep("select");
    setTxSignature("");
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="text-center mb-10 pt-4">
          <Gem className="w-10 h-10 text-primary/60 mx-auto mb-4" />
          <h1 className="font-display text-xl font-bold tracking-wide mb-2">
            The Dwarven Mint
          </h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Deep in the halls of Khazad-dûm, Mithril Rings are forged. 
            Each ring grants one audience with the seeing-stone.
          </p>
          <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
            <Coins className="w-4 h-4" />
            <span>{creditsData?.coins ?? "..."} Rings</span>
          </div>
        </div>

        {/* Step: Confirmation success */}
        {step === "confirm" && (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-primary" />
            </div>
            <h2 className="font-display text-lg font-semibold mb-2">
              The Rings Are Forged
            </h2>
            <p className="text-sm text-muted-foreground mb-1">
              {selectedPack?.rings} Mithril Rings have been added to your coffers.
            </p>
            <p className="text-xs text-muted-foreground/50 mb-6">
              Your balance: {creditsData?.coins ?? "..."} Rings
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" onClick={resetFlow}>
                Forge More
              </Button>
              <Link href="/">
                <Button size="sm" className="gap-2">
                  <Sparkles className="w-3.5 h-3.5" />
                  Consult the Stone
                </Button>
              </Link>
            </div>
          </div>
        )}

        {/* Step: Select pack */}
        {step === "select" && (
          <div className="space-y-4">
            <h2 className="font-display text-sm font-medium text-muted-foreground text-center mb-6">
              Choose Your Provision
            </h2>
            <div className="grid gap-4">
              {(packs || []).map((pack) => {
                const lore = PACK_LORE[pack.id] || { desc: "", icon: "💎" };
                return (
                  <button
                    key={pack.id}
                    onClick={() => {
                      setSelectedPack(pack);
                      setStep("method");
                    }}
                    className="text-left group"
                    data-testid={`pack-${pack.id}`}
                  >
                    <Card className="border-border/40 hover:border-primary/40 transition-all duration-200 hover:shadow-md">
                      <CardContent className="p-5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-primary/8 flex items-center justify-center text-xl shrink-0">
                              {lore.icon}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-display text-sm font-semibold">
                                  {pack.label}
                                </span>
                                <Badge variant="secondary" className="text-xs">
                                  {pack.rings} Rings
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 italic">
                                {lore.desc}
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-4">
                            <div className="text-sm font-semibold">${pack.priceUsd}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {pack.priceSol} SOL
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </button>
                );
              })}
            </div>

            {/* Trust signals */}
            <div className="flex items-center justify-center gap-4 mt-8 text-xs text-muted-foreground/50">
              <span className="flex items-center gap-1">
                <Shield className="w-3 h-3" />
                Instant delivery
              </span>
              <span>·</span>
              <span>No account needed</span>
              <span>·</span>
              <span>Card or Crypto</span>
            </div>
          </div>
        )}

        {/* Step: Choose payment method */}
        {step === "method" && selectedPack && (
          <div className="space-y-4">
            <button
              onClick={() => { setStep("select"); setPaymentMethod(null); }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>

            <div className="text-center mb-6">
              <h2 className="font-display text-sm font-medium text-muted-foreground">
                Purchasing: {selectedPack.label}
              </h2>
              <p className="text-lg font-semibold mt-1">
                {selectedPack.rings} Mithril Rings
              </p>
            </div>

            <div className="grid gap-3 max-w-sm mx-auto">
              {/* Stripe / Card option */}
              <button
                onClick={() => {
                  setPaymentMethod("stripe");
                  setStep("pay");
                }}
                className="text-left"
                data-testid="method-stripe"
              >
                <Card className="border-border/40 hover:border-primary/40 transition-all duration-200">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#635BFF] to-[#A259FF] flex items-center justify-center shrink-0">
                      <CreditCard className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">Credit / Debit Card</div>
                      <div className="text-xs text-muted-foreground">
                        ${selectedPack.priceUsd} USD · Powered by Stripe
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/30">
                      Easy
                    </Badge>
                  </CardContent>
                </Card>
              </button>

              {/* Solana option */}
              <button
                onClick={() => {
                  setPaymentMethod("solana");
                  setStep("pay");
                }}
                className="text-left"
                data-testid="method-solana"
              >
                <Card className="border-border/40 hover:border-primary/40 transition-all duration-200">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#9945FF] to-[#14F195] flex items-center justify-center shrink-0">
                      <span className="text-white text-xs font-bold">SOL</span>
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">Solana</div>
                      <div className="text-xs text-muted-foreground">
                        {selectedPack.priceSol} SOL · Instant
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/50">
                      Crypto
                    </Badge>
                  </CardContent>
                </Card>
              </button>
            </div>
          </div>
        )}

        {/* Step: Solana payment */}
        {step === "pay" && paymentMethod === "solana" && selectedPack && (
          <div className="space-y-4">
            <button
              onClick={() => { setStep("method"); setPaymentMethod(null); setTxSignature(""); }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>

            <Card className="border-primary/20 palantir-glow">
              <CardContent className="p-6 space-y-5">
                <div className="text-center">
                  <h3 className="font-display text-sm font-semibold mb-1">
                    Send {selectedPack.priceSol} SOL
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    to the address below from any Solana wallet
                  </p>
                </div>

                {/* Wallet address */}
                <div className="bg-muted/50 rounded-lg p-3 flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono break-all text-foreground/80">
                    {SOLANA_WALLET}
                  </code>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 shrink-0"
                        onClick={copyAddress}
                        data-testid="button-copy-address"
                      >
                        {copied ? (
                          <CheckCircle2 className="w-4 h-4 text-primary" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{copied ? "Copied!" : "Copy address"}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>

                <div className="bg-muted/30 rounded-lg p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1">Amount</div>
                  <div className="text-lg font-semibold font-mono">{selectedPack.priceSol} SOL</div>
                  <div className="text-[10px] text-muted-foreground/50 mt-0.5">
                    ≈ ${selectedPack.priceUsd} USD
                  </div>
                </div>

                {/* Steps */}
                <div className="space-y-2.5 text-xs text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">1</span>
                    <span>Open your Solana wallet (Phantom, Solflare, etc.)</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">2</span>
                    <span>Send exactly <strong className="text-foreground">{selectedPack.priceSol} SOL</strong> to the address above</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">3</span>
                    <span>Paste the transaction signature below and confirm</span>
                  </div>
                </div>

                {/* Transaction signature input */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Transaction Signature
                  </label>
                  <input
                    type="text"
                    value={txSignature}
                    onChange={(e) => setTxSignature(e.target.value)}
                    placeholder="Paste your Solana transaction signature..."
                    className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    data-testid="input-tx-signature"
                  />
                </div>

                <Button
                  onClick={handleSolanaConfirm}
                  disabled={!txSignature.trim() || solanaConfirm.isPending}
                  className="w-full gap-2"
                  data-testid="button-confirm-solana"
                >
                  {solanaConfirm.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Verifying at the Forge...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Confirm Payment
                    </>
                  )}
                </Button>

                <p className="text-[10px] text-center text-muted-foreground/40">
                  Rings are credited instantly upon confirmation.
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step: Stripe / Card payment */}
        {step === "pay" && paymentMethod === "stripe" && selectedPack && (
          <div className="space-y-4">
            <button
              onClick={() => { setStep("method"); setPaymentMethod(null); }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>

            <Card className="border-primary/20 palantir-glow">
              <CardContent className="p-6 space-y-5">
                <div className="text-center">
                  <h3 className="font-display text-sm font-semibold mb-1">
                    Pay ${selectedPack.priceUsd} via Card
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Secure checkout powered by Stripe
                  </p>
                </div>

                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <div className="text-xs text-muted-foreground mb-1">Amount</div>
                  <div className="text-lg font-semibold font-mono">${selectedPack.priceUsd}</div>
                  <div className="text-[10px] text-muted-foreground/50 mt-1 flex items-center justify-center gap-1.5">
                    <CreditCard className="w-3 h-3" />
                    Visa, Mastercard, Amex, Apple Pay, Google Pay
                  </div>
                </div>

                {/* Steps */}
                <div className="space-y-2.5 text-xs text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#635BFF]/20 text-[#635BFF] dark:text-[#A78BFA] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">1</span>
                    <span>Click <strong className="text-foreground">Pay with Stripe</strong> below to open the checkout page</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#635BFF]/20 text-[#635BFF] dark:text-[#A78BFA] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">2</span>
                    <span>Complete your payment on Stripe's secure page</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#635BFF]/20 text-[#635BFF] dark:text-[#A78BFA] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">3</span>
                    <span>Return here and click <strong className="text-foreground">I've Completed Payment</strong></span>
                  </div>
                </div>

                {/* Stripe checkout link */}
                <Button
                  variant="outline"
                  className="w-full gap-2 text-[#635BFF] border-[#635BFF]/30 hover:bg-[#635BFF]/5"
                  onClick={handleStripePayment}
                  data-testid="button-open-stripe"
                >
                  <ExternalLink className="w-4 h-4" />
                  Pay with Stripe
                </Button>

                <Button
                  onClick={handleStripePaid}
                  disabled={stripeConfirm.isPending}
                  className="w-full gap-2"
                  data-testid="button-confirm-stripe"
                >
                  {stripeConfirm.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Recording at the Forge...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      I've Completed Payment
                    </>
                  )}
                </Button>

                <p className="text-[10px] text-center text-muted-foreground/40">
                  Rings are credited immediately. If payment is not received, 
                  access may be adjusted.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
