import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  FileUp,
  Loader2,
  BarChart3,
  Download,
  Trash2,
  Search,
  RefreshCcw,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { createWorker } from "tesseract.js";

import NumberInputQuina from "@/api/NumberInputQuina";
import ResultCardQuina from "@/api/ResultCardQuina";
import SummaryCardQuina from "@/api/SummaryCardQuina";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const RESULT_SOURCES = [
  {
    latest: "https://servicebus2.caixa.gov.br/portaldeloterias/api/quina",
    byContest: (concurso) => `https://servicebus2.caixa.gov.br/portaldeloterias/api/quina/${concurso}`,
  },
  {
    latest: "https://api.guidi.dev.br/loteria/quina/ultimo",
    byContest: (concurso) => `https://api.guidi.dev.br/loteria/quina/${concurso}`,
  },
];

function normalizeNumber(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1 || num > 80) return null;
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
    "quina concurso",
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
    .filter((n) => n >= 1 && n <= 80);}

function extractGamesFromLines(lines) {
  const jogos = [];
  const seen = new Set();

  for (const raw of lines) {
    const line = sanitizeLine(raw);
    if (!line || isNoiseLine(line)) continue;

    let nums = parseNumbersFromLine(line);

    if (nums.length >= 5) {
      if (nums.length > 15) {
        nums = nums.slice(0, 15);
      }

      const uniqueNums = [...new Set(nums)];
      if (uniqueNums.length >= 5 && uniqueNums.length <= 15) {
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

    if (chunkNums.length >= 5 && chunkNums.length <= 15) {
      const uniqueNums = [...new Set(chunkNums)];
      if (uniqueNums.length >= 5 && uniqueNums.length <= 15) {
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
    return nums.length >= 5;
  });

  if (
    linesWithManyNumbers.length &&
    jogosPdf.length < linesWithManyNumbers.length / 2
  ) {
    return true;
  }

  return false;
}

function extractNumbersFromApiPayload(data) {
  const candidates = [
    data?.listaDezenas,
    data?.dezenas,
    data?.numeros,
    data?.resultado,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const nums = candidate
        .map((n) => normalizeNumber(n))
        .filter((n) => n !== null);

      if (nums.length >= 5) {
        return nums.slice(0, 5).sort((a, b) => a - b);
      }
    }

    if (typeof candidate === "string") {
      const nums = (candidate.match(/\b\d{1,2}\b/g) || [])
        .map(Number)
        .filter((n) => n >= 1 && n <= 80);

      if (nums.length >= 5) {
        return nums.slice(0, 5).sort((a, b) => a - b);
      }
    }
  }

  return [];
}

export default function MegaSena() {
  const [file, setFile] = useState(null);
  const [sorteados, setSorteados] = useState([]);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [loadingResultado, setLoadingResultado] = useState(false);
  const [concursoBusca, setConcursoBusca] = useState("");

  const canProcess = useMemo(
    () => file && sorteados.length === 5 && !loading,
    [file, sorteados, loading]
  );

  const preencherResultado = async (mode, concurso = "") => {
    setLoadingResultado(true);

    try {
      let lastError = null;

      for (const source of RESULT_SOURCES) {
        const url =
          mode === "latest" ? source.latest : source.byContest(concurso);

        try {
          const response = await fetch(url, {
            headers: {
              Accept: "application/json",
            },
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = await response.json();

          console.log("=== RESULTADO API ===");
          console.log(url, data);

          const dezenas = extractNumbersFromApiPayload(data);

          if (dezenas.length < 5) {
            throw new Error("JSON sem dezenas válidas");
          }

          setSorteados(dezenas);
          return;
        } catch (err) {
          console.error("Falha na fonte:", url, err);
          lastError = err;
        }
      }

      throw lastError || new Error("Nenhuma fonte retornou resultado válido.");
    } catch (error) {
      console.error(error);
      alert("Não foi possível buscar o resultado automaticamente.");
    } finally {
      setLoadingResultado(false);
    }
  };

  const buscarUltimoResultado = async () => {
    await preencherResultado("latest");
  };

  const buscarPorConcurso = async () => {
    const concurso = String(concursoBusca || "").trim();

    if (!concurso) {
      alert("Informe o número do concurso.");
      return;
    }

    await preencherResultado("contest", concurso);
  };

  const processGames = useCallback(async () => {
    if (!file || sorteados.length !== 5) return;

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

      let faixa = "Sem premiação";
      if  (acertos === 5) faixa = "Quina";
      else if (acertos === 4) faixa = "Quadra";
      else if (acertos === 3) faixa = "Terno";
      else if (acertos === 2) faixa = "Duque";

      return {
        numeros: nums,
        acertos,
        faixa,
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
    link.download = "resultado-quina.jpg";
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
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 rounded-full text-sm font-medium mb-4">
            Conferência Inteligente
          </div>
          <h1 className="text-4xl font-bold text-slate-900 mb-4">Quina</h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Faça upload do seu comprovante, busque o resultado automaticamente e confira
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
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-2xl p-10 cursor-pointer hover:border-purple-400 hover:bg-purple-50/30 transition">
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
              <CardTitle>2. Resultado do concurso</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col md:flex-row gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={buscarUltimoResultado}
                  disabled={loadingResultado}
                  className="md:w-auto"
                >
                  {loadingResultado ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCcw className="w-4 h-4 mr-2" />
                  )}
                  Buscar último resultado
                </Button>

                <div className="flex gap-2 w-full md:max-w-md">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Número do concurso"
                    value={concursoBusca}
                    onChange={(e) =>
                      setConcursoBusca(e.target.value.replace(/\D/g, ""))
                    }
                    className="flex-1 h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-purple-500"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={buscarPorConcurso}
                    disabled={loadingResultado}
                  >
                    {loadingResultado ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>

              <NumberInputQuina numbers={sorteados} setNumbers={setSorteados} />
            </CardContent>
          </Card>

          <Button
            onClick={processGames}
            disabled={!canProcess}
            className="w-full h-14 text-lg bg-purple-600 hover:bg-purple-700"
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
                    {[5, 4, 3, 2, 1, 0].map((acertos) => (
                      <SummaryCardQuina
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
                  <ResultCardQuina
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