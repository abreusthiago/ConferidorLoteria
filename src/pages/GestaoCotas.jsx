import { useMemo, useRef, useState } from 'react';
import Tesseract from 'tesseract.js';
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
    .replace(/^(nome|pagador|remetente|quem pagou|origem|cliente|participante)[:\s-]*/i, '')
    .replace(/^de(?=[:\s-]+)/i, '')
    .replace(/^(favorecido|recebedor|para|destino|quem recebeu)[:\s-]*/i, '')
    .replace(/\*{2,}.*$/i, '')
    .replace(/cpf.*$/i, '')
    .replace(/cnpj.*$/i, '')
    .replace(/institui[cç][ãa]o.*$/i, '')
    .replace(/bco .*$/i, '')
    .replace(/banco.*$/i, '')
    .replace(/ag[êe]ncia.*$/i, '')
    .replace(/conta.*$/i, '')
    .replace(/tipo de conta.*$/i, '')
    .replace(/chave\s*pix.*$/i, '')
    .replace(/id\s*:.*$/i, '')
    .replace(/id\s+da\s+transa[cç][ãa]o.*$/i, '')
    .replace(/autentica[cç][ãa]o.*$/i, '')
    .replace(/comprovante emitido.*$/i, '')
    .replace(/informa[cç][õo]es adicionais.*$/i, '')
    .replace(/comprovante.*$/i, '')
    .replace(/pix\s+enviado.*$/i, '')
    .replace(/mais clareza.*$/i, '')
    .replace(/esse é o novo comprovante.*$/i, '')
    .replace(/final\s+[0-9x*]+.*$/i, '')
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
  if (words.length < 2 || words.length > 10) return false;

  const connectors = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

  return words.every((word) => {
    const normalized = word.toLowerCase();
    if (connectors.has(normalized)) return true;
    if (/^[A-Za-zÀ-ÿ]$/.test(word)) return true;
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
    if (/nubank|nu pagamentos|comprovante de transfer[êe]ncia|pix/i.test(cleanedText)) {
    const hasDestino = /\bdestino\b/i.test(cleanedText);
    const hasOrigem = /\borigem\b/i.test(cleanedText);

    if (hasDestino && !hasOrigem) {
      return null;
    }
  }
    // Nubank: prioriza "Origem > Nome" e evita confundir com "Destino"
  if (/nubank|nu pagamentos|comprovante de transfer[êe]ncia|pix/i.test(cleanedText)) {
    const nubankOriginMatch = cleanedText.match(
      /origem[\s\S]{0,180}?nome\s+([A-Za-zÀ-ÿ\s]+?)(?:\s+institui[cç][ãa]o|\s+cpf|$)/i
    );

    if (nubankOriginMatch?.[1]) {
      const candidate = titleCaseName(cleanupName(nubankOriginMatch[1]));
      if (isLikelyPersonName(candidate)) {
        return { name: candidate, confidence: 'high' };
      }
    }
  }

  const tryCandidate = (raw, confidence = 'high') => {
    const candidate = titleCaseName(cleanupName(raw || ''));
    if (isLikelyPersonName(candidate)) {
      return { name: candidate, confidence };
    }
    return null;
  };

  // 1) Fallback dedicado PicPay: Para [recebedor] ... De [pagador]***
  if (/picpay/i.test(cleanedText)) {
    const picpayMatch = cleanedText.match(
      /para\s*thiago\s+souza\s+de\s+abreu.*?de\s*([A-Za-zÀ-ÿ\s]+?)\*{2,}/i
    );
    const parsed = tryCandidate(picpayMatch?.[1], 'high');
    if (parsed) return parsed;
  }

  // 2) Fallback dedicado Banco do Brasil: Pix Enviado + recebedor + pagador
  if (/comprovante\s+bb|pix\s+enviado|sisbb/i.test(cleanedText)) {
    const bbKnownReceiverMatch = cleanedText.match(
      /pix\s+enviado\s*thiago\s+souza\s+abreu\s*([A-Za-zÀ-ÿ\s]+?)(?:id:|comprovante emitido|cpf)/i
    );
    const parsedKnownReceiver = tryCandidate(bbKnownReceiverMatch?.[1], 'high');
    if (parsedKnownReceiver) return parsedKnownReceiver;

    const bbCompactMatch = cleanedText.match(
      /thiago\s+souza\s+abreu([A-ZÀ-Ú][A-Za-zÀ-ÿ\s]+?)(?:informa[cç][õo]es adicionais|id:|cpf)/i
    );
    const parsedCompact = tryCandidate(bbCompactMatch?.[1], 'high');
    if (parsedCompact) return parsedCompact;
  }

  // 3) Regras genéricas melhoradas
  const payerPatterns = [
    /dados\s+do\s+pagador[\s\S]{0,180}?(?:de|nome)[:\s]+([^\n]+)/i,
    /dados\s+de\s+quem\s+pagou[\s\S]{0,180}?nome[:\s]+([^\n]+)/i,
    /dados\s+de\s+quem\s+fez\s+a\s+transa[cç][ãa]o[\s\S]{0,180}?nome[:\s]+([^\n]+)/i,
    /quem\s+pagou[\s\S]{0,120}?nome[:\s]+([^\n]+)/i,
    /origem[\s\S]{0,120}?nome[:\s]+([^\n]+)/i,
    /pagador[:\s]+([^\n]+)/i,
    /remetente[:\s]+([^\n]+)/i,
    /(?:^|\n)de[:\s]+([^\n]+)/i,
  ];

  for (const pattern of payerPatterns) {
    const match = cleanedText.match(pattern);
    const parsed = tryCandidate(match?.[1], 'medium');
    if (parsed) return parsed;
  }

  const lines = cleanedText
    .replace(/RecebedorPagador/gi, 'Recebedor\nPagador\n')
    .replace(/Pix Enviado/gi, 'Pix Enviado\n')
    .replace(/Para([A-ZÀ-Ú])/g, 'Para\n$1')
    .replace(/De([A-ZÀ-Ú])/g, 'De\n$1')
    .replace(/CPF([A-ZÀ-Ú])/g, 'CPF\n$1')
    .replace(/ID:/g, '\nID:')
    .split('\n')
    .map((line) => normalizeSpaces(line))
    .filter(Boolean);

  const payerLabelRegex =
    /^(pagador|remetente|quem pagou|de|origem|cliente|nome do pagador)[:\s-]*$/i;

  const payerContextRegex =
    /(dados\s+do\s+pagador|dados\s+de\s+quem\s+pagou|dados\s+de\s+quem\s+fez\s+a\s+transa[cç][ãa]o|pagador|remetente|quem pagou|origem|\bde\b)/i;

  const recipientContextRegex =
    /(para|favorecido|recebedor|quem recebeu|destino|destinat[aá]rio|dados\s+do\s+recebedor|dados\s+de\s+quem\s+recebeu)/i;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const prev = lines[i - 1] || '';
    const next = lines[i + 1] || '';
    const next2 = lines[i + 2] || '';

    if (recipientContextRegex.test(line) || recipientContextRegex.test(prev)) continue;

    if (payerLabelRegex.test(line) || payerContextRegex.test(line) || payerContextRegex.test(prev)) {
      const parsedNext = tryCandidate(next, 'medium');
      if (parsedNext) return parsedNext;

      const parsedNext2 = tryCandidate(next2, 'medium');
      if (parsedNext2) return parsedNext2;
    }

    const inlineMatch = line.match(
      /(?:pagador|remetente|quem pagou|origem|cliente|nome do pagador|de)[:\s-]+(.+)/i
    );
    const parsedInline = tryCandidate(inlineMatch?.[1], 'medium');
    if (parsedInline) return parsedInline;
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

  const suspiciousNubankSelfMatch =
    /nubank|nu pagamentos|comprovante de transfer[êe]ncia|pix/i.test(normalized) &&
    /\bdestino\b/i.test(normalized) &&
    /thiago\s+souza\s+de?\s+abreu/i.test(normalized) &&
    !/\borigem\b/i.test(normalized);

  return {
    originalText: normalized,
    nome: suspiciousNubankSelfMatch
      ? `Não identificado (${fileName})`
      : payer?.name || `Não identificado (${fileName})`,
    nomeConfiavel: suspiciousNubankSelfMatch ? false : Boolean(payer?.name),
    confiancaNome: suspiciousNubankSelfMatch ? 'low' : payer?.confidence || 'low',
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

async function readImageText(file) {
  const {
    data: { text },
  } = await Tesseract.recognize(file, 'por+eng', {
    logger: () => {},
  });

  return text || '';
}

async function extractFileText(file) {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return readPdfText(file);
  }

  if (file.type.startsWith('image/')) {
    return readImageText(file);
  }

  return '';
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
  const [showOnlyPending, setShowOnlyPending] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualCpf, setManualCpf] = useState('');
  const [manualValorPago, setManualValorPago] = useState('');
  const [draftCotas, setDraftCotas] = useState('');

  const [tituloBolao, setTituloBolao] = useState('');
  const [numeroConcurso, setNumeroConcurso] = useState('');
  const [numeroCompra, setNumeroCompra] = useState('');
  const [valorCota, setValorCota] = useState('25');
  const [premioTotal, setPremioTotal] = useState('');
  const [percAdm, setPercAdm] = useState('10');
  const [admSelecionado, setAdmSelecionado] = useState('');

  const baseInputRef = useRef(null);
  const [baseClientes, setBaseClientes] = useState([]);
  const [baseInfo, setBaseInfo] = useState('');

  const ADMIN_PASSWORD = '09071951';
  const [accessPassword, setAccessPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');

  const handleAccess = () => {
    if (accessPassword === ADMIN_PASSWORD) {
      setAuthenticated(true);
      setAuthError('');
      return;
    }

    setAuthError('Senha incorreta.');
  };

  function normalizePersonName(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeCpf(value = '') {
  return String(value).replace(/\D/g, '');
}

function formatCpf(value = '') {
  const digits = sanitizeCpf(value);
  if (digits.length !== 11) return value || '';
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function maskCpf(value = '') {
  const digits = sanitizeCpf(value);

  if (digits.length !== 11) return value || '';

  return `***.${digits.slice(3, 6)}.***-**`;
}

function findClientByName(nome = '', base = []) {
  const alvo = normalizePersonName(nome);
  return base.find((item) => normalizePersonName(item.nome) === alvo) || null;
}

function parseBaseCsv(text = '') {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  return lines
    .slice(1)
    .map((line) => {
      const [nome, cpf] = line.split(';');
      if (!nome || !cpf) return null;

      return {
        nome: titleCaseName(nome.trim()),
        cpf: formatCpf(cpf.trim()),
      };
    })
    .filter((item) => item && item.nome && sanitizeCpf(item.cpf).length === 11);
}

  const importBaseClientes = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseBaseCsv(text);

      if (!parsed.length) {
        setError('A base de dados não possui registros válidos. Use o formato nome;cpf.');
        return;
      }

      setBaseClientes(parsed);
      setBaseInfo(`${parsed.length} cliente(s) carregado(s) na base.`);
      setError('');
    } catch (err) {
      console.error(err);
      setError('Não foi possível importar a base de dados.');
    } finally {
      event.target.value = '';
    }
  };

  const aplicarBaseAosProcessados = () => {
    if (!baseClientes.length) {
      setError('Importe a base de dados antes de aplicar.');
      return;
    }

    setProcessedFiles((prev) =>
      prev.map((item) => {
        const encontrado = findClientByName(item.nome, baseClientes);

        if (!encontrado) return item;

        return {
          ...item,
          cpf: item.cpf || encontrado.cpf,
        };
      })
    );

    setError('');
  };

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

        const encontradoNaBase = findClientByName(parsed.nome, baseClientes);

        results.push({
          id: crypto.randomUUID(),
          fileName: file.name,
          nome: parsed.nome,
          nomeConfiavel: parsed.nomeConfiavel,
          confiancaNome: parsed.confiancaNome,
          valorPago: parsed.valorPago,
          cotas: valorCotaNumero > 0 ? parsed.valorPago / valorCotaNumero : 0,
          rawText: parsed.originalText,
          cpf: encontradoNaBase?.cpf || '',
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
    const clienteEncontrado = findClientByName(item.nome, baseClientes);
    setEditingId(item.id);
    setDraftName(item.nome || '');
    setDraftCpf(item.cpf || clienteEncontrado?.cpf || '');
    setDraftCotas(
      item.cotasManual !== undefined && item.cotasManual !== null
        ? String(item.cotasManual)
        : String(item.cotas || '')
    );
  };

  const saveEdit = () => {
    const manualName = titleCaseName(draftName.trim());
    const isManualValid = isLikelyPersonName(manualName);
    const cotasManual = parseNumber(draftCotas);

    const clienteEncontrado = findClientByName(manualName, baseClientes);

    const cpfFinal =
      formatCpf(draftCpf.trim()) ||
      clienteEncontrado?.cpf ||
      '';

    setProcessedFiles((prev) =>
      prev.map((item) =>
        item.id === editingId
          ? {
              ...item,
              nome: manualName || item.nome,
              cpf: cpfFinal,
              nomeConfiavel: isManualValid,
              confiancaNome: isManualValid ? 'manual' : item.confiancaNome,
              cotasManual: cotasManual > 0 ? cotasManual : null,
            }
          : item
      )
    );

    setEditingId(null);
    setDraftName('');
    setDraftCpf('');
    setDraftCotas('');
  };

  const deleteRecord = (id) => {
  const confirmed = window.confirm('Tem certeza que deseja apagar este registro?');
  if (!confirmed) return;

  setProcessedFiles((prev) => prev.filter((item) => item.id !== id));

  if (editingId === id) {
    setEditingId(null);
    setDraftName('');
    setDraftCpf('');
    setDraftCotas('');
  }

  if (expandedRawId === id) {
    setExpandedRawId(null);
  }
};

const addManualParticipant = () => {
  const nome = titleCaseName(manualName.trim());
  const valorPago = parseNumber(manualValorPago);

  if (!nome) {
    setError('Informe o nome do participante manual.');
    return;
  }

  if (valorPago <= 0) {
    setError('Informe um valor pago válido para o lançamento manual.');
    return;
  }

  setError('');

  setProcessedFiles((prev) => [
    {
      id: crypto.randomUUID(),
      fileName: 'Lançamento manual',
      nome,
      nomeConfiavel: true,
      confiancaNome: 'manual',
      valorPago,
      cotas: valorCotaNumero > 0 ? valorPago / valorCotaNumero : 0,
      cotasManual: null,
      rawText: 'Lançamento manual sem comprovante anexado.',
      cpf: manualCpf.trim(),
    },
    ...prev,
  ]);

  setManualOpen(false);
  setManualName('');
  setManualCpf('');
  setManualValorPago('');
};

  const valorCotaNumero = parseNumber(valorCota);
  const premioNumero = parseNumber(premioTotal);
  const percAdmNumero = parseNumber(percAdm);

  const valorAdmPremio = premioNumero > 0 ? (premioNumero * percAdmNumero) / 100 : 0;
  const valorDistribuido = premioNumero > 0 ? premioNumero - valorAdmPremio : 0;

  const totalCotasSemBonusAdm = processedFiles.reduce((sum, item) => {
  const cotasItem =
    item.cotasManual !== undefined && item.cotasManual !== null
      ? Number(item.cotasManual)
      : Number(item.cotas || 0);

  return sum + (Number.isNaN(cotasItem) ? 0 : cotasItem);
}, 0);

  const valorPorCotaDistribuicao =
  totalCotasSemBonusAdm > 0 ? valorDistribuido / totalCotasSemBonusAdm : 0;

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
    const cotas = item.cotasManual !== undefined && item.cotasManual !== null
      ? Number(item.cotasManual)
      : valorCotaNumero > 0
        ? item.valorPago / valorCotaNumero
        : 0;

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

  const totalCotasSemBonusAdm = rows.reduce(
    (sum, row) => sum + row.cotasOriginais,
    0
  );

  const valorPorCotaCalculado =
    totalCotasSemBonusAdm > 0 ? valorDistribuido / totalCotasSemBonusAdm : 0;

  rows.forEach((row) => {
    row.isAdm = admSelecionado === row.nome;
    row.valorReceberBase = row.cotasOriginais * valorPorCotaCalculado;
    row.valorReceberFinal = row.valorReceberBase + (row.isAdm ? valorAdmPremio : 0);

    const cotasBonusAdm =
      row.isAdm && valorPorCotaCalculado > 0
        ? valorAdmPremio / valorPorCotaCalculado
        : 0;

    row.cotasExibidas = row.cotasOriginais + cotasBonusAdm;
  });

  return rows;
}, [processedFiles, valorCotaNumero, admSelecionado, valorAdmPremio, valorDistribuido]);

  const totalPago = consolidatedRows.reduce((sum, row) => sum + row.valorPago, 0);
  const cotasVendidas = consolidatedRows.reduce((sum, row) => sum + row.cotasOriginais, 0);
  const totalArrecadado = cotasVendidas * valorCotaNumero;

  const reviewCount = useMemo(
  () => processedFiles.filter((item) => !item.nomeConfiavel).length,
  [processedFiles]
);

const successCount = useMemo(
  () => processedFiles.filter((item) => item.nomeConfiavel).length,
  [processedFiles]
);

const sortedProcessedFiles = useMemo(() => {
  return [...processedFiles].sort((a, b) => {
    if (a.nomeConfiavel === b.nomeConfiavel) {
      return a.fileName.localeCompare(b.fileName);
    }
    return a.nomeConfiavel ? 1 : -1;
  });
}, [processedFiles]);

const visibleProcessedFiles = useMemo(() => {
  if (!showOnlyPending) return sortedProcessedFiles;
  return sortedProcessedFiles.filter((item) => !item.nomeConfiavel);
}, [sortedProcessedFiles, showOnlyPending]);

function getStatusMeta(item) {
  if (!item.nomeConfiavel) {
    return {
      label: 'Revisar',
      className: 'bg-amber-100 text-amber-800 border border-amber-200',
    };
  }

  if (item.confiancaNome === 'manual') {
    return {
      label: 'Manual',
      className: 'bg-indigo-100 text-indigo-800 border border-indigo-200',
    };
  }

  if (item.fileName?.toLowerCase().match(/\.(jpg|jpeg|png)$/)) {
    return {
      label: 'OCR',
      className: 'bg-sky-100 text-sky-800 border border-sky-200',
    };
  }

  return {
    label: 'Identificado',
    className: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  };
}

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

const exportPDF = ({ maskedCpf = false, fileName = 'gestao-cotas.pdf' } = {}) => {
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
  doc.text(`Número da Compra: ${numeroCompra || '-'}`, margemX, 32);
  doc.text(`Valor da cota: ${formatBRL(valorCotaNumero)}`, margemX, 38);
  doc.text(`Total de pagadores: ${consolidatedRows.length}`, margemX, 44);
  doc.text(`Total de cotas: ${totalCotasDocumento.toFixed(2)}`, margemX, 50);
  doc.text(`Valor total do prêmio: ${formatBRL(premioNumero)}`, margemX, 56);
  doc.setTextColor(0, 0, 0);

  let y = 68;

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
    const cpfExibido = maskedCpf ? maskCpf(row.cpf || '') : (row.cpf || '');
    doc.text(cpfExibido, margemX + 100, y);
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

  doc.save(fileName);
};

if (!authenticated) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
      <div className="mx-auto max-w-md px-4 py-10 sm:py-16">
        <Link
          to={createPageUrl('Home')}
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao menu
        </Link>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <FileText className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Acesso restrito</h1>
              <p className="text-sm text-slate-500">
                Informe a senha para acessar a Gestão de Cotas.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <input
              type="password"
              value={accessPassword}
              onChange={(e) => setAccessPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAccess();
              }}
              placeholder="Digite a senha"
              className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:ring-2 focus:ring-blue-200"
            />

            <button
              type="button"
              onClick={handleAccess}
              className="h-11 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
            >
              Entrar
            </button>

            {authError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {authError}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
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

            <div className="sm:col-span-3">
              <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">Número da Compra</span>
              <input
                type="text"
                value={numeroCompra}
                onChange={(e) => setNumeroCompra(e.target.value)}
                placeholder="Ex.: 496872662"
                className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
              />
             </label>
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

          <input
            ref={baseInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={importBaseClientes}
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
{processedFiles.length > 0 && (
  <div className="mb-4 space-y-3">
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="text-sm text-emerald-700">Identificados</div>
        <div className="text-2xl font-semibold text-emerald-900">{successCount}</div>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="text-sm text-amber-700">Precisam de revisão</div>
        <div className="text-2xl font-semibold text-amber-900">{reviewCount}</div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="text-sm text-slate-600">Total processado</div>
        <div className="text-2xl font-semibold text-slate-900">{processedFiles.length}</div>
      </div>
    </div>

    <div className="flex flex-wrap gap-3">
  <button
    type="button"
    onClick={() => baseInputRef.current?.click()}
    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
  >
    <FileSpreadsheet className="h-4 w-4" />
    Importar base de dados
  </button>

  <button
    type="button"
    onClick={aplicarBaseAosProcessados}
    disabled={!processedFiles.length || !baseClientes.length}
    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
  >
    <CheckCircle2 className="h-4 w-4" />
    Aplicar base aos registros
  </button>
</div>
{baseInfo && (
  <p className="mt-2 text-sm text-slate-500">
    {baseInfo}
  </p>
)}

    <button
      type="button"
      onClick={() => setShowOnlyPending((prev) => !prev)}
      className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      {showOnlyPending ? 'Mostrar todos' : `Mostrar só pendências (${reviewCount})`}
    </button>
  </div>
)}
        {(processedFiles.length > 0 || consolidatedRows.length > 0) && (
          <div className="grid lg:grid-cols-[1fr_1fr] gap-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-800">Processamento</h2>
                <span className="text-sm text-slate-500">{processedFiles.length}/{files.length} concluídos</span>
              </div>
<div className="rounded-2xl border border-slate-200 bg-white p-4">
  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
    <div>
      <div className="text-sm font-semibold text-slate-900">Adicionar participante sem comprovante</div>
      <div className="text-sm text-slate-500">
        Use quando a pessoa pagou, mas não conseguiu enviar o comprovante.
      </div>
    </div>

    <button
      type="button"
      onClick={() => setManualOpen((prev) => !prev)}
      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      <Edit3 className="h-4 w-4" />
      {manualOpen ? 'Fechar' : 'Adicionar manualmente'}
    </button>
  </div>

  {manualOpen && (
    <div className="mt-4 grid gap-3 md:grid-cols-4">
      <input
        type="text"
        value={manualName}
        onChange={(e) => setManualName(e.target.value)}
        placeholder="Nome do participante"
        className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
      />

      <input
        type="text"
        value={manualValorPago}
        onChange={(e) => setManualValorPago(e.target.value)}
        placeholder="Valor pago ex: 12,00"
        className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
      />

      <input
        type="text"
        value={manualCpf}
        onChange={(e) => setManualCpf(e.target.value)}
        placeholder="CPF (opcional)"
        className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
      />

      <button
        type="button"
        onClick={addManualParticipant}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
      >
        <CheckCircle2 className="h-4 w-4" />
        Salvar manualmente
      </button>
    </div>
  )}
</div>
              <div className="space-y-3">
                {visibleProcessedFiles.map((item) => (
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
    onChange={(e) => {
      const novoNome = e.target.value;
      setDraftName(novoNome);

      const clienteEncontrado = findClientByName(novoNome, baseClientes);
      const cpfAtualLimpo = sanitizeCpf(draftCpf);
      const cpfEncontradoLimpo = sanitizeCpf(clienteEncontrado?.cpf || '');

      if (!cpfAtualLimpo || cpfAtualLimpo === cpfEncontradoLimpo) {
        setDraftCpf(clienteEncontrado?.cpf || '');
      }
    }}
    className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
    placeholder="Nome do participante"
  />
  <input
    value={draftCpf}
    onChange={(e) => setDraftCpf(e.target.value)}
    placeholder="CPF (opcional)"
    className="w-full h-10 rounded-xl border border-slate-200 px-3 outline-none focus:ring-2 focus:ring-blue-200"
  />
  <input
    type="number"
    min="0"
    step="0.01"
    value={draftCotas}
    onChange={(e) => setDraftCotas(e.target.value)}
    placeholder="Quantidade de cotas"
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
                              {formatBRL(item.valorPago)} — {(
                                item.cotasManual !== undefined && item.cotasManual !== null
                                  ? item.cotasManual
                                  : item.cotas
                              ).toFixed(2)} cota(s)
                            </p>
                            <button
  type="button"
  onClick={() => deleteRecord(item.id)}
  className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
>
  <Trash2 size={16} />
  Apagar registro
</button>
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
                      onClick={() =>
                        exportPDF({
                          maskedCpf: true,
                          fileName: 'gestao-cotas-compartilhar.pdf',
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      <FileText className="h-4 w-4" />
                      PDF para compartilhar
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        exportPDF({
                          maskedCpf: false,
                          fileName: 'gestao-cotas-oficial.pdf',
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <FileText className="h-4 w-4" />
                      PDF oficial
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