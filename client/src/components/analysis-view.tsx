import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import CardTooltip, { extractDeckCardNames } from "@/components/card-tooltip";
import {
  ChevronDown,
  ChevronRight,
  Swords,
  Shield,
  Eye,
  Flame,
  Zap,
  Target,
  Crown,
  Gem,
  Scroll,
  BookOpen,
  AlertTriangle,
  TrendingUp,
  Layers,
  Sparkles,
} from "lucide-react";

interface AnalysisViewProps {
  content: string;
  decklist?: string;
}

// Map AI section headers to LOTR names + icons + accent colors
const SECTION_CONFIG: Record<
  string,
  { title: string; icon: any; accent: string; desc: string }
> = {
  "deck archetype": {
    title: "The Nature of Your Host",
    icon: Crown,
    accent: "text-amber-400",
    desc: "Archetype identification & win condition",
  },
  "power assessment": {
    title: "Strength of the Legion",
    icon: Flame,
    accent: "text-orange-400",
    desc: "Speed, consistency, resilience, disruption",
  },
  strengths: {
    title: "Virtues of Your Vanguard",
    icon: Shield,
    accent: "text-emerald-400",
    desc: "What your deck does well",
  },
  weaknesses: {
    title: "Shadows in the Ranks",
    icon: AlertTriangle,
    accent: "text-red-400",
    desc: "Vulnerabilities to address",
  },
  "mana base deep dive": {
    title: "The Foundations of Power",
    icon: Gem,
    accent: "text-blue-400",
    desc: "Land count, color sources, fixing",
  },
  "mana base": {
    title: "The Foundations of Power",
    icon: Gem,
    accent: "text-blue-400",
    desc: "Land count, color sources, fixing",
  },
  "key synergies": {
    title: "Bonds of Fellowship",
    icon: Zap,
    accent: "text-cyan-400",
    desc: "Notable card interactions",
  },
  "combo discovery": {
    title: "Hidden Alliances",
    icon: Sparkles,
    accent: "text-violet-400",
    desc: "Multi-card combos & infinite loops",
  },
  "cards you're missing": {
    title: "Reinforcements Required",
    icon: TrendingUp,
    accent: "text-emerald-400",
    desc: "Must-adds, upgrades & spicy tech",
  },
  "weakest cards to cut": {
    title: "Soldiers Unfit for War",
    icon: Swords,
    accent: "text-red-400",
    desc: "Underperformers to replace",
  },
  "weakest cards": {
    title: "Soldiers Unfit for War",
    icon: Swords,
    accent: "text-red-400",
    desc: "Underperformers to replace",
  },
  "sideboard guide": {
    title: "Reserves of War",
    icon: Layers,
    accent: "text-yellow-400",
    desc: "Matchup-specific boarding plans",
  },
  "meta positioning": {
    title: "Knowledge of the Enemy",
    icon: Eye,
    accent: "text-primary",
    desc: "Matchups vs top-tier decks",
  },
  "upgrade path": {
    title: "The Forging of Stronger Arms",
    icon: Target,
    accent: "text-amber-400",
    desc: "Budget to premium upgrade roadmap",
  },
};

function getSectionConfig(headerText: string) {
  const lower = headerText.toLowerCase();
  for (const [key, config] of Object.entries(SECTION_CONFIG)) {
    if (lower.includes(key)) return config;
  }
  return {
    title: headerText,
    icon: BookOpen,
    accent: "text-muted-foreground",
    desc: "",
  };
}

// Parse the markdown into structured sections
interface Section {
  header: string;
  level: number;
  lines: string[];
}

function parseIntoSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // H2: ## Section Header
    if (trimmed.startsWith("## ") && !trimmed.startsWith("### ")) {
      if (current) sections.push(current);
      current = {
        header: trimmed.replace(/^##\s+/, ""),
        level: 2,
        lines: [],
      };
      continue;
    }

    // H1: # Title (treat as H2)
    if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
      if (current) sections.push(current);
      current = {
        header: trimmed.replace(/^#\s+/, ""),
        level: 1,
        lines: [],
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    } else {
      // Content before any header — create intro section
      if (trimmed) {
        if (!current) {
          current = { header: "", level: 0, lines: [] };
        }
        current.lines.push(line);
      }
    }
  }
  if (current) sections.push(current);
  return sections;
}

// Render inline markdown (bold, bold-italic) with card tooltips
function renderInlineMarkdown(
  text: string,
  knownCards?: Set<string>
): React.ReactNode {
  const parts = text.split(/(\*\*\*.*?\*\*\*|\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("***") && part.endsWith("***")) {
      const inner = part.slice(3, -3);
      return (
        <CardTooltip key={i} cardName={inner} knownCards={knownCards}>
          <span className="font-bold italic text-foreground">{inner}</span>
        </CardTooltip>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      const inner = part.slice(2, -2);
      return (
        <CardTooltip key={i} cardName={inner} knownCards={knownCards}>
          <span className="font-semibold text-foreground">{inner}</span>
        </CardTooltip>
      );
    }
    return part;
  });
}

