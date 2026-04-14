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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Coins,
  BarChart3,
  Loader2,
  Layers,
  ArrowRight,
  Eye,
  Scroll,
  Shield,
  Swords,
} from "lucide-react";
import type { Analysis } from "@shared/schema";
import AnalysisView from "@/components/analysis-view";
import ManaCurveChart from "@/components/mana-curve-chart";
import StatsCards from "@/components/stats-cards";
import ColorDistChart from "@/components/color-dist-chart";
import DeckImport from "@/components/deck-import";
import LoadingOverlay from "@/components/loading-overlay";

// ── LOTR lore data ──────────────────────────────────────────────────


const FLAVOR_QUOTES = [
  { quote: "He that breaks a thing to find out what it is has left the path of wisdom.", attribution: "— Gandalf" },
  { quote: "The wise speak only of what they know.", attribution: "— Gandalf" },
  { quote: "Even the smallest person can change the course of the future.", attribution: "— Galadriel" },
  { quote: "Faithless is he that says farewell when the road darkens.", attribution: "— Gimli" },
  { quote: "One who cannot cast away a treasure at need is in fetters.", attribution: "— Aragorn" },
  { quote: "In doubt, a man of worth will trust to his own wisdom.", attribution: "— Túrin Turambar" },
];

const EMPTY_STATE_MESSAGES = [
  "The stone is dark. Present your forces for counsel.",
  "The palantír awaits. No host has yet been shown.",
  "The seeing-stone rests in silence. Bring forth your deck.",
  "No armies march in the vision. Submit your list to begin.",
  "The Eye sees nothing. Lay your cards before the stone.",
];

const AGE_FACTS = [
  "Seven palantíri were made by Fëanor in the First Age — their craft was never equalled.",
  "Sauron possessed the Ithil-stone after Minas Ithil fell, turning it into a trap for unwary minds.",
  "Aragorn wrested control of the Orthanc palantír from Sauron by sheer will alone.",
  "The palantíri could only show true things, yet Sauron deceived by revealing select truths.",
  "The Master Stone on Tol Eressëa was aware of all the others simultaneously.",
];

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

