import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  FileUp,
  Loader2,
  BarChart3,
  Download,
  Trash2,
} from "lucide-react";
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

function isNoiseLine(line) {
  const l = String(line || "").toLowerCase().trim();
  if (!l) return true;

  const blockedTerms = [
    "meio de pagamento",
    "número da compra",
    "numero da compra",
    "situação da compra",
    "situacao da compra",
    "hora da compra",
    "data da compra",
    "total da compra",
    "total de apostas em processamento",
    "total de apostas efetivadas",
    "total de apostas não efetivadas",
    "total devolvido ao meio de pagamento",
    "em devolução ao meio de pagamento",
    "situação da aposta",
    "situacao da aposta",
    "valor da aposta",
    "compras",
    "aguardando pagamento pix",
    "em processamento",
    "finalizada",
    "salvar carrinho como favorito",
    "megasena",
    "mega-sena concurso",
    "concurso situação da aposta valor da aposta",
  ];

  return blockedTerms.some((term) => l.includes(term));
}

function sanitizeLine(line) {
  return String(line || "")
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumbersFromLine(line) {
  return (line.match(/\b\d{1,2}\b/g) || [])
    .map(Number)
    .filter((n) => n >= 1 && n <= 60);
}

function extractGamesFromLines(lines) {
  const jogos = [];
  const seen = new Set();

  for (const raw of lines) {
    const line = sanitizeLine(raw);
    if (!line || isNoiseLine(line)) continue;

    let nums = parseNumbersFromLine(line);

    if (nums.length >= 6) {
      if (nums.length > 15) {
        nums = nums.slice(0, 15);
      }

      const uniqueNums = [...new Set(nums)];
      if (uniqueNums.length >= 6 && uniqueNums.length <= 15) {
        const sorted = [...uniqueNums].sort((a, b) => a - b);
        const key = sorted.join("-");

        if (!seen.has(key)) {
          seen.add(key);
          jogos.push({
            numeros: sorted,
            origem: line,
          });
        }
        continue;
      }
    }

    const firstChunk = line.split(/2998|efetivada|r\$|rs/i)[0]?.trim() || "";
    const chunkNums = parseNumbersFromLine(firstChunk);

    if (chunkNums.length >= 6 && chunkNums.length <= 15) {
      const uniqueNums = [...new Set(chunkNums)];
      if (uniqueNums.length >= 6 && uniqueNums.length <= 15) {
        const sorted = [...uniqueNums].sort((a, b) => a - b);
        const key = sorted.join("-");

        if (!seen.has(key)) {
          seen.add(key);
          jogos.push({
            numeros: sorted,
            origem: line,
          });
        }
      }
    }
  }

  return jogos;
}

async function extractLinesFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allLines = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const rows = new Map();

    for (const item of textContent.items) {
      const str = String(item.str || "").trim();
      if (!str) continue;

      const x = item.transform[4];
      const y = Math.round(item.transform[5]);

      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ text: str, x });
    }

    const pageLines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) =>
        items
          .sort((a, b) => a.x - b.x)
          .map((i) => i.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean);

    allLines.push(...pageLines);
  }

  return allLines;
}

async function renderPdfPagesToImages(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.5 });
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