// Extract power rating from content
function extractPowerRating(lines: string[]): {
  overall: number | null;
  breakdown: { label: string; score: string; detail: string }[];
  otherLines: string[];
} {
  const breakdown: { label: string; score: string; detail: string }[] = [];
  const otherLines: string[] = [];
  let overall: number | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Look for X/10 pattern for overall
    const overallMatch = trimmed.match(
      /(?:overall|rating|power)[^]*?(\d+(?:\.\d+)?)\s*\/\s*10/i
    );
    if (overallMatch && !overall) {
      overall = parseFloat(overallMatch[1]);
    }

    // Look for subcategory ratings: **Speed:** 7/10 — description
    const subMatch = trimmed.match(
      /\*\*(\w[\w\s]*?)\*\*\s*[:—\-–]?\s*\*?\*?(\d+(?:\.\d+)?)\s*\/\s*10\*?\*?\s*[:—\-–]?\s*(.*)/
    );
    if (subMatch) {
      breakdown.push({
        label: subMatch[1].trim(),
        score: subMatch[2],
        detail: subMatch[3].replace(/\*\*/g, "").trim(),
      });
      // Also try to extract overall from the first rating line
      if (!overall) {
        const score = parseFloat(subMatch[2]);
        if (score > 0) overall = score;
      }
      continue;
    }

    // Standalone X/10
    const standaloneMatch = trimmed.match(
      /^\*?\*?(\d+(?:\.\d+)?)\s*\/\s*10\*?\*?\s*[:—\-–]?\s*(.*)/
    );
    if (standaloneMatch && !overall) {
      overall = parseFloat(standaloneMatch[1]);
      if (standaloneMatch[2]) {
        otherLines.push(standaloneMatch[2]);
      }
      continue;
    }

    otherLines.push(line);
  }

  return { overall, breakdown, otherLines };
}

