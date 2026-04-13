import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import "@/lib/api"; // Initialize session header
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  Coins,
  BarChart3,
  Loader2,
  ChevronDown,
  Sun,
  Moon,
  Layers,
  Target,
  Zap,
  History,
  ArrowRight,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import type { Analysis } from "@shared/schema";
import AnalysisView from "@/components/analysis-view";
import ManaCurveChart from "@/components/mana-curve-chart";
import ColorDistChart from "@/components/color-dist-chart";

const FORMATS = [
  { value: "standard", label: "Standard" },
  { value: "modern", label: "Modern" },
  { value: "legacy", label: "Legacy" },
  { value: "vintage", label: "Vintage" },
  { value: "pioneer", label: "Pioneer" },
  { value: "pauper", label: "Pauper" },
  { value: "commander", label: "Commander / EDH" },
  { value: "historic", label: "Historic" },
  { value: "explorer", label: "Explorer" },
];

const SAMPLE_DECK = `4 Lightning Bolt
4 Goblin Guide
4 Monastery Swiftspear
4 Eidolon of the Great Revel
4 Lava Spike
4 Rift Bolt
4 Searing Blaze
2 Skullcrack
2 Light Up the Stage
4 Searing Blood
2 Roiling Vortex
2 Flames of the Blood Hand
20 Mountain`;

