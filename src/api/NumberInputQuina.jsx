import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import NumberBallQuina from "./NumberBallQuina";

export default function NumberInput({ numbers, setNumbers }) {
  const [value, setValue] = useState("");

  const addNumber = () => {
    const num = parseInt(value);
    if (num >= 1 && num <= 80 && numbers.length < 5 && !numbers.includes(num)) {
      setNumbers([...numbers, num].sort((a, b) => a - b));
      setValue("");
    }
  };

  const removeNumber = (num) => {
    setNumbers(numbers.filter((n) => n !== num));
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addNumber();
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3 min-h-[48px]">
        {numbers.map((num) => (
          <button
            key={num}
            onClick={() => removeNumber(num)}
            className="group relative"
          >
            <NumberBallQuina number={num} isMatch={true} size="lg" />
            <div className="absolute inset-0 rounded-full bg-red-500/0 group-hover:bg-red-500/80 flex items-center justify-center transition-all">
              <X className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        ))}
        {Array.from({ length: 5 - numbers.length }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="h-12 w-12 rounded-full border-2 border-dashed border-slate-200 flex items-center justify-center"
          >
            <span className="text-slate-300 text-xs">?</span>
          </div>
        ))}
      </div>

      {numbers.length < 5 && (
        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            max={80}
            placeholder="1-80"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-24 text-center font-mono"
          />
          <Button onClick={addNumber} variant="outline" size="sm">
            Adicionar
          </Button>
        </div>
      )}

      <p className="text-xs text-slate-400 mt-2">
        {numbers.length}/5 números selecionados. Clique em um número para removê-lo.
      </p>
    </div>
  );
}