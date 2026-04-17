import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { extractDeckCardNames } from "@/components/card-tooltip";
import {
  parseIntoSections,
  SectionBody,
  AnalysisSection,
} from "@/components/analysis-view";
import {
  Swords,
  Shield,
  Gauge,
  DollarSign,
  Layers,
  Target,
} from "lucide-react";

interface DuelAnalysisViewProps {
  analysis: string;
  deck1Stats: any;
  deck2Stats: any;
  deck1Decklist?: string;
  deck2Decklist?: string;
}

function StatComparison({
  label,
  icon: Icon,
  value1,
  value2,
  format,
  better,
}: {
  label: string;
  icon: any;
  value1: string | number;
  value2: string | number;
  format?: (v: any) => string;
  better?: "lower" | "higher";
}) {
  const fmt = format || ((v: any) => String(v));
  const v1 = typeof value1 === "number" ? value1 : parseFloat(value1);
  const v2 = typeof value2 === "number" ? value2 : parseFloat(value2);
  const highlight1 =
    better && !isNaN(v1) && !isNaN(v2)
      ? better === "lower"
        ? v1 < v2
        : v1 > v2
      : false;
  const highlight2 =
    better && !isNaN(v1) && !isNaN(v2)
      ? better === "lower"
        ? v2 < v1
        : v2 > v1
      : false;

  return (
    <div className="grid grid-cols-3 gap-2 items-center py-2 border-b border-border/20 last:border-0">
      <div className={`text-right text-sm font-mono ${highlight1 ? "text-primary font-bold" : "text-foreground/80"}`}>
        {fmt(value1)}
      </div>
      <div className="flex items-center justify-center gap-1.5">
        <Icon className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className={`text-left text-sm font-mono ${highlight2 ? "text-primary font-bold" : "text-foreground/80"}`}>
        {fmt(value2)}
      </div>
    </div>
  );
}

// Extract verdict from analysis text
function extractVerdict(analysis: string): { favored: string; percentage: string; reason: string } | null {
  const sections = parseIntoSections(analysis);
  const verdictSection = sections.find(
    (s) => s.header.toLowerCase().includes("verdict")
  );
  if (!verdictSection) return null;

  const text = verdictSection.lines.join("\n");
  // Look for percentage pattern like "60-40" or "55/45" or "~60%"
  const pctMatch = text.match(/(\d{2,3})\s*[-–\/]\s*(\d{2,3})/);
  const singlePctMatch = text.match(/~?(\d{2,3})%/);
  const percentage = pctMatch
    ? `${pctMatch[1]}-${pctMatch[2]}`
    : singlePctMatch
      ? `${singlePctMatch[1]}%`
      : "";

  // Extract first meaningful line as the reason
  const reasonLine = verdictSection.lines.find(
    (l) => l.trim() && !l.trim().startsWith("#")
  );

  return {
    favored: "",
    percentage,
    reason: reasonLine?.replace(/^[-•*]\s*/, "").replace(/\*\*/g, "").trim() || "",
  };
}

export default function DuelAnalysisView({
  analysis,
  deck1Stats,
  deck2Stats,
  deck1Decklist,
  deck2Decklist,
}: DuelAnalysisViewProps) {
  const knownCards = useMemo(() => {
    const cards = new Set<string>();
    if (deck1Decklist) {
      for (const c of extractDeckCardNames(deck1Decklist)) cards.add(c);
    }
    if (deck2Decklist) {
      for (const c of extractDeckCardNames(deck2Decklist)) cards.add(c);
    }
    return cards;
  }, [deck1Decklist, deck2Decklist]);

  if (!analysis) {
    return (
      <p className="text-sm text-muted-foreground italic">
        The seeing-stones await the clash of armies.
      </p>
    );
  }

  const sections = parseIntoSections(analysis);
  const verdict = extractVerdict(analysis);

  // Duel-specific default open sections
  const defaultOpenSections = [
    "archetype matchup",
    "matchup verdict",
    "key interactions",
    "pivotal cards",
  ];

  return (
    <div className="space-y-4">
      {/* Verdict banner */}
      {verdict && (
        <div className="rounded-xl border border-primary/30 bg-primary/[0.05] p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Swords className="w-5 h-5 text-primary" />
            <h3 className="font-display text-sm font-bold uppercase tracking-wider text-primary">
              Matchup Verdict
            </h3>
            {verdict.percentage && (
              <Badge variant="secondary" className="text-xs font-mono font-bold text-primary">
                {verdict.percentage}
              </Badge>
            )}
          </div>
          {verdict.reason && (
            <p className="text-sm text-foreground/80 max-w-xl mx-auto">
              {verdict.reason}
            </p>
          )}
        </div>
      )}

      {/* Side-by-side stats comparison */}
      <Card className="border-border/40">
        <CardContent className="p-4">
          {/* Deck name headers */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="text-right">
              <p className="text-xs font-semibold text-foreground truncate">
                {deck1Stats.deckName}
              </p>
            </div>
            <div className="flex items-center justify-center">
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
                vs
              </span>
            </div>
            <div className="text-left">
              <p className="text-xs font-semibold text-foreground truncate">
                {deck2Stats.deckName}
              </p>
            </div>
          </div>

          <StatComparison
            label="Avg CMC"
            icon={Gauge}
            value1={deck1Stats.avgCmc?.toFixed(2) || "0"}
            value2={deck2Stats.avgCmc?.toFixed(2) || "0"}
            better="lower"
          />
          <StatComparison
            label="Cards"
            icon={Layers}
            value1={deck1Stats.totalCards || 0}
            value2={deck2Stats.totalCards || 0}
          />
          <StatComparison
            label="Creatures"
            icon={Target}
            value1={deck1Stats.creatureCount || 0}
            value2={deck2Stats.creatureCount || 0}
          />
          <StatComparison
            label="Spells"
            icon={Swords}
            value1={deck1Stats.instantSorceryCount || 0}
            value2={deck2Stats.instantSorceryCount || 0}
          />
          <StatComparison
            label="Lands"
            icon={Shield}
            value1={deck1Stats.landCount || 0}
            value2={deck2Stats.landCount || 0}
          />
          <StatComparison
            label="Price"
            icon={DollarSign}
            value1={deck1Stats.totalPrice || 0}
            value2={deck2Stats.totalPrice || 0}
            format={(v: number) => `$${(v || 0).toFixed(0)}`}
          />
        </CardContent>
      </Card>

      {/* AI Analysis sections */}
      <div className="space-y-3">
        {sections.map((section, i) => {
          if (
            !section.header &&
            section.lines.filter((l) => l.trim()).length === 0
          )
            return null;

          // Intro content (no header)
          if (!section.header) {
            return (
              <div key={i} className="pb-2">
                <SectionBody lines={section.lines} knownCards={knownCards} />
              </div>
            );
          }

          const isDefaultOpen = defaultOpenSections.some((s) =>
            section.header.toLowerCase().includes(s)
          );

          return (
            <AnalysisSection
              key={i}
              section={section}
              defaultOpen={isDefaultOpen}
              knownCards={knownCards}
            />
          );
        })}
      </div>
    </div>
  );
}
