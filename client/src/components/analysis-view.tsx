interface AnalysisViewProps {
  content: string;
}

// LOTR war-counsel section header mapping
const SECTION_RENAMES: Record<string, string> = {
  "Deck Archetype": "The Nature of Your Host",
  "Power Assessment": "Strength of the Legion",
  "Strengths": "Virtues of Your Vanguard",
  "Weaknesses": "Shadows in the Ranks",
  "Combo Discovery": "Hidden Alliances",
  "Cards You're Missing": "Reinforcements Required",
  "Meta Positioning": "Knowledge of the Enemy",
  "Sideboard Guide": "Reserves of War",
  "Upgrade Path": "The Forging of Stronger Arms",
  "Mana Base Deep Dive": "The Foundations of Power",
  "Key Synergies & Interactions": "Bonds of Fellowship",
  "Key Synergies": "Bonds of Fellowship",
  "Weakest Cards to Cut": "Soldiers Unfit for War",
};

function renameHeader(text: string): string {
  // Check exact match first
  if (SECTION_RENAMES[text]) return SECTION_RENAMES[text];
  // Check partial match
  for (const [key, val] of Object.entries(SECTION_RENAMES)) {
    if (text.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return text;
}

export default function AnalysisView({ content }: AnalysisViewProps) {
  if (!content) {
    return (
      <p className="text-sm text-muted-foreground italic">
        The seeing-stone rests in silence. No counsel has been given.
      </p>
    );
  }

  const lines = content.split("\n");

  return (
    <div className="space-y-2" data-testid="text-analysis">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;

        // Skip horizontal rules
        if (/^[-—–]{3,}$/.test(trimmed)) return null;

        // H1 headers: # Title
        if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
          const headerText = trimmed.replace(/^#\s+/, "");
          return (
            <h2 key={i} className="font-display text-base font-bold text-foreground pt-2 pb-1">
              {renameHeader(headerText)}
            </h2>
          );
        }

        // H2 headers: ## Section
        if (trimmed.startsWith("## ")) {
          const headerText = trimmed.replace(/^##\s+/, "");
          return (
            <h3 key={i} className="font-display text-sm font-bold text-foreground pt-4 pb-1">
              {renameHeader(headerText)}
            </h3>
          );
        }

        // H3 headers: ### Subsection
        if (trimmed.startsWith("### ")) {
          const headerText = trimmed.replace(/^###\s+/, "");
          return (
            <h4 key={i} className="font-display text-sm font-semibold text-foreground pt-3 pb-0.5">
              {renameHeader(headerText)}
            </h4>
          );
        }

        // Numbered section headers like "1. Deck Archetype"
        if (/^\d+\.\s+\*\*/.test(trimmed) || /^\d+\.\s+[A-Z]/.test(trimmed)) {
          const cleaned = trimmed.replace(/^\d+\.\s*/, "").replace(/\*\*/g, "");
          return (
            <h3 key={i} className="font-display text-sm font-bold text-foreground pt-4 pb-1">
              {renameHeader(cleaned)}
            </h3>
          );
        }

        // Bold-only lines as sub-headers: **Something Important**
        if (/^\*\*[^*]+\*\*$/.test(trimmed)) {
          return (
            <h4 key={i} className="text-sm font-semibold text-foreground pt-2 pb-0.5">
              {trimmed.replace(/\*\*/g, "")}
            </h4>
          );
        }

        // Bold section headers with content: **Key:** Description
        if (trimmed.startsWith("**") && trimmed.includes("**")) {
          const boldMatch = trimmed.match(
            /^\*\*(.+?)\*\*\s*[:—–\-]?\s*(.*)/
          );
          if (boldMatch) {
            return (
              <p key={i} className="text-sm text-foreground/85 leading-relaxed">
                <span className="font-semibold text-foreground">
                  {boldMatch[1]}
                  {boldMatch[2] ? ":" : ""}
                </span>
                {boldMatch[2] && (
                  <span> {renderInlineMarkdown(boldMatch[2])}</span>
                )}
              </p>
            );
          }
        }

        // Bullet items
        if (trimmed.startsWith("- ") || trimmed.startsWith("• ") || trimmed.startsWith("* ")) {
          const bulletContent = trimmed.replace(/^[-•*]\s*/, "");
          return (
            <div key={i} className="flex gap-2 text-sm text-foreground/85 pl-2">
              <span className="text-primary/50 mt-0.5 shrink-0 select-none">
                ◆
              </span>
              <span className="leading-relaxed">
                {renderInlineMarkdown(bulletContent)}
              </span>
            </div>
          );
        }

        // Numbered list items (not section headers)
        if (/^\d+\.\s/.test(trimmed) && !/^\d+\.\s+\*\*[A-Z]/.test(trimmed)) {
          const num = trimmed.match(/^(\d+)\./)?.[1];
          const itemContent = trimmed.replace(/^\d+\.\s*/, "");
          return (
            <div key={i} className="flex gap-2.5 text-sm text-foreground/85 pl-2">
              <span className="text-muted-foreground font-mono text-xs mt-0.5 shrink-0 w-4 text-right">
                {num}.
              </span>
              <span className="leading-relaxed">
                {renderInlineMarkdown(itemContent)}
              </span>
            </div>
          );
        }

        // Rating line
        if (
          trimmed.toLowerCase().includes("rating") &&
          /\d+(\.\d+)?\s*\/\s*10/.test(trimmed)
        ) {
          const ratingMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
          const ratingText = trimmed
            .replace(/\*\*/g, "")
            .replace(/\d+(?:\.\d+)?\s*\/\s*10/, "")
            .replace(/^[^:]*:\s*/, "")
            .trim();
          return (
            <div
              key={i}
              className="flex items-center gap-4 mt-3 p-4 rounded-lg bg-primary/5 border border-primary/10"
            >
              {ratingMatch && (
                <div className="text-center">
                  <span className="font-display text-3xl font-bold text-primary leading-none">
                    {ratingMatch[1]}
                  </span>
                  <span className="text-sm text-muted-foreground">/10</span>
                </div>
              )}
              {ratingText && (
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {renderInlineMarkdown(ratingText)}
                </p>
              )}
            </div>
          );
        }

        // Regular paragraph
        return (
          <p key={i} className="text-sm text-foreground/80 leading-relaxed">
            {renderInlineMarkdown(trimmed)}
          </p>
        );
      })}
    </div>
  );
}

function renderInlineMarkdown(text: string): React.ReactNode {
  // Handle bold **text** and bold-italic ***text***
  const parts = text.split(/(\*\*\*.*?\*\*\*|\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("***") && part.endsWith("***")) {
      return (
        <span key={i} className="font-bold italic text-foreground">
          {part.slice(3, -3)}
        </span>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <span key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </span>
      );
    }
    return part;
  });
}
