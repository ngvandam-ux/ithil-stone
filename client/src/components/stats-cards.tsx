import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Swords,
  Shield,
  BookOpen,
  Gem,
  Target,
  Layers,
  DollarSign,
  Gauge,
} from "lucide-react";

interface StatsCardsProps {
  stats: any;
}

const ROLE_ICONS: Record<string, any> = {
  removal: Swords,
  counterspell: Shield,
  draw: BookOpen,
  ramp: Gem,
  threat: Target,
  protection: Shield,
  utility: Layers,
};

const ROLE_COLORS: Record<string, string> = {
  removal: "text-red-400",
  counterspell: "text-blue-400",
  draw: "text-cyan-400",
  ramp: "text-green-400",
  threat: "text-orange-400",
  protection: "text-yellow-400",
  utility: "text-muted-foreground",
  land: "text-muted-foreground",
};

export default function StatsCards({ stats }: StatsCardsProps) {
  const roleCounts = stats.roleCounts || {};
  const keywordCounts = stats.keywordCounts || {};
  const avgCmc = stats.avgCmc || 0;
  const totalPrice = stats.totalPrice || 0;

  const topKeywords = Object.entries(keywordCounts)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 6);

  const roles = Object.entries(roleCounts)
    .filter(([k]) => k !== "land" && k !== "unknown")
    .sort((a, b) => (b[1] as number) - (a[1] as number));

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="stats-cards">
      {/* Average CMC */}
      <Card className="border-border/50">
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Gauge className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Mana Burden
            </span>
          </div>
          <p className="text-xl font-bold text-foreground" data-testid="text-avg-cmc">
            {avgCmc.toFixed(2)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {avgCmc < 2.0
              ? "Very aggressive"
              : avgCmc < 2.5
                ? "Low curve (aggro/tempo)"
                : avgCmc < 3.5
                  ? "Midrange curve"
                  : "High curve (control/ramp)"}
          </p>
        </CardContent>
      </Card>

      {/* Deck Price */}
      <Card className="border-border/50">
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Treasury
            </span>
          </div>
          <p className="text-xl font-bold text-foreground" data-testid="text-deck-price">
            ${totalPrice.toFixed(0)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {totalPrice < 50
              ? "Budget"
              : totalPrice < 200
                ? "Moderate"
                : totalPrice < 500
                  ? "Competitive"
                  : "Premium"}
          </p>
        </CardContent>
      </Card>

      {/* Card Roles */}
      <Card className="border-border/50 col-span-2">
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Target className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Ranks & Roles
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {roles.map(([role, count]) => {
              const colorClass = ROLE_COLORS[role] || "text-muted-foreground";
              return (
                <Badge
                  key={role}
                  variant="secondary"
                  className="text-[11px] gap-1 py-0.5"
                >
                  <span className={colorClass}>{role}</span>
                  <span className="text-muted-foreground">{count as number}</span>
                </Badge>
              );
            })}
          </div>
          {topKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {topKeywords.map(([kw, count]) => (
                <span
                  key={kw}
                  className="text-[10px] text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded"
                >
                  {kw} ×{count as number}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
