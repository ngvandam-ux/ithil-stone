interface ColorDistChartProps {
  data: Record<string, number>;
}

const COLOR_MAP: Record<string, { label: string; bg: string; text: string }> = {
  W: { label: "White", bg: "bg-[#F9FAF4]", text: "text-neutral-800" },
  U: { label: "Blue", bg: "bg-[#0E68AB]", text: "text-white" },
  B: { label: "Black", bg: "bg-[#2B2220]", text: "text-white" },
  R: { label: "Red", bg: "bg-[#D3202A]", text: "text-white" },
  G: { label: "Green", bg: "bg-[#00733E]", text: "text-white" },
  C: { label: "Colorless", bg: "bg-[#CAC5C0]", text: "text-neutral-800" },
};

export default function ColorDistChart({ data }: ColorDistChartProps) {
  const entries = Object.entries(data).filter(([, v]) => v > 0);
  const total = entries.reduce((sum, [, v]) => sum + v, 0) || 1;

  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No color data available.</p>
    );
  }

  return (
    <div className="space-y-3" data-testid="chart-color-dist">
      {/* Stacked bar */}
      <div className="flex h-6 rounded-md overflow-hidden">
        {entries.map(([color, count]) => {
          const info = COLOR_MAP[color] || { label: color, bg: "bg-muted", text: "text-foreground" };
          const pct = (count / total) * 100;
          return (
            <div
              key={color}
              className={`${info.bg} ${info.text} flex items-center justify-center text-[10px] font-semibold transition-all duration-500`}
              style={{ width: `${pct}%`, minWidth: pct > 5 ? undefined : "20px" }}
              title={`${info.label}: ${count} cards (${pct.toFixed(0)}%)`}
            >
              {pct > 12 ? `${color}` : ""}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {entries.map(([color, count]) => {
          const info = COLOR_MAP[color] || { label: color, bg: "bg-muted", text: "" };
          const pct = ((count / total) * 100).toFixed(0);
          return (
            <div key={color} className="flex items-center gap-1.5 text-xs">
              <div className={`w-2.5 h-2.5 rounded-sm ${info.bg}`} />
              <span className="text-muted-foreground">
                {info.label}
              </span>
              <span className="font-mono font-medium text-foreground/80">
                {count}
              </span>
              <span className="text-muted-foreground/60">({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
