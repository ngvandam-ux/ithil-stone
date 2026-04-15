import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Newspaper,
  ArrowLeft,
  Calendar,
  ChevronRight,
  Scroll,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import SubscribeForm from "@/components/subscribe-form";

interface NewsletterSummary {
  id: number;
  type: string;
  subject: string;
  sentAt: string | null;
  createdAt: string;
}

interface NewsletterFull extends NewsletterSummary {
  htmlContent: string;
}

const DISPATCH_QUOTES = [
  { quote: "I am a servant of the Secret Fire, wielder of the flame of Anor.", attribution: "— Gandalf" },
  { quote: "The world is changed. I feel it in the water. I feel it in the earth.", attribution: "— Treebeard" },
  { quote: "Not all those who wander are lost.", attribution: "— Bilbo Baggins" },
  { quote: "A hunted man sometimes wearies of distrust and longs for friendship.", attribution: "— Aragorn" },
  { quote: "Deeds will not be less valiant because they are unpraised.", attribution: "— Aragorn" },
];

const EMPTY_MESSAGES = [
  "No dispatches have been sent from the Stone. The silence is yet unbroken.",
  "The palantír reveals nothing — no word has yet gone forth.",
  "The archive lies empty. Soon, counsel will be recorded here.",
];

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getTypeBadge(type: string) {
  if (type === "weekly") {
    return (
      <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/10">
        The Palantír Report
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] border-primary/30 text-primary bg-primary/10">
      Daily Dispatch
    </Badge>
  );
}

// ── Detail view ───────────────────────────────────────────────────────
function NewsletterDetail({
  id,
  onBack,
}: {
  id: number;
  onBack: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  const { data: newsletter, isLoading } = useQuery<NewsletterFull>({
    queryKey: ["/api/newsletters", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/newsletters/${id}`);
      return res.json();
    },
  });

  // Scroll to top when loading a newsletter
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [id]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-4 w-64 mb-8" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!newsletter) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 text-center">
          <p className="text-muted-foreground">This dispatch could not be found.</p>
          <Button variant="ghost" onClick={onBack} className="mt-4 gap-2">
            <ArrowLeft className="w-4 h-4" /> Back to archive
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Back button */}
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors mb-6"
          data-testid="button-back-dispatches"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All Dispatches
        </button>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            {getTypeBadge(newsletter.type)}
            {newsletter.sentAt && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {formatDate(newsletter.sentAt)}
              </span>
            )}
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {newsletter.subject}
          </h1>
        </div>

        {/* Content */}
        <Card className="border-border/50 bg-card/80">
          <CardContent className="p-6 sm:p-8">
            <div
              ref={contentRef}
              className="prose prose-sm dark:prose-invert max-w-none
                prose-headings:font-semibold prose-headings:tracking-tight
                prose-h2:text-base prose-h2:mt-6 prose-h2:mb-3 prose-h2:text-primary
                prose-h3:text-sm prose-h3:mt-4 prose-h3:mb-2
                prose-p:text-sm prose-p:leading-relaxed prose-p:text-foreground/85
                prose-li:text-sm prose-li:text-foreground/85
                prose-strong:text-foreground prose-strong:font-semibold
                prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                prose-hr:border-border/50"
              dangerouslySetInnerHTML={{ __html: newsletter.htmlContent }}
            />
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="mt-8 text-center">
          <button
            onClick={onBack}
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            ← Back to all dispatches
          </button>
        </div>
      </div>
    </div>
  );
}

// ── List view ─────────────────────────────────────────────────────────
export default function Dispatches() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [emptyMsg] = useState(() => EMPTY_MESSAGES[Math.floor(Math.random() * EMPTY_MESSAGES.length)]);
  const [quote] = useState(() => DISPATCH_QUOTES[Math.floor(Math.random() * DISPATCH_QUOTES.length)]);

  const { data: newsletters, isLoading } = useQuery<NewsletterSummary[]>({
    queryKey: ["/api/newsletters"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/newsletters");
      return res.json();
    },
  });

  // If viewing a specific newsletter
  if (selectedId !== null) {
    return <NewsletterDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Newspaper className="w-4 h-4 text-primary" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Dispatches
            </h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-lg">
            Strategic intelligence from the Stone — meta analysis, tournament results, and counsel for the battlefield.
          </p>
          {/* Subscribe CTA */}
          <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/10">
            <p className="text-xs text-muted-foreground mb-2">Receive dispatches directly — strategic intel delivered to your inbox.</p>
            <SubscribeForm source="dispatches" compact />
          </div>

          {/* LOTR quote */}
          <div className="mt-4 border-l-2 border-primary/20 pl-3">
            <p className="text-xs text-muted-foreground/70 italic"
              style={{ fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif" }}>
              "{quote.quote}"
            </p>
            <p className="text-[10px] text-muted-foreground/50 mt-0.5">{quote.attribution}</p>
          </div>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && (!newsletters || newsletters.length === 0) && (
          <Card className="border-border/50 bg-card/60">
            <CardContent className="py-16 text-center">
              <Scroll className="w-10 h-10 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-sm text-muted-foreground italic"
                style={{ fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif" }}>
                {emptyMsg}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Newsletter list */}
        {newsletters && newsletters.length > 0 && (
          <div className="space-y-2">
            {newsletters.map((nl) => (
              <button
                key={nl.id}
                onClick={() => setSelectedId(nl.id)}
                className="w-full text-left group"
                data-testid={`dispatch-item-${nl.id}`}
              >
                <Card className="border-border/50 bg-card/60 hover:bg-card/90 hover:border-primary/20 transition-all duration-200 cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        {getTypeBadge(nl.type)}
                        {nl.sentAt && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDate(nl.sentAt)}
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                        {nl.subject}
                      </h3>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0 ml-3" />
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