export default function Home() {
  const { toast } = useToast();
  const [deckName, setDeckName] = useState("");
  const [format, setFormat] = useState("modern");
  const [decklist, setDecklist] = useState("");
  const [currentAnalysis, setCurrentAnalysis] = useState<any | null>(null);

  const [randomQuote] = useState(() => FLAVOR_QUOTES[Math.floor(Math.random() * FLAVOR_QUOTES.length)]);
  const [emptyMsg] = useState(() => EMPTY_STATE_MESSAGES[Math.floor(Math.random() * EMPTY_STATE_MESSAGES.length)]);
  const [ageFact] = useState(() => AGE_FACTS[Math.floor(Math.random() * AGE_FACTS.length)]);

  // Fetch credits
  const { data: creditsData } = useQuery<{ coins: number }>({
    queryKey: ["/api/credits"],
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
        title: "The Stone Dims",
        description: err.message.includes("402")
          ? "No Mithril Rings remain. Visit the Dwarven Mint to forge more."
          : err.message,
        variant: "destructive",
      });
    },
  });

  const handleAnalyze = () => {
    if (!deckName.trim()) {
      toast({ title: "Name your host", description: "Every army requires a name.", variant: "destructive" });
      return;
    }
    if (!decklist.trim()) {
      toast({ title: "The stone sees nothing", description: "Present your decklist for counsel.", variant: "destructive" });
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
      {/* Full-screen loading overlay with Elvish quotes */}
      <LoadingOverlay visible={analyzeMutation.isPending} />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Show analysis or input form */}
        {currentAnalysis ? (
          <div className="space-y-5">
            {/* Deck header banner */}
            <div className="rounded-xl border border-border/40 bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5 mb-1">
                    <h2 className="font-display text-lg font-bold tracking-wide">
                      {currentAnalysis.analysis.deckName}
                    </h2>
                    <Badge variant="secondary" className="text-xs font-medium">
                      {currentAnalysis.analysis.format.charAt(0).toUpperCase() +
                        currentAnalysis.analysis.format.slice(1)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {currentAnalysis.analysis.cardCount} cards marshalled
                    {currentAnalysis.stats?.sideboardCards > 0 && (
                      <> · {currentAnalysis.stats.sideboardCards} in reserve</>
                    )}
                    {currentAnalysis.stats?.totalPrice > 0 && (
                      <> · ~${currentAnalysis.stats.totalPrice.toFixed(0)} treasury</>
                    )}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentAnalysis(null)}
                  className="shrink-0"
                  data-testid="button-new-analysis"
                >
                  New Vision
                </Button>
              </div>
            </div>

            {/* Quick stats row */}
            <StatsCards stats={currentAnalysis.stats || {}} />

            {/* Charts row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="border-border/40">
                <CardContent className="p-4">
                  <h3 className="font-display text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5" />
                    The Curve of Battle
                  </h3>
                  <ManaCurveChart
                    data={
                      currentAnalysis.stats?.manaCurve ||
                      JSON.parse(currentAnalysis.analysis.manaCurve || "{}")
                    }
                  />
                </CardContent>
              </Card>
              <Card className="border-border/40">
                <CardContent className="p-4">
                  <h3 className="font-display text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    Colors of the Host
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

            {/* Section divider */}
            <div className="flex items-center gap-3 pt-1">
              <div className="h-px flex-1 bg-border/30" />
              <div className="flex items-center gap-1.5 text-muted-foreground/50">
                <Eye className="w-3.5 h-3.5 text-primary/50" />
                <span className="text-[10px] uppercase tracking-[0.15em] font-medium">Counsel of the Stone</span>
              </div>
              <div className="h-px flex-1 bg-border/30" />
            </div>

            {/* AI Analysis — collapsible sections */}
            <AnalysisView
              content={currentAnalysis.analysis.analysisResult || ""}
              decklist={currentAnalysis.analysis.decklist || ""}
            />

            {/* Flavor quote at bottom */}
            <div className="text-center py-6">
              <div className="w-8 h-px bg-primary/20 mx-auto mb-4" />
              <p className="font-elvish text-sm text-muted-foreground/50 italic max-w-md mx-auto leading-relaxed">
                "{randomQuote.quote}"
              </p>
              <p className="text-[10px] text-muted-foreground/30 mt-2 font-elvish">
                {randomQuote.attribution}
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Hero */}
            <div className="text-center mb-10 pt-4">
              <PalantirLogo className="w-12 h-12 text-primary/60 mx-auto mb-4 palantir-pulse" />
              <h1
                className="font-display text-xl font-bold tracking-wide mb-2"
                data-testid="text-hero-title"
              >
                AI-Powered MTG Deck Analysis
              </h1>
              <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                Paste your Magic: The Gathering decklist. The seeing stone reveals
                hidden combos, optimal card swaps, mana base fixes, and meta positioning
                across Standard, Modern, Pioneer, Legacy, and Commander.
              </p>
              <p className="text-xs text-muted-foreground/50 mt-2">
                3 free analyses per session · All MTG formats supported
              </p>
            </div>

            {/* Input form */}
            <div className="max-w-2xl mx-auto space-y-5">
              {/* Import options */}
              <DeckImport
                onImport={(data) => {
                  if (data.deckName) setDeckName(data.deckName);
                  if (data.format) setFormat(data.format);
                  if (data.decklist) setDecklist(data.decklist);
                }}
              />

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border/40" />
                <span className="text-[10px] text-muted-foreground/50 uppercase tracking-widest">or inscribe manually</span>
                <div className="h-px flex-1 bg-border/40" />
              </div>

              {/* Deck name + format row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Name of Your Host
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
                    Theatre of War
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
                    Army Manifest
                    <span className="ml-1.5 text-[10px] text-muted-foreground/50 font-normal">
                      Arena format auto-detected
                    </span>
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={loadSample}
                      className="text-xs text-primary hover:text-primary/80 transition-colors"
                      data-testid="button-load-sample"
                    >
                      Summon sample host
                    </button>
                    {cardCount > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {cardCount} souls
                      </Badge>
                    )}
                  </div>
                </div>
                <Textarea
                  placeholder={`Inscribe your decklist here...\n\nFormat:\n4 Lightning Bolt\n4 Goblin Guide\n20 Mountain`}
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
                  1 Mithril Ring per vision ·{" "}
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
                      Consulting...
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4" />
                      Consult the Stone
                    </>
                  )}
                </Button>
              </div>

              {/* Feature cards — MTG-specific */}
              <Card className="border-border/30 bg-muted/30">
                <CardContent className="p-4">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <Shield className="w-4 h-4 mx-auto mb-1.5 text-muted-foreground" />
                      <p className="text-xs font-medium">Scryfall Verified</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Every MTG card validated
                      </p>
                    </div>
                    <div>
                      <Eye className="w-4 h-4 mx-auto mb-1.5 text-muted-foreground" />
                      <p className="text-xs font-medium">Combo Discovery</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Find hidden synergies
                      </p>
                    </div>
                    <div>
                      <Swords className="w-4 h-4 mx-auto mb-1.5 text-muted-foreground" />
                      <p className="text-xs font-medium">Meta Positioning</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Live tournament data
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* What you get — SEO-rich content section */}
              <div className="border-t border-border/20 pt-6 mt-2">
                <h2 className="font-display text-sm font-semibold text-center mb-4">What the Stone Reveals</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border/20 p-3">
                    <p className="text-xs font-medium mb-1">Deck Archetype & Power Rating</p>
                    <p className="text-xs text-muted-foreground">Identifies your MTG deck's archetype, rates speed, consistency, resilience, and disruption on a 1-10 scale.</p>
                  </div>
                  <div className="rounded-lg border border-border/20 p-3">
                    <p className="text-xs font-medium mb-1">Combo & Synergy Detection</p>
                    <p className="text-xs text-muted-foreground">Discovers hidden multi-card combos in your deck you may have missed, rated by competitive viability.</p>
                  </div>
                  <div className="rounded-lg border border-border/20 p-3">
                    <p className="text-xs font-medium mb-1">Cards You're Missing</p>
                    <p className="text-xs text-muted-foreground">8-12 card recommendations in Must-Add, Strong Upgrade, and Spicy Tech tiers with specific cuts suggested.</p>
                  </div>
                  <div className="rounded-lg border border-border/20 p-3">
                    <p className="text-xs font-medium mb-1">Mana Base & Sideboard Guide</p>
                    <p className="text-xs text-muted-foreground">Color pip analysis, land count optimization, and a complete sideboard plan for your format's top matchups.</p>
                  </div>
                </div>
                <p className="text-center text-[10px] text-muted-foreground/40 mt-3">
                  Works with MTG Arena exports, Moxfield, Archidekt, and manual decklists
                </p>
              </div>

              {/* Lore easter egg — random age fact */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-center text-[10px] text-muted-foreground/30 italic cursor-default hover:text-muted-foreground/50 transition-colors">
                    {emptyMsg}
                  </p>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="text-xs">{ageFact}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/30 mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 text-center space-y-2">
          <p className="text-xs text-muted-foreground">
            <span className="font-display">Ithil-stone</span> — AI-Powered Magic: The Gathering Deck Analyzer
          </p>
          <p className="text-[10px] text-muted-foreground/50">
            MTG deck analysis for Standard · Modern · Pioneer · Legacy · Vintage · Pauper · Commander / EDH
          </p>
          <p className="text-[10px] text-muted-foreground/40">
            Card data from{" "}
            <a
              href="https://scryfall.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary/70 hover:text-primary transition-colors"
            >
              Scryfall
            </a>{" "}
            · Magic: The Gathering is © Wizards of the Coast · Ithil-stone is not affiliated with WotC
          </p>
          <p className="text-[10px] text-muted-foreground/30 mt-1 italic">
            "{randomQuote.quote}" {randomQuote.attribution}
          </p>
        </div>
      </footer>
    </div>
  );
}