// Power rating visual component
function PowerRatingDisplay({
  overall,
  breakdown,
}: {
  overall: number;
  breakdown: { label: string; score: string; detail: string }[];
}) {
  const getRatingColor = (score: number) => {
    if (score >= 8) return "text-emerald-400";
    if (score >= 6) return "text-amber-400";
    if (score >= 4) return "text-orange-400";
    return "text-red-400";
  };

  const getRatingBg = (score: number) => {
    if (score >= 8) return "bg-emerald-400/10 border-emerald-400/20";
    if (score >= 6) return "bg-amber-400/10 border-amber-400/20";
    if (score >= 4) return "bg-orange-400/10 border-orange-400/20";
    return "bg-red-400/10 border-red-400/20";
  };

  const getRatingBarBg = (score: number) => {
    if (score >= 8) return "bg-emerald-400";
    if (score >= 6) return "bg-amber-400";
    if (score >= 4) return "bg-orange-400";
    return "bg-red-400";
  };

  return (
    <div className="my-4">
      {/* Overall rating */}
      <div
        className={`rounded-xl border p-5 ${getRatingBg(overall)} flex items-center gap-5`}
      >
        <div className="text-center shrink-0">
          <div
            className={`text-4xl font-display font-bold ${getRatingColor(overall)} leading-none`}
          >
            {overall}
          </div>
          <div className="text-xs text-muted-foreground mt-1">/10</div>
        </div>
        <div className="flex-1 h-3 bg-muted/50 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${getRatingBarBg(overall)} transition-all duration-700 ease-out`}
            style={{ width: `${(overall / 10) * 100}%` }}
          />
        </div>
      </div>

      {/* Breakdown bars */}
      {breakdown.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          {breakdown.map((item, i) => {
            const score = parseFloat(item.score);
            return (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/80">
                    {item.label}
                  </span>
                  <span
                    className={`text-xs font-bold font-mono ${getRatingColor(score)}`}
                  >
                    {item.score}/10
                  </span>
                </div>
                <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${getRatingBarBg(score)} transition-all duration-500 ease-out`}
                    style={{ width: `${(score / 10) * 100}%` }}
                  />
                </div>
                {item.detail && (
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {item.detail}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Render a single section's body content
function SectionBody({ lines, knownCards }: { lines: string[]; knownCards?: Set<string> }) {
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        if (/^[-—–]{3,}$/.test(trimmed)) return null;

        // H3: ### Subsection
        if (trimmed.startsWith("### ")) {
          return (
            <h4
              key={i}
              className="font-display text-sm font-semibold text-foreground pt-3 pb-0.5"
            >
              {trimmed.replace(/^###\s+/, "")}
            </h4>
          );
        }

        // Bold-only lines as sub-headers
        if (/^\*\*[^*]+\*\*[:.]?\s*$/.test(trimmed)) {
          return (
            <h4 key={i} className="text-sm font-semibold text-foreground pt-2.5 pb-0.5">
              {trimmed.replace(/\*\*/g, "").replace(/[:.]$/, "")}
            </h4>
          );
        }

        // Bold key-value: **Key:** Description
        if (trimmed.startsWith("**") && trimmed.includes("**")) {
          const boldMatch = trimmed.match(
            /^\*\*(.+?)\*\*\s*[:—–\-]?\s*(.*)/
          );
          if (boldMatch && boldMatch[2]) {
            return (
              <p key={i} className="text-sm text-foreground/85 leading-relaxed">
                <CardTooltip cardName={boldMatch[1]} knownCards={knownCards}>
                  <span className="font-semibold text-foreground">
                    {boldMatch[1]}:
                  </span>
                </CardTooltip>{" "}
                <span>{renderInlineMarkdown(boldMatch[2], knownCards)}</span>
              </p>
            );
          }
        }

        // Bullet items — with nicer formatting
        if (
          trimmed.startsWith("- ") ||
          trimmed.startsWith("• ") ||
          trimmed.startsWith("* ")
        ) {
          const bulletContent = trimmed.replace(/^[-•*]\s*/, "");
          return (
            <div key={i} className="flex gap-2.5 text-sm text-foreground/85 pl-1">
              <span className="text-primary/40 mt-1 shrink-0 select-none text-[8px]">
                ◆
              </span>
              <span className="leading-relaxed">
                {renderInlineMarkdown(bulletContent, knownCards)}
              </span>
            </div>
          );
        }

        // Numbered list items
        if (/^\d+\.\s/.test(trimmed)) {
          const num = trimmed.match(/^(\d+)\./)?.[1];
          const itemContent = trimmed.replace(/^\d+\.\s*/, "");
          return (
            <div key={i} className="flex gap-2.5 text-sm text-foreground/85 pl-1">
              <span className="text-primary/50 font-mono text-xs mt-0.5 shrink-0 w-4 text-right font-medium">
                {num}.
              </span>
              <span className="leading-relaxed">
                {renderInlineMarkdown(itemContent, knownCards)}
              </span>
            </div>
          );
        }

        // Regular paragraph
        return (
          <p key={i} className="text-sm text-foreground/80 leading-relaxed">
            {renderInlineMarkdown(trimmed, knownCards)}
          </p>
        );
      })}
    </div>
  );
}

// Collapsible section component
function AnalysisSection({
  section,
  defaultOpen,
  knownCards,
}: {
  section: Section;
  defaultOpen: boolean;
  knownCards?: Set<string>;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const config = getSectionConfig(section.header);
  const Icon = config.icon;

  // Special handling for Power Assessment — extract rating
  const isPowerSection = section.header
    .toLowerCase()
    .includes("power assessment");
  const powerData = isPowerSection
    ? extractPowerRating(section.lines)
    : null;

  return (
    <Card
      className={`border-border/40 overflow-hidden transition-all duration-200 ${
        isOpen ? "palantir-glow" : "hover:border-border/60"
      }`}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left p-4 flex items-center gap-3 group"
        data-testid={`section-toggle-${section.header.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
            isOpen ? "bg-primary/15" : "bg-muted/50"
          } transition-colors`}
        >
          <Icon
            className={`w-4 h-4 ${isOpen ? config.accent : "text-muted-foreground"} transition-colors`}
          />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-sm font-semibold text-foreground truncate">
            {config.title}
          </h3>
          {config.desc && (
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {config.desc}
            </p>
          )}
        </div>
        {isPowerSection && powerData?.overall && !isOpen && (
          <Badge
            variant="secondary"
            className={`text-xs font-mono font-bold ${
              powerData.overall >= 7
                ? "text-emerald-400"
                : powerData.overall >= 5
                  ? "text-amber-400"
                  : "text-red-400"
            }`}
          >
            {powerData.overall}/10
          </Badge>
        )}
        <div className="shrink-0 text-muted-foreground">
          {isOpen ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </div>
      </button>

      {isOpen && (
        <CardContent className="px-4 pb-5 pt-0 border-t border-border/20">
          <div className="pt-3">
            {isPowerSection && powerData?.overall ? (
              <>
                <PowerRatingDisplay
                  overall={powerData.overall}
                  breakdown={powerData.breakdown}
                />
                {powerData.otherLines.length > 0 && (
                  <SectionBody lines={powerData.otherLines} knownCards={knownCards} />
                )}
              </>
            ) : (
              <SectionBody lines={section.lines} knownCards={knownCards} />
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function AnalysisView({ content, decklist }: AnalysisViewProps) {
  // Pre-compute known card names from the decklist for instant tooltip matches
  const knownCards = useMemo(
    () => (decklist ? extractDeckCardNames(decklist) : new Set<string>()),
    [decklist]
  );

  if (!content) {
    return (
      <p className="text-sm text-muted-foreground italic">
        The seeing-stone rests in silence. No counsel has been given.
      </p>
    );
  }

  const sections = parseIntoSections(content);

  // Key sections that should be open by default
  const defaultOpenSections = [
    "deck archetype",
    "power assessment",
    "combo discovery",
    "cards you're missing",
  ];

  return (
    <div className="space-y-3" data-testid="text-analysis">
      {sections.map((section, i) => {
        if (!section.header && section.lines.filter((l) => l.trim()).length === 0)
          return null;

        // Intro content (no header) renders directly
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
  );
}
