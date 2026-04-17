import NumberBall from "./NumberBall";
import { cn } from "@/lib/utils";
import { Trophy, Star } from "lucide-react";

const acertosConfig = {
  6: { label: "SENA!", color: "from-emerald-500 to-green-600", icon: Trophy, border: "border-emerald-400", bg: "bg-emerald-50" },
  5: { label: "QUINA", color: "from-blue-500 to-indigo-600", icon: Star, border: "border-blue-400", bg: "bg-blue-50" },
  4: { label: "QUADRA", color: "from-amber-500 to-orange-600", icon: Star, border: "border-amber-400", bg: "bg-amber-50" },
};

export default function ResultCard({ jogo, numerosIndex, acertos, sorteados }) {
  const numeros = jogo?.numeros || [];
  const config = acertosConfig[acertos];
  const isWinner = acertos >= 4;

  return (
    <div
      className={cn(
        "rounded-2xl border p-5 transition-all duration-300",
        isWinner
          ? `${config.bg} ${config.border} border-2 shadow-lg`
          : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm"
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-medium text-slate-400 tracking-wider uppercase">
          Jogo #{numerosIndex}
        </span>

        <div className="flex items-center gap-2">
          {isWinner && config?.icon && (
            <config.icon
              className={cn(
                "h-4 w-4",
                acertos === 6
                  ? "text-emerald-600"
                  : acertos === 5
                  ? "text-blue-600"
                  : "text-amber-600"
              )}
            />
          )}

          <span
            className={cn(
              "text-xs font-bold px-3 py-1 rounded-full",
              isWinner
                ? `text-white bg-gradient-to-r ${config.color}`
                : acertos > 0
                ? "bg-slate-100 text-slate-600"
                : "bg-slate-50 text-slate-400"
            )}
          >
            {isWinner ? config.label : `${acertos} acerto${acertos !== 1 ? "s" : ""}`}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {numeros.map((num, idx) => (
          <NumberBall
            key={idx}
            number={num}
            isMatch={sorteados.includes(num)}
            size="md"
          />
        ))}
      </div>
    </div>
  );
}