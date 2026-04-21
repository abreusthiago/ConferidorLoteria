import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Sparkles, Calculator, FileCheck } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/30 flex flex-col items-center justify-center px-4">
      <div className="text-center mb-10">
        <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 tracking-tight">Gestão Mega Sena</h1>
        <p className="text-slate-500 mt-2 text-sm sm:text-base">Selecione uma opção para continuar</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 w-full max-w-3xl">
        <Link
          to={createPageUrl("MegaSena")}
          className="group flex flex-col items-center gap-4 bg-white border-2 border-slate-200 hover:border-emerald-400 hover:shadow-lg hover:shadow-emerald-100 rounded-2xl p-8 transition-all duration-200"
        >
          <div className="h-14 w-14 rounded-2xl bg-emerald-50 group-hover:bg-emerald-100 flex items-center justify-center transition-colors">
            <Sparkles className="h-7 w-7 text-emerald-600" />
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-slate-800">Conferência Mega Sena</h2>
            <p className="text-sm text-slate-500 mt-1">
              Faça upload do comprovante e confira seus jogos automaticamente com os números sorteados.
            </p>
          </div>
        </Link>

        <Link 
          to={createPageUrl("Quina")}
          className="group flex flex-col items-center gap-4 bg-white border-2 border-slate-200 hover:border-blue-400 hover:shadow-lg hover:shadow-blue-100 rounded-2xl p-8 transition-all duration-200"
      >
          <div className="h-14 w-14 rounded-2xl bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center transition-colors">
            <Sparkles className="h-7 w-7 text-blue-600" />
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-slate-800">Conferência Quina</h2>
            <p className="text-sm text-slate-500 mt-1">
              Faça upload do comprovante e confira seus jogos automaticamente com os números sorteados.
            </p>
          </div>
        </Link>

        <Link
          to={createPageUrl("Cotas")}
          className="group flex flex-col items-center gap-4 bg-white border-2 border-slate-200 hover:border-blue-400 hover:shadow-lg hover:shadow-blue-100 rounded-2xl p-8 transition-all duration-200"
        >
          <div className="h-14 w-14 rounded-2xl bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center transition-colors">
            <Calculator className="h-7 w-7 text-blue-600" />
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-slate-800">Valor Estimado de Cota</h2>
            <p className="text-sm text-slate-500 mt-1">
              Calcule o valor de cada cota descontando a taxa do administrador do prêmio total.
            </p>
          </div>
        </Link>
        <Link
          to={createPageUrl("GestaoCotas")}
          className="group flex flex-col items-center gap-4 bg-white border-2 border-slate-200 hover:border-violet-400 hover:shadow-lg hover:shadow-violet-100 rounded-2xl p-8 transition-all duration-200"
      >
          <div className="h-14 w-14 rounded-2xl bg-violet-50 group-hover:bg-violet-100 flex items-center justify-center transition-colors">
            <FileCheck className="h-7 w-7 text-violet-600" />
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-slate-800">Gestão de Cotas</h2>
            <p className="text-sm text-slate-500 mt-1">
              Processe comprovantes PIX e calcule cotas automaticamente.
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}