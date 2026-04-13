interface ManaCurveChartProps {
  data: Record<string, number>;
}

export default function ManaCurveChart({ data }: ManaCurveChartProps) {
  const keys = ["0", "1", "2", "3", "4", "5", "6+"];
  const values = keys.map((k) => data[k] || 0);
  const max = Math.max(...values, 1);

  return (
    <div className="flex items-end gap-1.5 h-28" data-testid="chart-mana-curve">
      {keys.map((key, i) => {
        const val = values[i];
        const height = max > 0 ? (val / max) * 100 : 0;
        return (
          <div key={key} className="flex flex-col items-center flex-1 gap-1">
            <span className="text-xs font-mono text-muted-foreground">
              {val || ""}
            </span>
            <div className="w-full flex items-end" style={{ height: "80px" }}>
              <div
                className="w-full rounded-t bg-primary/70 transition-all duration-500 ease-out min-h-[2px]"
                style={{ height: `${Math.max(height * 0.8, 2)}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground font-mono">
              {key}
            </span>
          </div>
        );
      })}
    </div>
  );
}
