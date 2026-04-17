import { useState } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Calculator } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

function formatBRL(value) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Cotas() {
  const [premioTotal, setPremioTotal] = useState("");
  const [percAdm, setPercAdm] = useState("");
  const [totalCotas, setTotalCotas] = useState("");
  const [valorCota, setValorCota] = useState("");
  const [result, setResult] = useState(null);

  const calcular = () => {
    const premio = parseFloat(premioTotal.replace(",", "."));
    const perc = parseFloat(percAdm.replace(",", "."));
    const cotas = parseInt(totalCotas);

    if (isNaN(premio) || isNaN(perc) || isNaN(cotas) || cotas <= 0 || perc < 0 || perc > 100) return;

    const valorAdm = premio * (perc / 100);
    const valorLiquido = premio - valorAdm;
    const valorPorCota = valorLiquido / cotas;
    const vCota = parseFloat(valorCota.replace(",", "."));
    const totalVendidoCotas = !isNaN(vCota) && vCota > 0 ? vCota * cotas : null;

    setResult({ premio, valorAdm, valorLiquido, valorPorCota, cotas, totalVendidoCotas, valorCotaInput: vCota });
  };

  const handleKey = (e) => {
    if (e.key === "Enter") calcular();
  };

  const canCalc =
    premioTotal.trim() !== "" && percAdm.trim() !== "" && totalCotas.trim() !== "";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
      <div className="max-w-xl mx-auto px-4 py-8 sm:py-12">

        {/* Back */}
        <Link
          to={createPageUrl("Home")}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-8 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao menu
        </Link>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 text-xs font-semibold px-4 py-1.5 rounded-full mb-4">
            <Calculator className="h-3.5 w-3.5" />
            Calculadora de Cotas
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">Valor Estimado de Cota</h1>
          <p className="text-slate-500 mt-2 text-sm max-w-sm mx-auto">
            Informe os dados do prêmio e calcule quanto cada cotista irá receber.
          </p>
        </div>

        {/* Inputs */}
        <Card className="border-slate-200 shadow-sm mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-slate-800">Dados do prêmio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="premio" className="text-sm text-slate-600 mb-1.5 block">
                Valor total do prêmio (R$)
              </Label>
              <Input
                id="premio"
                type="number"
                min="0"
                placeholder="Ex: 50000000"
                value={premioTotal}
                onChange={(e) => setPremioTotal(e.target.value)}
                onKeyDown={handleKey}
              />
            </div>

            <div>
              <Label htmlFor="perc" className="text-sm text-slate-600 mb-1.5 block">
                Taxa do administrador (%)
              </Label>
              <Input
                id="perc"
                type="number"
                min="0"
                max="100"
                step="0.1"
                placeholder="Ex: 10"
                value={percAdm}
                onChange={(e) => setPercAdm(e.target.value)}
                onKeyDown={handleKey}
              />
            </div>

            <div>
              <Label htmlFor="cotas" className="text-sm text-slate-600 mb-1.5 block">
                Quantidade total de cotas
              </Label>
              <Input
                id="cotas"
                type="number"
                min="1"
                step="1"
                placeholder="Ex: 100"
                value={totalCotas}
                onChange={(e) => setTotalCotas(e.target.value)}
                onKeyDown={handleKey}
              />
            </div>

            <div>
              <Label htmlFor="valorCota" className="text-sm text-slate-600 mb-1.5 block">
                Valor da cota (R$) <span className="text-slate-400 font-normal">(opcional)</span>
              </Label>
              <Input
                id="valorCota"
                type="number"
                min="0"
                step="0.01"
                placeholder="Ex: 20"
                value={valorCota}
                onChange={(e) => setValorCota(e.target.value)}
                onKeyDown={handleKey}
              />
            </div>

            <Button
              onClick={calcular}
              disabled={!canCalc}
              className="w-full h-12 rounded-xl text-base font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-200 transition-all disabled:opacity-50 disabled:shadow-none"
            >
              <Calculator className="h-4 w-4 mr-2" />
              Calcular
            </Button>
          </CardContent>
        </Card>

        {/* Result */}
        {result && (
          <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-400">
            <div className="grid grid-cols-1 gap-3">

              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
                <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider mb-1">
                  Valor total do prêmio
                </p>
                <p className="text-2xl font-bold text-blue-700">{formatBRL(result.premio)}</p>
              </div>

              <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
                <p className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-1">
                  Taxa do Administrador ({percAdm}%)
                </p>
                <p className="text-2xl font-bold text-red-700">{formatBRL(result.valorAdm)}</p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Valor líquido a distribuir
                </p>
                <p className="text-2xl font-bold text-slate-800">{formatBRL(result.valorLiquido)}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-100 border border-slate-200 rounded-2xl p-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Total de cotas</p>
                  <p className="text-2xl font-bold text-slate-800">{result.cotas}</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
                  <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-1">Valor por cota</p>
                  <p className="text-2xl font-bold text-emerald-700">{formatBRL(result.valorPorCota)}</p>
                </div>
              </div>

              {result.totalVendidoCotas !== null && (
                <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5">
                  <p className="text-xs font-semibold text-violet-500 uppercase tracking-wider mb-1">
                    Total arrecadado ({formatBRL(result.valorCotaInput)} × {result.cotas} cotas)
                  </p>
                  <p className="text-2xl font-bold text-violet-700">{formatBRL(result.totalVendidoCotas)}</p>
                </div>
              )}

            </div>
          </div>
        )}

      </div>
    </div>
  );
}