import { cn } from "@/lib/utils";

export default function SummaryCard({ acertos, quantidade, total }) {
  const configs = {
    5: { label: "Quina (5)", color: "text-emerald-600", bg: "bg-emerald-50", bar: "bg-emerald-500" },
    4: { label: "Quadra (4)", color: "text-blue-600", bg: "bg-blue-50", bar: "bg-blue-500" },
    3: { label: "Terno (3)", color: "text-amber-600", bg: "bg-amber-50", bar: "bg-amber-500" },
    2: { label: "Duque (2)", color: "text-purple-600", bg: "bg-purple-50", bar: "bg-purple-500" },
    1: { label: "1 acerto", color: "text-slate-500", bg: "bg-slate-50", bar: "bg-slate-300" },
    0: { label: "Nenhum", color: "text-slate-400", bg: "bg-slate-50", bar: "bg-slate-200" },
  };

  const config = configs[acertos] || configs[0];
  const pct = total > 0 ? (quantidade / total) * 100 : 0;

  return (
    <div className={cn("rounded-xl p-4", config.bg)}>
      <div className="flex items-center justify-between mb-2">
        <span className={cn("text-sm font-semibold", config.color)}>{config.label}</span>
        <span className={cn("text-lg font-bold", config.color)}>{quantidade}</span>
      </div>
      <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-700", config.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}