import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Scroll,
  ArrowRight,
  BarChart3,
  Layers,
  Eye,
  Swords,
  Calendar,
  ChevronLeft,
} from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import type { Analysis } from "@shared/schema";
import AnalysisView from "@/components/analysis-view";
import ManaCurveChart from "@/components/mana-curve-chart";
import ColorDistChart from "@/components/color-dist-chart";
import StatsCards from "@/components/stats-cards";

const CHRONICLE_QUOTES = [
  { quote: "The tale is not yet finished, though the hour is late.", attribution: "— Gandalf" },
  { quote: "Many that live deserve death. And some that die deserve life. Can you give it to them?", attribution: "— Gandalf" },
  { quote: "Even the very wise cannot see all ends.", attribution: "— Gandalf" },
  { quote: "There is more in you of good than you know.", attribution: "— Thorin Oakenshield" },
];

const EMPTY_CHRONICLE = [
  "No visions have been recorded. The stone's memory lies empty.",
  "The chronicle is bare — no armies have yet been presented for counsel.",
  "These pages hold no record. Submit your first deck to begin the chronicle.",
];

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getFormatColor(format: string): string {
  const map: Record<string, string> = {
    modern: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    standard: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    legacy: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    vintage: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    pioneer: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    pauper: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    commander: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    historic: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    explorer: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  };
  return map[format] || "bg-primary/10 text-primary border-primary/20";
}

export default function Chronicle() {
  const [selectedAnalysis, setSelectedAnalysis] = useState<Analysis | null>(null);
  const [emptyMsg] = useState(() => EMPTY_CHRONICLE[Math.floor(Math.random() * EMPTY_CHRONICLE.length)]);
  const [quote] = useState(() => CHRONICLE_QUOTES[Math.floor(Math.random() * CHRONICLE_QUOTES.length)]);

  const { data: analyses, isLoading } = useQuery<Analysis[]>({
    queryKey: ["/api/analyses"],
  });

  if (selectedAnalysis) {
    const stats = {
      manaCurve: JSON.parse(selectedAnalysis.manaCurve || "{}"),
      colorDistribution: JSON.parse(selectedAnalysis.colorDistribution || "{}"),
    };

    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <button
            onClick={() => setSelectedAnalysis(null)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
            data-testid="button-back-chronicle"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Chronicle
          </button>

          <div className="space-y-6">
            <div>
              <h2 className="font-display text-lg font-semibold">
                {selectedAnalysis.deckName}
              </h2>
              <p className="text-sm text-muted-foreground">
                {selectedAnalysis.format.charAt(0).toUpperCase() + selectedAnalysis.format.slice(1)}{" "}
                · {selectedAnalysis.cardCount} cards · {formatDate(selectedAnalysis.createdAt)}
              </p>
            </div>

            <StatsCards stats={stats} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="border-border/50">
                <CardContent className="p-4">
                  <h3 className="font-display text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5" />
                    The Curve of Battle
                  </h3>
                  <ManaCurveChart data={stats.manaCurve} />
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-4">
                  <h3 className="font-display text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    Colors of the Host
                  </h3>
                  <ColorDistChart data={stats.colorDistribution} />
                </CardContent>
              </Card>
            </div>

            <Card className="border-border/50 palantir-glow">
              <CardContent className="p-5">
                <h3 className="font-display text-xs font-medium text-muted-foreground mb-4 flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-primary" />
                  Counsel of the Stone
                </h3>
                <AnalysisView content={selectedAnalysis.analysisResult || ""} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="text-center mb-10 pt-4">
          <Scroll className="w-10 h-10 text-primary/60 mx-auto mb-4" />
          <h1 className="font-display text-xl font-bold tracking-wide mb-2">
            War Chronicle
          </h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Every vision the stone has granted. Every army counseled, every strategy weighed.
          </p>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="text-center py-16">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground mt-3">Unrolling the scrolls...</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && (!analyses || analyses.length === 0) && (
          <div className="text-center py-16">
            <Scroll className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground/60 italic max-w-sm mx-auto">
              {emptyMsg}
            </p>
            <Link href="/">
              <Button variant="outline" size="sm" className="mt-4 gap-2">
                <Eye className="w-3.5 h-3.5" />
                Consult the Stone
              </Button>
            </Link>
          </div>
        )}

        {/* Analysis list */}
        {analyses && analyses.length > 0 && (
          <div className="space-y-3">
            {analyses.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelectedAnalysis(a)}
                className="w-full text-left group"
                data-testid={`chronicle-entry-${a.id}`}
              >
                <Card className="border-border/40 hover:border-primary/30 transition-all duration-200 hover:shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-primary/8 flex items-center justify-center shrink-0">
                          <Swords className="w-4 h-4 text-primary/60" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">
                              {a.deckName}
                            </span>
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${getFormatColor(a.format)}`}
                            >
                              {a.format}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-muted-foreground">
                              {a.cardCount} cards
                            </span>
                            <span className="text-xs text-muted-foreground/40">·</span>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {formatDate(a.createdAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        )}

        {/* Footer quote */}
        {analyses && analyses.length > 0 && (
          <div className="text-center py-8">
            <p className="text-xs text-muted-foreground/40 italic max-w-sm mx-auto">
              "{quote.quote}"
            </p>
            <p className="text-[10px] text-muted-foreground/25 mt-1">
              {quote.attribution}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
