interface AnalysisViewProps {
  content: string;
}

export default function AnalysisView({ content }: AnalysisViewProps) {
  if (!content) {
    return (
      <p className="text-sm text-muted-foreground">No analysis available.</p>
    );
  }

  // Parse markdown-style content into rendered HTML
  const lines = content.split("\n");

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <div className="space-y-3">
        {lines.map((line, i) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={i} className="h-2" />;

          // H2 headers
          if (trimmed.startsWith("## ")) {
            return (
              <h3
                key={i}
                className="text-sm font-semibold text-foreground mt-4 mb-1 first:mt-0"
              >
                {trimmed.replace("## ", "")}
              </h3>
            );
          }

          // Bold section headers like **Strengths**
          if (trimmed.startsWith("**") && trimmed.includes("**")) {
            const boldMatch = trimmed.match(/^\*\*(.+?)\*\*\s*[—–-]?\s*(.*)/);
            if (boldMatch) {
              return (
                <div key={i} className="mt-3 first:mt-0">
                  <span className="text-sm font-semibold text-foreground">
                    {boldMatch[1]}
                  </span>
                  {boldMatch[2] && (
                    <span className="text-sm text-muted-foreground">
                      {" "}
                      — {renderInlineMarkdown(boldMatch[2])}
                    </span>
                  )}
                </div>
              );
            }
          }

          // Numbered list items
          if (/^\d+\.\s/.test(trimmed)) {
            return (
              <div key={i} className="flex gap-2 text-sm text-foreground/90 pl-1">
                <span className="text-muted-foreground font-mono text-xs mt-0.5 shrink-0">
                  {trimmed.match(/^(\d+)\./)?.[1]}.
                </span>
                <span>{renderInlineMarkdown(trimmed.replace(/^\d+\.\s*/, ""))}</span>
              </div>
            );
          }

          // Bullet items
          if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
            return (
              <div key={i} className="flex gap-2 text-sm text-foreground/90 pl-1">
                <span className="text-primary/60 mt-1.5 shrink-0">·</span>
                <span>{renderInlineMarkdown(trimmed.replace(/^[-•]\s*/, ""))}</span>
              </div>
            );
          }

          // Rating line
          if (trimmed.toLowerCase().includes("rating") && trimmed.includes("/10")) {
            const ratingMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
            return (
              <div
                key={i}
                className="flex items-center gap-3 mt-4 p-3 rounded-lg bg-primary/5 border border-primary/10"
              >
                {ratingMatch && (
                  <span className="text-2xl font-bold text-primary">
                    {ratingMatch[1]}
                    <span className="text-sm font-normal text-muted-foreground">
                      /10
                    </span>
                  </span>
                )}
                <span className="text-sm text-foreground/80">
                  {renderInlineMarkdown(
                    trimmed
                      .replace(/\*\*.*?\*\*\s*[—–-]?\s*/, "")
                      .replace(/\d+(?:\.\d+)?\s*\/\s*10\s*[—–-]?\s*/, "")
                  )}
                </span>
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
    </div>
  );
}

function renderInlineMarkdown(text: string): React.ReactNode {
  // Handle bold **text**
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
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
