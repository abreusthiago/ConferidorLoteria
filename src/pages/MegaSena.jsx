import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileUp, Loader2, BarChart3, Download, Trash2 } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { createWorker } from "tesseract.js";

import NumberInput from "@/api/NumberInput";
import ResultCard from "@/api/ResultCard";
import SummaryCard from "@/api/SummaryCard";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

function normalizeNumber(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1 || num > 60) return null;
  return num;
}

function extractGamesFromText(text) {
  const cleaned = text
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[^\d\n\r\t ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const rawMatches = cleaned.match(/\b\d{1,2}\b/g) || [];

  const numbers = rawMatches
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 60);

  const jogos = [];
  let atual = [];

  for (const n of numbers) {
    if (!atual.includes(n)) {
      atual.push(n);
    }

    if (atual.length === 6) {
      jogos.push({ numeros: [...atual].sort((a, b) => a - b) });
      atual = [];
    }
  }

  return jogos;
}

async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(" ");
    fullText += " " + pageText;
  }

  return fullText.trim();
}

async function renderPdfPagesToImages(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    images.push(canvas.toDataURL("image/png"));
  }

  return images;
}

async function extractTextWithOCR(file, setStatusText) {
  setStatusText("PDF sem texto útil. Tentando OCR...");

  const images = await renderPdfPagesToImages(file);
  const worker = await createWorker("eng");

  let fullText = "";

  for (let i = 0; i < images.length; i++) {
    setStatusText(`Rodando OCR na página ${i + 1} de ${images.length}...`);

    await worker.setParameters({
      tessedit_char_whitelist: "0123456789 \n",
      preserve_interword_spaces: "1",
    });

    const result = await worker.recognize(images[i]);
    fullText += "\n" + result.data.text;
  }

  await worker.terminate();
  return fullText.trim();
}

export default function MegaSena() {
  const [file, setFile] = useState(null);
  const [sorteados, setSorteados] = useState([]);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");

  const canProcess = useMemo(() => file && sorteados.length === 6 && !loading, [file, sorteados, loading]);

const processGames = useCallback(async () => {
  if (!file || sorteados.length !== 6) return;

  setLoading(true);
  setResults(null);
  setStatusText("Lendo texto do PDF...");

  try {
    let text = await extractTextFromPdf(file);

    console.log("=== TEXTO PDFJS ===");
    console.log(text);

    if (!text || text.replace(/\s/g, "").length < 20) {
      text = await extractTextWithOCR(file, setStatusText);

      console.log("=== TEXTO OCR ===");
      console.log(text);
    }

    setStatusText("Interpretando jogos extraídos...");

    const jogos = extractGamesFromText(text);

    console.log("=== JOGOS EXTRAÍDOS ===");
    console.log(jogos);

    if (!jogos.length) {
      alert(
        "Nenhum jogo encontrado. Abra o console do navegador com F12 e veja o texto extraído em 'TEXTO PDFJS' ou 'TEXTO OCR'."
      );
      throw new Error("Nenhum jogo encontrado no PDF.");
    }

    const sorteadosSet = new Set(sorteados);

    const analyzed = jogos.map((jogo, idx) => {
      const nums = jogo.numeros || [];
      const acertos = nums.filter((n) => sorteadosSet.has(n)).length;
      return { numeros: nums, acertos, index: idx + 1 };
    });

    analyzed.sort((a, b) => b.acertos - a.acertos);

    const summary = {};
    for (let i = 0; i <= 6; i++) {
      summary[i] = analyzed.filter((j) => j.acertos === i).length;
    }

    setResults({
      jogos: analyzed,
      summary,
      total: analyzed.length,
    });

    setStatusText(`Conferência concluída. ${analyzed.length} jogos encontrados.`);
  } catch (err) {
    console.error(err);
    setStatusText("");
  } finally {
    setLoading(false);
  }
}, [file, sorteados]);

  const clearFile = () => {
    setFile(null);
    setResults(null);
    setStatusText("");
  };

  const exportAsImage = async () => {
    const html2canvas = (await import("html2canvas")).default;
    const el = document.getElementById("resultado-conferencia");
    if (!el) return;

    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: "#ffffff",
    });

    const link = document.createElement("a");
    link.download = "resultado-mega-sena.jpg";
    link.href = canvas.toDataURL("image/jpeg", 0.95);
    link.click();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link
          to={createPageUrl("Home")}
          className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar ao menu
        </Link>

        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full text-sm font-medium mb-4">
            Conferência Inteligente
          </div>
          <h1 className="text-4xl font-bold text-slate-900 mb-4">Mega Sena</h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Faça upload do seu comprovante, insira os números sorteados e confira seus jogos instantaneamente.
          </p>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1. Comprovante de aposta (PDF)</CardTitle>
            </CardHeader>
            <CardContent>
              {!file ? (
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-2xl p-10 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition">
                  <FileUp className="w-10 h-10 text-slate-400 mb-3" />
                  <span className="text-slate-700 font-medium">Clique para selecionar o PDF</span>
                  <span className="text-sm text-slate-500 mt-1">Somente arquivos PDF</span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const selected = e.target.files?.[0];
                      if (selected) {
                        setFile(selected);
                        setResults(null);
                        setStatusText("");
                      }
                    }}
                  />
                </label>
              ) : (
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
                  <div>
                    <p className="font-medium text-slate-900">{file.name}</p>
                    <p className="text-sm text-slate-500">Pronto para análise</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={clearFile}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Números sorteados do concurso</CardTitle>
            </CardHeader>
            <CardContent>
              <NumberInput numbers={sorteados} setNumbers={setSorteados} />
            </CardContent>
          </Card>

          <Button
            onClick={processGames}
            disabled={!canProcess}
            className="w-full h-14 text-lg bg-emerald-600 hover:bg-emerald-700"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <BarChart3 className="w-5 h-5 mr-2" />
                Conferir Jogos
              </>
            )}
          </Button>

          {statusText && (
            <p className="text-center text-sm text-slate-600">{statusText}</p>
          )}

          {results && (
            <div id="resultado-conferencia" className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Resumo da conferência</CardTitle>
                  <Button variant="outline" onClick={exportAsImage}>
                    <Download className="w-4 h-4 mr-2" />
                    Baixar JPG
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
                    {[6, 5, 4, 3, 2, 1, 0].map((acertos) => (
                      <SummaryCard
                        key={acertos}
                        acertos={acertos}
                        quantidade={results.summary[acertos] || 0}
                        total={results.total}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4">
                {results.jogos.map((jogo) => (
                  <ResultCard
                    key={jogo.index}
                    jogo={jogo}
                    numerosIndex={jogo.index}
                    acertos={jogo.acertos}
                    sorteados={sorteados}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}