import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  Settings,
  Trash2,
  Upload,
  AlertTriangle,
  Crown,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist';
import { createPageUrl } from '@/utils';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const GENERIC_NAME_PATTERNS = [
  /pagamento\s*ag/i,
  /pagamento/i,
  /comprovante/i,
  /transfer[êe]ncia/i,
  /\bpix\b/i,
  /ag[êe]ncia/i,
  /banco/i,
  /conta/i,
  /autentica[cç][ãa]o/i,
  /transa[cç][ãa]o/i,
  /opera[cç][ãa]o/i,
  /valor/i,
  /data/i,
  /hora/i,
  /controle/i,
  /institui[cç][ãa]o/i,
  /tipo\s+de\s+conta/i,
  /chave/i,
  /cpf/i,
  /cnpj/i,
  /telefone/i,
  /e-mail/i,
  /^para\b/i,
  /^favorecido\b/i,
  /^recebedor\b/i,
];


function formatBRL(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function parseNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const normalized = String(value).replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeSpaces(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeOCRText(text = '') {
  return text
    .replace(/\r/g, '\n')
    .replace(/[|]/g, 'I')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function cleanupName(raw = '') {
  return normalizeSpaces(raw)
    .replace(/^(nome|pagador|remetente|quem pagou|cliente|participante)[:\s-]*/i, '')
    .replace(/^de(?=[:\s-]+)/i, '')
    .replace(/^(favorecido|recebedor|para)[:\s-]*/i, '')
    .replace(/cpf.*$/i, '')
    .replace(/cnpj.*$/i, '')
    .replace(/institui[cç][ãa]o.*$/i, '')
    .replace(/banco.*$/i, '')
    .replace(/ag[êe]ncia.*$/i, '')
    .replace(/conta.*$/i, '')
    .replace(/chave pix.*$/i, '')
    .replace(/final [0-9x*]+.*$/i, '')
    .trim();
}

function isLikelyPersonName(name = '') {
  const clean = cleanupName(name);
  if (!clean || clean.length < 8 || clean.length > 120) return false;
  if (/\d/.test(clean)) return false;

  const lower = clean.toLowerCase();

  if (GENERIC_NAME_PATTERNS.some((pattern) => pattern.test(lower))) {
    return false;
  }

  const words = clean.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 8) return false;

  const connectors = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

  return words.every((word) => {
    const normalized = word.toLowerCase();
    if (connectors.has(normalized)) return true;
    return /^[A-Za-zÀ-ÿ]{2,}$/.test(word);
  });
}

function titleCaseName(value = '') {
  return value
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function extractPreferredPayerName(text = '') {
  const cleanedText = normalizeOCRText(text);

  const payerPatterns = [
  /dados\s+do\s+pagador[\s\S]{0,140}?de[:\s]+([^\n]+)/i,
  /dados\s+do\s+pagador[\s\S]{0,140}?nome[:\s]+([^\n]+)/i,
  /dados\s+de\s+quem\s+fez\s+a\s+transa[cç][ãa]o[\s\S]{0,140}?nome[:\s]+([^\n]+)/i,
  /dados\s+de\s+quem\s+pagou[\s\S]{0,140}?nome[:\s]+([^\n]+)/i,
  /quem\s+pagou[\s\S]{0,100}?nome[:\s]+([^\n]+)/i,
  /pagador[\s\S]{0,100}?nome[:\s]+([^\n]+)/i,
  /nome\s+do\s+pagador[:\s]+([^\n]+)/i,
  /remetente[:\s]+([^\n]+)/i,
];

  for (const pattern of payerPatterns) {
    const match = cleanedText.match(pattern);
    if (match?.[1]) {
      const candidate = titleCaseName(cleanupName(match[1]));
      if (isLikelyPersonName(candidate)) {
        return { name: candidate, confidence: 'high' };
      }
    }
  }

  const lines = cleanedText
    .split('\n')
    .map((line) => normalizeSpaces(line))
    .filter(Boolean);

  const payerLabelRegex = /^(pagador|remetente|quem pagou|de|cliente|nome do pagador)[:\s-]*$/i;
  const payerContextRegex = /(dados\s+do\s+pagador|dados\s+de\s+quem\s+pagou|pagador|remetente|quem pagou)/i;
  const recipientContextRegex = /(para|favorecido|recebedor|quem recebeu|destinat[aá]rio|dados do recebedor|dados de quem recebeu)/i;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const prev = lines[i - 1] || '';
    const next = lines[i + 1] || '';

    if (recipientContextRegex.test(line) || recipientContextRegex.test(prev)) continue;

    if (payerLabelRegex.test(line) || payerContextRegex.test(line) || payerContextRegex.test(prev)) {
      const candidate = titleCaseName(cleanupName(next));
      if (isLikelyPersonName(candidate) && !recipientContextRegex.test(candidate)) {
        return { name: candidate, confidence: 'medium' };
      }
    }

    const inlineMatch = line.match(/(?:pagador|remetente|quem pagou|cliente|nome do pagador)[:\s-]+(.+)/i);
    if (inlineMatch?.[1] && !recipientContextRegex.test(line)) {
      const candidate = titleCaseName(cleanupName(inlineMatch[1]));
      if (isLikelyPersonName(candidate)) {
        return { name: candidate, confidence: 'medium' };
      }
    }
  }

  return null;
}

function extractAmount(text = '') {
  const matches = [...text.matchAll(/r\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/gi)];
  if (!matches.length) return 0;
  const values = matches
    .map((match) => Number(match[1].replace(/\./g, '').replace(',', '.')))
    .filter((value) => !Number.isNaN(value));
  return values.length ? Math.max(...values) : 0;
}

function extractReceiptData(text = '', fileName = '') {
  const normalized = normalizeOCRText(text);
  const payer = extractPreferredPayerName(normalized);
  const amount = extractAmount(normalized);
  return {
    originalText: normalized,
    nome: payer?.name || `Não identificado (${fileName})`,
    nomeConfiavel: Boolean(payer?.name),
    confiancaNome: payer?.confidence || 'low',
    valorPago: amount,
    arquivoRef: fileName,
  };
}

async function readPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pagesText = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    pagesText.push(pageText);
  }

  return pagesText.join('\n');
}

