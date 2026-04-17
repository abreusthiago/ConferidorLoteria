import { cn } from "@/lib/utils";

export default function NumberBall({ number, isMatch = false, size = "md" }) {
  const sizes = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-12 w-12 text-base font-semibold",
  };

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-mono font-medium transition-all duration-300",
        sizes[size],
        isMatch
          ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 scale-110"
          : "bg-slate-100 text-slate-500 border border-slate-200"
      )}
    >
      {String(number).padStart(2, "0")}
    </div>
  );
}