export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const [deckName, setDeckName] = useState("");
  const [format, setFormat] = useState("modern");
  const [decklist, setDecklist] = useState("");
  const [currentAnalysis, setCurrentAnalysis] = useState<any | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Fetch credits
  const { data: creditsData } = useQuery<{ coins: number }>({
    queryKey: ["/api/credits"],
  });

  // Fetch analysis history
  const { data: historyData } = useQuery<Analysis[]>({
    queryKey: ["/api/analyses"],
  });

  // Analysis mutation
  const analyzeMutation = useMutation({
    mutationFn: async (data: { deckName: string; format: string; decklist: string }) => {
      const res = await apiRequest("POST", "/api/analyze", data);
      return res.json();
    },
    onSuccess: (data) => {
      setCurrentAnalysis(data);
      queryClient.invalidateQueries({ queryKey: ["/api/credits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analyses"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Analysis Failed",
        description: err.message.includes("402")
          ? "No coins remaining. Each session starts with 3 free analyses."
          : err.message,
        variant: "destructive",
      });
    },
  });

  const handleAnalyze = () => {
    if (!deckName.trim()) {
      toast({ title: "Enter a deck name", variant: "destructive" });
      return;
    }
    if (!decklist.trim()) {
      toast({ title: "Paste your decklist", variant: "destructive" });
      return;
    }
    analyzeMutation.mutate({ deckName, format, decklist });
  };

  const loadSample = () => {
    setDeckName("Burn");
    setFormat("modern");
    setDecklist(SAMPLE_DECK);
  };

  const cardCount = decklist
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("//"))
    .reduce((sum, line) => {
      const match = line.match(/^(\d+)\s/);
      return sum + (match ? parseInt(match[1], 10) : 1);
    }, 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <span className="font-semibold text-sm tracking-tight" data-testid="app-title">
              Arcane Study
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Coin balance */}
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
              data-testid="coin-balance"
            >
              <Coins className="w-3.5 h-3.5" />
              <span>{creditsData?.coins ?? "..."}</span>
              <span className="text-primary/60">coins</span>
            </div>

            {/* History toggle */}
            {historyData && historyData.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowHistory(!showHistory)}
                className="text-xs gap-1.5"
                data-testid="button-history"
              >
                <History className="w-3.5 h-3.5" />
                History
              </Button>
            )}

            {/* Theme toggle */}
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
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* History panel */}
        {showHistory && historyData && historyData.length > 0 && (
          <div className="mb-8 space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">
              Previous Analyses
            </h3>
            <div className="grid gap-2">
              {historyData.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    setCurrentAnalysis({
                      analysis: a,
                      stats: {
                        manaCurve: JSON.parse(a.manaCurve || "{}"),
                        colorDistribution: JSON.parse(a.colorDistribution || "{}"),
                      },
                    });
                    setShowHistory(false);
                  }}
                  className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors text-left"
                  data-testid={`history-item-${a.id}`}
                >
                  <div>
                    <span className="text-sm font-medium">{a.deckName}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {a.format} · {a.cardCount} cards
                    </span>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Show analysis or input form */}
        {currentAnalysis ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  {currentAnalysis.analysis.deckName}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {currentAnalysis.analysis.format.charAt(0).toUpperCase() +
                    currentAnalysis.analysis.format.slice(1)}{" "}
                  · {currentAnalysis.analysis.cardCount} cards
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentAnalysis(null)}
                data-testid="button-new-analysis"
              >
                New Analysis
              </Button>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="border-border/50">
                <CardContent className="p-4">
                  <h3 className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5" />
                    Mana Curve
                  </h3>
                  <ManaCurveChart
                    data={
                      currentAnalysis.stats?.manaCurve ||
                      JSON.parse(currentAnalysis.analysis.manaCurve || "{}")
                    }
                  />
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="p-4">
                  <h3 className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    Color Distribution
                  </h3>
                  <ColorDistChart
                    data={
                      currentAnalysis.stats?.colorDistribution ||
                      JSON.parse(currentAnalysis.analysis.colorDistribution || "{}")
                    }
                  />
                </CardContent>
              </Card>
            </div>

            {/* AI Analysis */}
            <Card className="border-border/50 analysis-glow">
              <CardContent className="p-5">
                <h3 className="text-xs font-medium text-muted-foreground mb-4 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  AI Analysis
                </h3>
                <AnalysisView
                  content={currentAnalysis.analysis.analysisResult || ""}
                />
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            {/* Hero */}
            <div className="text-center mb-10 pt-4">
              <h1
                className="text-xl font-bold tracking-tight mb-2"
                data-testid="text-hero-title"
              >
                Analyze Your Deck
              </h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Paste your decklist below. Get AI-powered strategic analysis,
                mana curve breakdown, and optimization suggestions.
              </p>
            </div>

            {/* Input form */}
            <div className="max-w-2xl mx-auto space-y-5">
              {/* Deck name + format row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Deck Name
                  </label>
                  <Input
                    placeholder="e.g. Burn, Dimir Control"
                    value={deckName}
                    onChange={(e) => setDeckName(e.target.value)}
                    className="h-10"
                    data-testid="input-deck-name"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Format
                  </label>
                  <Select value={format} onValueChange={setFormat}>
                    <SelectTrigger
                      className="h-10"
                      data-testid="select-format"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FORMATS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Decklist textarea */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Decklist
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={loadSample}
                      className="text-xs text-primary hover:text-primary/80 transition-colors"
                      data-testid="button-load-sample"
                    >
                      Load sample deck
                    </button>
                    {cardCount > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {cardCount} cards
                      </Badge>
                    )}
                  </div>
                </div>
                <Textarea
                  placeholder={`Paste your decklist here...\n\nFormat:\n4 Lightning Bolt\n4 Goblin Guide\n20 Mountain`}
                  value={decklist}
                  onChange={(e) => setDecklist(e.target.value)}
                  rows={14}
                  className="font-mono text-sm resize-none"
                  data-testid="textarea-decklist"
                />
              </div>

              {/* Submit */}
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  <Coins className="w-3 h-3 inline mr-1" />
                  Costs 1 coin per analysis ·{" "}
                  <span className="text-primary font-medium">
                    {creditsData?.coins ?? "..."} remaining
                  </span>
                </p>
                <Button
                  onClick={handleAnalyze}
                  disabled={analyzeMutation.isPending || !deckName || !decklist}
                  className="gap-2 px-6"
                  data-testid="button-analyze"
                >
                  {analyzeMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      Analyze Deck
                    </>
                  )}
                </Button>
              </div>

              {/* Format info */}
              <Card className="border-border/30 bg-muted/30">
                <CardContent className="p-4">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <Target className="w-4 h-4 mx-auto mb-1.5 text-muted-foreground" />
                      <p className="text-xs font-medium">Card Validation</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Verified via Scryfall
                      </p>
                    </div>
                    <div>
                      <Sparkles className="w-4 h-4 mx-auto mb-1.5 text-muted-foreground" />
                      <p className="text-xs font-medium">AI Strategy</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Powered by Claude
                      </p>
                    </div>
                    <div>
                      <BarChart3 className="w-4 h-4 mx-auto mb-1.5 text-muted-foreground" />
                      <p className="text-xs font-medium">Curve Analysis</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Mana & color stats
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/30 mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 text-center">
          <p className="text-xs text-muted-foreground">
            Arcane Study · Card data from{" "}
            <a
              href="https://scryfall.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary/70 hover:text-primary transition-colors"
            >
              Scryfall
            </a>{" "}
            · Not affiliated with Wizards of the Coast
          </p>
        </div>
      </footer>
    </div>
  );
}