async function extractFileText(file) {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return readPdfText(file);
  }
  return file.text();
}

function buildConsolidatedRows(items = [], valorCota = 0, admName = '', valorAdmPremio = 0) {
  const result = [];
  const grouped = new Map();

  for (const item of items) {
    const cotas = valorCota > 0 ? item.valorPago / valorCota : 0;

    if (!item.nomeConfiavel) {
      result.push({
        id: item.id,
        nome: item.nome,
        cotas,
        valorPago: item.valorPago,
        individual: true,
        valorReceberBase: 0,
        valorReceberFinal: 0,
        isAdm: false,
      });
      continue;
    }

    const key = item.nome.trim().toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: key,
        nome: item.nome,
        cotas: 0,
        valorPago: 0,
        individual: false,
        valorReceberBase: 0,
        valorReceberFinal: 0,
        isAdm: false,
      });
    }

    const row = grouped.get(key);
    row.cotas += cotas;
    row.valorPago += item.valorPago;
  }

  const rows = [...result, ...Array.from(grouped.values())];
  const totalCotasVendidas = rows.reduce((sum, row) => sum + row.cotas, 0);
  const valorPorCotaDistribuida = totalCotasVendidas > 0 ? (rows.reduce((sum, row) => sum + row.valorPago, 0) - 0) / totalCotasVendidas : 0;

  rows.forEach((row) => {
    row.valorReceberBase = row.cotas * valorPorCotaDistribuida;
    row.isAdm = admName && row.nome === admName;
    row.valorReceberFinal = row.valorReceberBase + (row.isAdm ? valorAdmPremio : 0);
  });

  return rows;
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function GestaoCotas() {
  const fileInputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [processedFiles, setProcessedFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [draftCpf, setDraftCpf] = useState('');
  const [expandedRawId, setExpandedRawId] = useState(null);
  const [error, setError] = useState('');

  const [tituloBolao, setTituloBolao] = useState('');
  const [numeroConcurso, setNumeroConcurso] = useState('');
  const [valorCota, setValorCota] = useState('25');
  const [premioTotal, setPremioTotal] = useState('');
  const [percAdm, setPercAdm] = useState('10');
  const [admSelecionado, setAdmSelecionado] = useState('');

  const addFiles = (incoming) => {
    const next = Array.from(incoming || []).filter((file) => file.type === 'application/pdf' || file.type.startsWith('image/'));
    setFiles((prev) => [...prev, ...next]);
  };

  const removeFile = (name) => {
    setFiles((prev) => prev.filter((file) => file.name !== name));
    setProcessedFiles((prev) => prev.filter((item) => item.fileName !== name));
  };

  const processFiles = async () => {
    setError('');
    if (!files.length) {
      setError('Selecione pelo menos um comprovante antes de processar.');
      return;
    }

    setProcessing(true);
    try {
      const valorCotaNumero = parseNumber(valorCota);
      const results = [];

      for (const file of files) {
        const extractedText = await extractFileText(file);
        const parsed = extractReceiptData(extractedText, file.name);

        results.push({
          id: crypto.randomUUID(),
          fileName: file.name,
          nome: parsed.nome,
          nomeConfiavel: parsed.nomeConfiavel,
          confiancaNome: parsed.confiancaNome,
          valorPago: parsed.valorPago,
          cotas: valorCotaNumero > 0 ? parsed.valorPago / valorCotaNumero : 0,
          rawText: parsed.originalText,
          cpf: '',
        });
      }

      setProcessedFiles(results);
    } catch (err) {
      setError('Não foi possível processar os arquivos. Confira se pdfjs-dist está instalado e se o PDF permite extração de texto.');
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setDraftName(item.nome || '');
    setDraftCpf(item.cpf || '');
  };

  const saveEdit = () => {
  const manualName = titleCaseName(draftName.trim());
  const isManualValid = isLikelyPersonName(manualName);

  setProcessedFiles((prev) =>
    prev.map((item) =>
      item.id === editingId
        ? {
            ...item,
            nome: manualName || item.nome,
            cpf: draftCpf.trim(),
            nomeConfiavel: isManualValid,
            confiancaNome: isManualValid ? 'manual' : item.confiancaNome,
          }
        : item
    )
  );

  setEditingId(null);
  setDraftName('');
  setDraftCpf('');
};

  const valorCotaNumero = parseNumber(valorCota);
  const premioNumero = parseNumber(premioTotal);
  const percAdmNumero = parseNumber(percAdm);
  const valorAdmPremio = premioNumero > 0 ? (premioNumero * percAdmNumero) / 100 : 0;
  const valorDistribuido = premioNumero > 0 ? premioNumero - valorAdmPremio : 0;
  const valorPorCotaDistribuicao = valorCotaNumero > 0 ? valorDistribuido / Math.max(processedFiles.reduce((sum, item) => sum + item.cotas, 0), 1) : 0;

  const participantOptions = useMemo(() => {
    const unique = new Map();
    processedFiles.forEach((item) => {
      if (item.nome && !item.nome.startsWith('Não identificado')) {
        unique.set(item.nome, item.nome);
      }
    });
    return Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
  }, [processedFiles]);

const consolidatedRows = useMemo(() => {
  const grouped = new Map();
  const loose = [];

  processedFiles.forEach((item) => {
    const cotas = valorCotaNumero > 0 ? item.valorPago / valorCotaNumero : 0;

    if (!item.nomeConfiavel) {
      loose.push({
      id: item.id,
      nome: item.nome,
      cpf: item.cpf || '',
      cotasOriginais: cotas,
      cotasExibidas: cotas,
      valorPago: item.valorPago,
      individual: true,
      isAdm: false,
    });
      return;
    }

    const key = item.nome.toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, {
      id: key,
      nome: item.nome,
      cpf: '',
      cotasOriginais: 0,
      cotasExibidas: 0,
      valorPago: 0,
      individual: false,
      isAdm: false,
    });
    }

    const row = grouped.get(key);
    row.cotasOriginais += cotas;
    row.valorPago += item.valorPago;
    if (!row.cpf && item.cpf) {
    row.cpf = item.cpf;
    }
  });

  const rows = [...loose, ...Array.from(grouped.values())];

  rows.forEach((row) => {
    row.isAdm = admSelecionado === row.nome;
    row.valorReceberBase = row.cotasOriginais * valorPorCotaDistribuicao;
    row.valorReceberFinal = row.valorReceberBase + (row.isAdm ? valorAdmPremio : 0);

    const cotasBonusAdm = row.isAdm && valorPorCotaDistribuicao > 0
      ? valorAdmPremio / valorPorCotaDistribuicao
      : 0;

    row.cotasExibidas = row.cotasOriginais + cotasBonusAdm;
  });

  return rows;
}, [processedFiles, valorCotaNumero, admSelecionado, valorAdmPremio, valorPorCotaDistribuicao]);

  const totalPago = consolidatedRows.reduce((sum, row) => sum + row.valorPago, 0);
  const cotasVendidas = consolidatedRows.reduce((sum, row) => sum + row.cotasOriginais, 0);
  const totalArrecadado = cotasVendidas * valorCotaNumero;

  const exportCSV = () => {
    const header = ['Título do Bolão', 'Concurso', 'Nome', 'Cotas', 'Valor Pago', 'Recebe Base', 'ADM', 'Recebe Final'];
    const lines = consolidatedRows.map((row) => [
      `"${tituloBolao.replace(/"/g, '""')}"`,
      `"${numeroConcurso.replace(/"/g, '""')}"`,
      `"${row.nome.replace(/"/g, '""')}"`,
      row.cotas.toFixed(2),
      row.valorPago.toFixed(2),
      row.valorReceberBase.toFixed(2),
      row.isAdm ? valorAdmPremio.toFixed(2) : '0.00',
      row.valorReceberFinal.toFixed(2),
    ].join(';'));
    downloadBlob('gestao-cotas.csv', [header.join(';'), ...lines].join('\n'), 'text/csv;charset=utf-8');
  };

 const totalCotasDocumento = consolidatedRows.reduce(
  (sum, row) => sum + row.cotasExibidas,
  0
);

const exportPDF = () => {
  const doc = new jsPDF();
  const titulo = tituloBolao || 'Mega Sena';
  const margemX = 14;
  const larguraPagina = doc.internal.pageSize.getWidth();
  const larguraUtil = larguraPagina - margemX * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(titulo, margemX, 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(`Concurso Nº ${numeroConcurso || '-'}`, margemX, 26);
  doc.text(`Valor da cota: ${formatBRL(valorCotaNumero)}`, margemX, 32);
  doc.text(`Total de pagadores: ${consolidatedRows.length}`, margemX, 38);
  doc.text(`Total de cotas: ${totalCotasDocumento.toFixed(2)}`, margemX, 44);
  doc.text(`Valor total do prêmio: ${formatBRL(premioNumero)}`, margemX, 50);
  doc.setTextColor(0, 0, 0);

  let y = 62;

  const drawHeader = () => {
    doc.setFillColor(248, 250, 252);
    doc.rect(margemX, y - 5, larguraUtil, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('#', margemX + 2, y);
    doc.text('Nome', margemX + 12, y);
    doc.text('CPF', margemX + 100, y);
    doc.text('Cotas', margemX + 132, y);
    doc.text('Valor Estimado', margemX + 156, y);
    y += 8;
  };

  drawHeader();

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  consolidatedRows.forEach((row, index) => {
    const nome = row.isAdm ? `${row.nome}` : row.nome;
    const nomeLinhas = doc.splitTextToSize(nome, 95);
    const alturaLinha = Math.max(8, nomeLinhas.length * 5);

    if (y + alturaLinha > 275) {
      doc.addPage();
      y = 20;
      drawHeader();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
    }

    doc.text(nomeLinhas, margemX + 12, y);
    doc.text(row.cpf || '', margemX + 100, y);
    doc.text(row.cotasExibidas.toFixed(2), margemX + 132, y);
    doc.text(formatBRL(row.valorReceberFinal), margemX + 156, y);

    y += alturaLinha;
    doc.setDrawColor(230, 230, 230);
    doc.line(margemX, y - 3, larguraPagina - margemX, y - 3);
  });

  y += 8;
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  doc.text(
    '* Os números referentes a esse sorteio estarão em um PDF assinado e enviado juntamente ao grupo no WhatsApp.',
    margemX,
    y,
    { maxWidth: larguraUtil }
  );

  doc.save('gestao-cotas.pdf');
};

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
      <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12">
        <Link to={createPageUrl('Home')} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-8 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Voltar ao menu
        </Link>

        <div className="text-center mb-10">
          <div className="mx-auto mb-5 h-14 w-14 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200">
            <FileText className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">Gestão de Cotas</h1>
          <p className="text-slate-500 mt-3 text-sm sm:text-base">
            Processe comprovantes PIX e calcule cotas automaticamente
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-6">
          <div className="flex items-center gap-2 mb-5">
            <Settings className="h-4 w-4 text-slate-600" />
            <h2 className="text-xl font-semibold text-slate-800">Valor da Cota</h2>
          </div>

          <div className="grid sm:grid-cols-12 gap-4">
            <div className="sm:col-span-5">
              <label className="text-sm text-slate-500 mb-1.5 block">Título do Bolão</label>
              <input
                type="text"
                value={tituloBolao}
                onChange={(e) => setTituloBolao(e.target.value)}
                placeholder="Ex: Bolão da Firma"
                className="w-full h-11 rounded-xl border border-slate-200 px-3 outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="text-sm text-slate-500 mb-1.5 block">Número do Concurso</label>
              <input
                type="text"
                value={numeroConcurso}
                onChange={(e) => setNumeroConcurso(e.target.value)}
                placeholder="Ex: 2800"
                className="w-full h-11 rounded-xl border border-slate-200 px-3 outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div className="sm:col-span-4">
              <label className="text-sm text-slate-500 mb-1.5 block">Valor da Cota (R$)</label>
              <div className="flex items-center gap-2">
                <span className="text-2xl text-slate-600">R$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={valorCota}
                  onChange={(e) => setValorCota(e.target.value)}
                  placeholder="Ex: 25,00"
                  className="w-full h-11 rounded-xl border border-slate-200 px-3 outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
            </div>

            <div className="sm:col-span-4">
              <label className="text-sm text-slate-500 mb-1.5 block">Valor Total do Prêmio (R$)</label>
              <div className="flex items-center gap-2">
                <span className="text-2xl text-slate-600">R$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={premioTotal}
                  onChange={(e) => setPremioTotal(e.target.value)}
                  placeholder="Ex: 10.000,00"
                  className="w-full h-11 rounded-xl border border-slate-200 px-3 outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="text-sm text-slate-500 mb-1.5 block">Taxa % ADM</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={percAdm}
                  onChange={(e) => setPercAdm(e.target.value)}
                  placeholder="Ex: 10"
                  className="w-full h-11 rounded-xl border border-slate-200 px-3 outline-none focus:ring-2 focus:ring-blue-200"
                />
                <span className="text-2xl text-slate-600">%</span>
              </div>
            </div>

            <div className="sm:col-span-3">
              <label className="text-sm text-slate-500 mb-1.5 block">Valor a ser Distribuído</label>
              <input
                type="text"
                readOnly
                value={premioNumero > 0 ? formatBRL(valorDistribuido) : ''}
                placeholder="R$ 0,00"
                className="w-full h-11 rounded-xl border border-slate-200 bg-emerald-50 text-emerald-700 font-semibold px-3 outline-none"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="text-sm text-slate-500 mb-1.5 block">Quem é o ADM?</label>
              <div className="relative">
                <select
                  value={admSelecionado}
                  onChange={(e) => setAdmSelecionado(e.target.value)}
                  className="w-full h-11 rounded-xl border border-slate-200 bg-white px-3 outline-none focus:ring-2 focus:ring-blue-200 appearance-none"
                >
                  <option value="">Selecione o participante</option>
                  {participantOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <Crown className="h-4 w-4 text-amber-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-6">
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className="border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
          >
            <div className="mx-auto mb-4 text-slate-400 flex justify-center">
              <Upload className="h-10 w-10" />
            </div>
            <p className="text-xl font-medium text-slate-600">Arraste os PDFs aqui ou clique para selecionar</p>
            <p className="text-sm text-slate-400 mt-2">PDF, JPG e PNG suportados</p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,image/*"
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />

          {files.length > 0 && (
            <div className="mt-5 space-y-2">
              {files.map((file) => (
                <div key={file.name} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 bg-slate-50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                    <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(file.name)}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                    aria-label={`Remover ${file.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={processFiles}
            disabled={processing || !files.length}
            className="mt-5 w-full h-12 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {processing ? 'Processando...' : `Processar ${files.length || 0} comprovante${files.length === 1 ? '' : 's'}`}
          </button>

          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {(processedFiles.length > 0 || consolidatedRows.length > 0) && (
          <div className="grid lg:grid-cols-[1fr_1fr] gap-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-800">Processamento</h2>
                <span className="text-sm text-slate-500">{processedFiles.length}/{files.length} concluídos</span>
              </div>

              <div className="space-y-3">
                {processedFiles.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {item.nomeConfiavel ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                          )}
                          <p className="text-sm font-semibold text-slate-800 truncate">{item.fileName}</p>
                        </div>

                        {editingId === item.id ? (
                          <div className="flex flex-col gap-2 mt-2">
  <input
    value={draftName}
    onChange={(e) => setDraftName(e.target.value)}
    placeholder="Nome do participante"
    className="w-full h-10 rounded-xl border border-slate-200 px-3 outline-none focus:ring-2 focus:ring-blue-200"
  />
  <input
    value={draftCpf}
    onChange={(e) => setDraftCpf(e.target.value)}
    placeholder="CPF (opcional)"
    className="w-full h-10 rounded-xl border border-slate-200 px-3 outline-none focus:ring-2 focus:ring-blue-200"
  />
  <button
    type="button"
    onClick={saveEdit}
    className="h-10 px-4 rounded-xl bg-slate-900 text-white text-sm font-medium"
  >
    Salvar
  </button>
</div>
                        ) : (
                          <>
                            <p className="text-sm text-slate-700">{item.nome}</p>
                            <p className="text-xs text-slate-500 mt-1">
                              {formatBRL(item.valorPago)} — {item.cotas.toFixed(2)} cota(s)
                            </p>
                            {!item.nomeConfiavel && (
                              <p className="text-xs text-amber-600 mt-1">
                                Nome não identificado com segurança. Edite manualmente para consolidar corretamente.
                              </p>
                            )}
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setExpandedRawId(expandedRawId === item.id ? null : item.id)}
                          className="text-sm text-slate-500 hover:text-slate-700 font-medium"
                        >
                          {expandedRawId === item.id ? 'Ocultar texto' : 'Ver texto extraído'}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
                        >
                          <Edit3 className="h-4 w-4" />
                          Editar
                        </button>
                      </div>
                    </div>
                      {expandedRawId === item.id && (
                        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Texto extraído do PDF</p>
                          <pre className="text-[11px] leading-5 text-slate-600 whitespace-pre-wrap break-words max-h-56 overflow-auto">
                            {item.rawText || 'Nenhum texto extraído.'}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-800 mb-4">Resumo</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                    <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider mb-1">Valor da cota</p>
                    <p className="text-xl font-bold text-blue-700">{formatBRL(valorCotaNumero)}</p>
                  </div>
                  <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4">
                    <p className="text-xs font-semibold text-violet-500 uppercase tracking-wider mb-1">Total arrecadado</p>
                    <p className="text-xl font-bold text-violet-700">{formatBRL(totalArrecadado)}</p>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                    <p className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-1">Taxa ADM</p>
                    <p className="text-xl font-bold text-red-700">{formatBRL(valorAdmPremio)}</p>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
                    <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-1">Valor por cota distribuída</p>
                    <p className="text-xl font-bold text-emerald-700">{formatBRL(valorPorCotaDistribuicao)}</p>
                  </div>
                </div>
                {admSelecionado && (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-sm font-medium text-amber-800">
                      ADM selecionado: <span className="font-bold">{admSelecionado}</span> — receberá {formatBRL(valorAdmPremio)} de taxa ADM além do valor das próprias cotas.
                    </p>
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-800">Resultado Consolidado</h2>
                    <p className="text-sm text-slate-500 mt-1">
                      {consolidatedRows.length} participante(s) · {cotasVendidas.toFixed(2)} cotas · {formatBRL(totalPago)} pago
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={exportCSV}
                      disabled={!consolidatedRows.length}
                      className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-2"
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      Excel
                    </button>
                    <button
                      type="button"
                      onClick={exportPDF}
                      disabled={!consolidatedRows.length}
                      className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-2"
                    >
                      <Download className="h-4 w-4" />
                      PDF
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-200">
                        <th className="py-3 pr-3 font-medium">#</th>
                        <th className="py-3 pr-3 font-medium">Nome</th>
                        <th className="py-3 pr-3 font-medium">Cotas</th>
                        <th className="py-3 pr-3 font-medium">Valor Pago</th>
                        <th className="py-3 pr-3 font-medium">Recebe</th>
                        <th className="py-3 font-medium">Obs.</th>
                        <th className="py-3 font-medium">CPF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {consolidatedRows.map((row, index) => (
                        <tr key={row.id} className="border-b border-slate-100 last:border-0">
                          <td className="py-3 pr-3 text-slate-500">{index + 1}</td>
                          <td className="py-3 pr-3 font-medium text-slate-800">
                            <div className="flex items-center gap-2">
                              {row.isAdm && <Crown className="h-4 w-4 text-amber-500" />}
                              <span>{row.nome}</span>
                            </div>
                          </td>
                          <td className="py-3 pr-3">
                            <span className="inline-flex min-w-8 items-center justify-center rounded-md bg-blue-50 px-2 py-1 text-blue-700 font-semibold">
                              {row.cotasExibidas.toFixed(2)}
                            </span>
                          </td>
                          <td className="py-3 pr-3 text-slate-700">{formatBRL(row.valorPago)}</td>
                          <td className="py-3 pr-3 font-semibold text-emerald-700">{formatBRL(row.valorReceberFinal)}</td>
                          <td className="py-3 text-slate-500">{row.isAdm ? 'Cotas + taxa ADM' : row.individual ? 'Revisão manual' : 'Participante'}</td>
                          <td className="py-3 pr-3 text-slate-600">{row.cpf || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}