function extractLinesFromOcrText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) =>
      String(line)
        .replace(/[Oo]/g, "0")
        .replace(/[Il|]/g, "1")
        .replace(/[Ss]/g, "5")
        .replace(/[^\dA-Za-zÀ-ÿ$:\- ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
}

async function extractTextWithOCR(file, setStatusText) {
  setStatusText("Tentando OCR para esse formato de PDF...");

  const images = await renderPdfPagesToImages(file);
  const worker = await createWorker("eng");

  let fullText = "";

  try {
    await worker.setParameters({
      tessedit_char_whitelist:
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀÁÂÃÉÊÍÓÔÕÚÇàáâãéêíóôõúç $:-\n",
      preserve_interword_spaces: "1",
    });

    for (let i = 0; i < images.length; i++) {
      setStatusText(`Rodando OCR na página ${i + 1} de ${images.length}...`);
      const result = await worker.recognize(images[i]);
      fullText += "\n" + result.data.text;
    }
  } finally {
    await worker.terminate();
  }

  return fullText.trim();
}

function shouldUseOcrFallback(pdfLines, jogosPdf) {
  const usefulLines = pdfLines.filter((line) => !isNoiseLine(line));
  if (!usefulLines.length) return true;
  if (!jogosPdf.length) return true;

  const linesWithManyNumbers = usefulLines.filter((line) => {
    const nums = parseNumbersFromLine(line);
    return nums.length >= 6;
  });

  if (linesWithManyNumbers.length && jogosPdf.length < linesWithManyNumbers.length / 2) {
    return true;
  }

  return false;
}

export default function MegaSena() {
  const [file, setFile] = useState(null);
  const [sorteados, setSorteados] = useState([]);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");

  const canProcess = useMemo(
    () => file && sorteados.length === 6 && !loading,
    [file, sorteados, loading]
  );

  const processGames = useCallback(async () => {
    if (!file || sorteados.length !== 6) return;

    setLoading(true);
    setResults(null);
    setStatusText("Lendo texto do PDF...");

    try {
      let sourceMode = "pdf";
      let jogos = [];

      const pdfLines = await extractLinesFromPdf(file);

      console.log("=== LINHAS PDF ===");
      console.log(pdfLines);

      const jogosPdf = extractGamesFromLines(pdfLines);

      console.log("=== JOGOS PDF ===");
      console.log(jogosPdf);

      if (shouldUseOcrFallback(pdfLines, jogosPdf)) {
        sourceMode = "ocr";

        const ocrText = await extractTextWithOCR(file, setStatusText);

        console.log("=== TEXTO OCR ===");
        console.log(ocrText);

        const ocrLines = extractLinesFromOcrText(ocrText);

        console.log("=== LINHAS OCR ===");
        console.log(ocrLines);

        const jogosOcr = extractGamesFromLines(ocrLines);

        console.log("=== JOGOS OCR ===");
        console.log(jogosOcr);

        jogos = jogosOcr.length ? jogosOcr : jogosPdf;
      } else {
        jogos = jogosPdf;
      }

      if (!jogos.length) {
        throw new Error("Nenhum jogo válido encontrado no comprovante.");
      }

      setStatusText(`Conferindo ${jogos.length} jogos encontrados...`);

      const sorteadosSet = new Set(sorteados);

      const analyzed = jogos.map((jogo, idx) => {
        const nums = jogo.numeros || [];
        const acertos = nums.filter((n) => sorteadosSet.has(n)).length;

        return {
          numeros: nums,
          acertos,
          index: idx + 1,
          origem: jogo.origem || "",
        };
      });

      analyzed.sort((a, b) => b.acertos - a.acertos || a.index - b.index);

      const summary = {};
      for (let i = 0; i <= 15; i++) {
        summary[i] = analyzed.filter((j) => j.acertos === i).length;
      }

      setResults({
        jogos: analyzed,
        summary,
        total: analyzed.length,
        origem: sourceMode,
      });

      setStatusText(
        `Conferência concluída. ${analyzed.length} jogos válidos encontrados.`
      );
    } catch (err) {
      console.error(err);
      alert("Erro: " + err.message);
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
            Faça upload do seu comprovante, insira os números sorteados e confira
            seus jogos em diferentes formatos de PDF.
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
                  <span className="text-slate-700 font-medium">
                    Clique para selecionar o PDF
                  </span>
                  <span className="text-sm text-slate-500 mt-1">
                    Somente arquivos PDF
                  </span>
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
                  <div>
                    <CardTitle>Resumo da conferência</CardTitle>
                    <p className="text-sm text-slate-500 mt-1">
                      Origem da leitura:{" "}
                      {results.origem === "ocr" ? "OCR" : "Texto do PDF"}
                    </p>
                  </div>

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