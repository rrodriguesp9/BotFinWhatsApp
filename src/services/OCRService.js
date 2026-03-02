const Tesseract = require("tesseract.js");
const moment = require("moment");

// Canvas é opcional — pode falhar no Render (dependência nativa)
let createCanvas, loadImage;
try {
  const canvasModule = require("canvas");
  createCanvas = canvasModule.createCanvas;
  loadImage = canvasModule.loadImage;
} catch (e) {
  console.warn("⚠️ Canvas não disponível — Tesseract usará buffer direto:", e.message);
  createCanvas = null;
  loadImage = null;
}

class OCRService {
  constructor() {
    this.config = {
      lang: process.env.TESSERACT_LANG || "por+eng", // Português + Inglês
      logger: (m) => console.log(m),

      // ✅ CONFIGURAÇÕES AVANÇADAS PARA MELHORAR PRECISÃO
      tessedit_pageseg_mode: 6, // Uniform block of text
      tessedit_char_whitelist:
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÍÎÏíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûü .,:/()$R%-",
      preserve_interword_spaces: 1,
      user_defined_dpi: 300,
    };
  }

  // ✅ PROCESSAMENTO com múltiplas configurações OCR
  async processImage(imageBuffer) {
    try {
      console.log("🔍 Iniciando processamento OCR universal...");

      // Se canvas não disponível, usar Tesseract direto no buffer
      if (!loadImage || !createCanvas) {
        console.log("📷 Canvas indisponível — processando buffer direto com Tesseract...");
        const result = await Tesseract.recognize(imageBuffer, this.config.lang, {
          logger: (m) => {},
          tessedit_pageseg_mode: 6,
          preserve_interword_spaces: 1,
          user_defined_dpi: 300,
        });

        if (!result || !result.data || !result.data.text) {
          return { success: false, error: "Tesseract não retornou texto" };
        }

        const extractedData = this.extractFinancialDataWithValidation(result.data.text);
        return {
          success: true,
          text: result.data.text,
          extracted: extractedData,
          confidence: result.data.confidence,
          source: "tesseract_raw"
        };
      }

      // Carregar imagem
      const image = await loadImage(imageBuffer);

      // Tentar múltiplos tamanhos se necessário
      const canvases = await this.createMultipleCanvasVersions(image);

      let bestResult = null;
      let bestConfidence = 0;

      // Tentar OCR em cada versão
      for (let i = 0; i < canvases.length; i++) {
        console.log(`🔍 Tentativa OCR ${i + 1}/${canvases.length}...`);

        const result = await this.performOCR(canvases[i], i);

        if (result.data.confidence > bestConfidence) {
          bestConfidence = result.data.confidence;
          bestResult = result;
          console.log(`✅ Nova melhor confiança: ${bestConfidence}%`);
        }
      }

      if (!bestResult) {
        throw new Error("Nenhuma versão OCR foi bem-sucedida");
      }

      console.log(`🎯 Resultado final com confiança: ${bestConfidence}%`);
      console.log("📝 Texto extraído:", bestResult.data.text);

      // DEBUG
      console.log("=== DEBUG COMPLETO DO OCR ===");
      console.log("Texto bruto extraído:");
      console.log("----------------------------");
      console.log(bestResult.data.text);
      console.log("----------------------------");
      console.log("Confiança final:", bestConfidence);
      console.log("============================");

      // Processar texto extraído com validação cruzada
      const extractedData = this.extractFinancialDataWithValidation(
        bestResult.data.text
      );

      return {
        success: true,
        text: bestResult.data.text,
        extracted: extractedData,
        confidence: bestConfidence,
      };
    } catch (error) {
      console.error("❌ Erro no OCR universal:", error);
      return {
        success: false,
        error: error.message,
        text: "",
        extracted: null,
      };
    }
  }

  // ✅ EXTRAÇÃO com validação cruzada
  extractFinancialDataWithValidation(text) {
    console.log("🔍 PROCESSANDO EXTRAÇÃO COM VALIDAÇÃO CRUZADA:");

    const extracted = {
      amount: null,
      date: null,
      establishment: null,
      category: "outros",
      description: "",
      confidence: "low",
      text: text,
      type: "expense",
      // Dados de validação
      alternativeValues: [],
      alternativeDates: [],
      alternativeEstablishments: [],
    };

    try {
      // Extrair com múltiplas estratégias
      const valueData = this.extractValuesWithAlternatives(text);
      extracted.amount = valueData.primary;
      extracted.alternativeValues = valueData.alternatives;

      const dateData = this.extractDatesWithAlternatives(text);
      extracted.date = dateData.primary;
      extracted.alternativeDates = dateData.alternatives;

      const establishmentData =
        this.extractEstablishmentsWithAlternatives(text);
      extracted.establishment = establishmentData.primary;
      extracted.alternativeEstablishments = establishmentData.alternatives;

      // Determinar categoria baseada em múltiplas fontes
      extracted.category = this.determineCategory(
        extracted.establishment,
        text
      );

      // Gerar descrição
      extracted.description = this.generateDescription(extracted);

      // Calcular confiança baseada em validação cruzada
      extracted.confidence = this.calculateUniversalConfidence(extracted);

      console.log("✅ EXTRAÇÃO COM VALIDAÇÃO CONCLUÍDA:", {
        valor: extracted.amount,
        data: extracted.date,
        estabelecimento: extracted.establishment,
        categoria: extracted.category,
        confianca: extracted.confidence,
      });
    } catch (error) {
      console.error("❌ Erro na extração com validação:", error);
    }

    return extracted;
  }

  // ✅ extractDatesWithAlternatives (FALTANDO)
  extractDatesWithAlternatives(text) {
    const patterns = [
      /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/g,
      /(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{2,4})/g,
    ];

    let allDates = [];

    for (const pattern of patterns) {
      const matches = [...text.matchAll(pattern)];

      for (const match of matches) {
        const day = parseInt(match[1]);
        const month = parseInt(match[2]);
        let year = parseInt(match[3]);

        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
          if (year < 100) {
            year = year > 50 ? 1900 + year : 2000 + year;
          }

          const date = new Date(year, month - 1, day);
          if (
            date.getFullYear() === year &&
            date.getMonth() === month - 1 &&
            date.getDate() === day
          ) {
            allDates.push({
              date: date,
              original: match[0],
              confidence: year > 2000 ? 2 : 1,
            });
          }
        }
      }
    }

    allDates.sort((a, b) => b.confidence - a.confidence);

    return {
      primary: allDates.length > 0 ? allDates[0].date : new Date(),
      alternatives: allDates.slice(1, 2).map((d) => d.date),
    };
  }

  // ✅ CORREÇÃO 1: Substituir o método extractValuesWithAlternatives
  extractValuesWithAlternatives(text) {
    console.log("💰 Procurando valores com padrões corrigidos...");

    // ✅ CORREÇÃO OCR ANTES de processar
    const cleanText = this.applyOCRCorrections(text);
    console.log("🔧 Texto após correções OCR:", cleanText);

    const strategies = [
      // ✅ ESTRATÉGIA 1: TOTAL (PRIORIDADE MÁXIMA)
      {
        patterns: [
          /(?:total|btal|tetal|t[o0]tal)[\s:]*[^\d]*?(\d{1,4}[,\.\/]\d{2})/gi,
          /(?:valor\s*total|total\s*geral)[\s:]*[^\d]*?(\d{1,4}[,\.\/]\d{2})/gi,
          /(?:pagamento|pago|valor\s*pago)[\s:]*[^\d]*?(\d{1,4}[,\.\/]\d{2})/gi,
        ],
        weight: 2.0, // ✅ PESO MÁXIMO
        type: "total",
      },

      // ✅ ESTRATÉGIA 2: R$ direto (alta prioridade)
      {
        patterns: [
          /[rR]\$\s*(\d{1,4}[,\.\/]\d{2})/gi,
          /[rR][sS]\s*(\d{1,4}[,\.\/]\d{2})/gi,
        ],
        weight: 1.5,
        type: "currency",
      },

      // ✅ ESTRATÉGIA 3: PARCELAS (prioridade menor)
      {
        patterns: [
          /(?:parcela[s]?|p[a4]rcel[a4][s]?)[\s:]*[^\d]*?(\d{1,2})\s*[xX]\s*[rs\$]*\s*(\d{1,4}[,\.\/]\d{2})/gi,
          /\b(\d{1,2})\s*[xX]\s*[rs\$]*\s*(\d{1,4}[,\.\/]\d{2})/gi,
        ],
        weight: 0.8, // ✅ PESO MENOR QUE TOTAL
        type: "installment",
      },

      // ✅ ESTRATÉGIA 4: Valores isolados (última prioridade)
      {
        patterns: [/(\d{1,4}[,\.\/]\d{2})/g],
        weight: 0.3,
        type: "isolated",
      },
    ];

    let allValues = [];

    // ✅ PROCESSAR ESTRATÉGIAS EM ORDEM DE PRIORIDADE
    for (const strategy of strategies) {
      for (const pattern of strategy.patterns) {
        const matches = [...cleanText.matchAll(pattern)];

        if (matches.length > 0) {
          console.log(
            `🔍 Estratégia ${strategy.type} encontrou:`,
            matches.map((m) => m[0])
          );
        }

        for (const match of matches) {
          // Para padrões de parcela (2 grupos)
          if (match[2] && strategy.type === "installment") {
            let installments = parseInt(match[1]);
            const installmentValue = this.parseUniversalAmount(match[2]);

            if (
              installmentValue &&
              installments &&
              installments >= 1 &&
              installments <= 24
            ) {
              const totalValue = installments * installmentValue;

              allValues.push({
                value: totalValue,
                weight: strategy.weight,
                context: this.getValueContext(cleanText, match[0]),
                original: match[0],
                type: strategy.type,
                installments: installments,
                installmentValue: installmentValue,
              });

              console.log(
                `💳 Parcela: ${installments}x ${installmentValue} = ${totalValue}`
              );
            }
          }
          // Para valores únicos
          else if (match[1]) {
            const amount = this.parseUniversalAmount(match[1]);
            if (amount && amount > 1 && amount < 50000) {
              // ✅ BONUS extra para TOTAL detectado
              let finalWeight = strategy.weight;
              if (strategy.type === "total") {
                finalWeight += 1.0; // Bonus adicional para total
              }

              allValues.push({
                value: amount,
                weight: finalWeight,
                context: this.getValueContext(cleanText, match[0]),
                original: match[0],
                type: strategy.type,
              });

              console.log(
                `💰 ${strategy.type.toUpperCase()}: R$ ${amount} (peso: ${finalWeight})`
              );
            }
          }
        }
      }
    }

    // ✅ ORDENAÇÃO MELHORADA
    allValues.sort((a, b) => {
      // Priorizar TOTAL sempre
      if (a.type === "total" && b.type !== "total") return -1;
      if (b.type === "total" && a.type !== "total") return 1;

      // Depois por peso
      return b.weight - a.weight;
    });

    // ✅ FILTRAR duplicatas próximas
    const filteredValues = this.removeSimilarValues(allValues);

    console.log("💰 Top 3 valores finais:");
    filteredValues.slice(0, 3).forEach((v, i) => {
      console.log(
        `  ${i + 1}. R$ ${v.value} (${v.type}, peso: ${v.weight}) - "${
          v.original
        }"`
      );
    });

    return {
      primary: filteredValues.length > 0 ? filteredValues[0].value : null,
      alternatives: filteredValues.slice(1, 3).map((v) => v.value),
      bestMatch: filteredValues[0] || null,
    };
  }

  // ✅ NOVO MÉTODO: Correções específicas de OCR
  applyOCRCorrections(text) {
    return (
      text
        // Correções de pontuação
        .replace(/(\d+)[\/\\|](\d{2})/g, "$1,$2") // 290/23 → 290,23
        .replace(/(\d+)\s+(\d{2})\s+(\d)/g, "$1,$2") // 290 23 7 → 290,23

        // Correções de caracteres
        .replace(/[Dd](\d)/g, "1$1") // D5 → 15
        .replace(/(\d)[Dd]/g, "$1") // 5D → 5
        .replace(/[Oo](\d)/g, "0$1") // O5 → 05
        .replace(/(\d)[Oo]/g, "$10") // 5O → 50

        // Limpeza geral
        .replace(/\s+/g, " ") // múltiplos espaços
        .trim()
    );
  }

  // ✅ NOVO MÉTODO: Remover valores similares
  removeSimilarValues(values) {
    const filtered = [];

    for (const value of values) {
      const isDuplicate = filtered.some((existing) => {
        const diff = Math.abs(existing.value - value.value);
        const percentDiff = diff / Math.max(existing.value, value.value);
        return percentDiff < 0.1; // 10% de diferença = similar
      });

      if (!isDuplicate) {
        filtered.push(value);
      }
    }

    return filtered;
  }

  // ✅ VERSÃO 100% GENÉRICA - extractEstablishmentsWithAlternatives
  extractEstablishmentsWithAlternatives(text) {
    const lines = text.split("\n").filter((line) => line.trim().length > 0);
    const candidates = [];

    console.log(
      "🏪 Analisando linhas para estabelecimento:",
      lines.slice(0, 8)
    );

    // Palavras que geralmente NÃO são nomes de estabelecimentos
    const invalidKeywords = [
      "total",
      "parcela",
      "cnpj",
      "cpf",
      "visa",
      "mastercard",
      "credito",
      "debito",
      "pagamento",
      "avenida",
      "rua",
      "telefone",
      "documento",
      "fiscal",
      "consumidor",
      "via cliente",
      "danfe",
      "nfce",
      "nota",
      "cupom",
      "acesso",
      "data",
      "hora",
      "estabelecim",
      "numero",
      "autoriza",
      "codigo",
      "tribut",
    ];

    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i].trim();

      // Filtros básicos para identificar possíveis nomes
      if (
        line.length >= 3 && // Mínimo 3 caracteres
        line.length <= 40 && // Máximo 40 caracteres
        !/^\d{1,2}[\/\-\.]\d{1,2}/.test(line) && // Não é data
        !/^\d+$/.test(line) && // Não é só números
        !/^[\W\d]*$/.test(line) && // Não é só símbolos/números
        !invalidKeywords.some((keyword) => line.toLowerCase().includes(keyword))
      ) {
        // Limpar o nome
        let cleanName = line
          .replace(/[^\w\sÀ-ÿ]/g, " ") // Remove símbolos, mantém acentos
          .replace(/\s+/g, " ") // Múltiplos espaços → um espaço
          .replace(
            /\b(à|para|R|J|RJ|ltda|eireli|me|ha|via|cliente|cnpj|cpf)\b/gi,
            ""
          ) // Remove palavras comuns
          .trim();

        if (cleanName.length >= 3 && cleanName.length <= 30) {
          const score = this.calculateEstablishmentScore(cleanName, text, i);

          candidates.push({
            name: cleanName,
            line: i,
            score: score,
          });

          console.log(
            `🏪 Candidato: "${cleanName}" (linha ${i}, score: ${score.toFixed(
              2
            )})`
          );
        }
      }
    }

    // Ordenar por score
    candidates.sort((a, b) => b.score - a.score);

    return {
      primary:
        candidates.length > 0
          ? candidates[0].name
          : "Estabelecimento não identificado",
      alternatives: candidates.slice(1, 2).map((c) => c.name),
    };
  }

  // ✅ VERSÃO MELHORADA - calculateEstablishmentScore
  calculateEstablishmentScore(name, text, lineIndex = 0) {
    let score = 0;

    // Bonus por posição (primeiras linhas têm mais chance de ser o nome)
    if (lineIndex <= 2) score += 0.4;
    else if (lineIndex <= 5) score += 0.2;

    // Bonus por tamanho ideal
    if (name.length >= 5 && name.length <= 20) {
      score += 0.3;
    }

    // Bonus se parece com nome de estabelecimento conhecido
    const businessTypes = [
      "drogaria",
      "farmacia",
      "mercado",
      "super",
      "restaurante",
      "loja",
      "padaria",
      "posto",
      "lanchonete",
      "pizzaria",
      "hamburgueria",
      "magazine",
      "casa",
      "mundo",
      "cia",
      "comercio",
    ];

    for (const type of businessTypes) {
      if (name.toLowerCase().includes(type)) {
        score += 0.5;
        break;
      }
    }

    // Penalizar se tem muitos números
    const numberRatio = (name.match(/\d/g) || []).length / name.length;
    score -= numberRatio * 0.4;

    // Penalizar se tem caracteres muito estranhos
    if (/[^a-zA-ZÀ-ÿ\s\d]/.test(name)) {
      score -= 0.2;
    }

    // Bonus se aparece múltiplas vezes no texto (consistência)
    const occurrences = (
      text.toLowerCase().match(new RegExp(name.toLowerCase(), "g")) || []
    ).length;
    if (occurrences > 1) {
      score += 0.2;
    }

    return Math.max(0, score); // Não pode ser negativo
  }

  // ✅ CORREÇÃO 2: Melhorar parseUniversalAmount
  parseUniversalAmount(valueStr) {
    if (!valueStr) return null;

    console.log(`🔢 Parseando: "${valueStr}"`);

    // ✅ CORREÇÕES OCR mais agressivas
    let clean = valueStr
      .replace(/[Dd]/g, "1") // D → 1
      .replace(/[Oo]/g, "0") // O → 0
      .replace(/[Ss]/g, "5") // S → 5
      .replace(/[gGbB]/g, "6") // G/B → 6
      .replace(/[lLiI]/g, "1") // l/I → 1
      .replace(/[zZ]/g, "2") // Z → 2
      .replace(/[\/\\|]/g, ",") // ✅ /|\ → , (correção principal)
      .replace(/[^\d,\.]/g, "") // só números, vírgula e ponto
      .replace(/\.(?=.*\.)/, "") // remove pontos extras
      .replace(",", "."); // vírgula → ponto decimal

    console.log(`🔢 Limpo: "${clean}"`);

    const amount = parseFloat(clean);
    const result = isNaN(amount) ? null : amount;

    if (result) {
      console.log(`✅ Valor final: R$ ${result}`);
    }

    return result;
  }
  // ✅ calculateUniversalConfidence (PODE ESTAR FALTANDO)
  calculateUniversalConfidence(extracted) {
    let confidence = 0;

    // Valor
    if (extracted.amount && extracted.amount > 1) {
      confidence += 0.4;
      if (extracted.alternativeValues && extracted.alternativeValues.length > 0)
        confidence += 0.1;
    }

    // Data (não atual)
    if (
      extracted.date &&
      extracted.date.toDateString() !== new Date().toDateString()
    ) {
      confidence += 0.2;
    }

    // Estabelecimento
    if (
      extracted.establishment &&
      extracted.establishment !== "Estabelecimento não identificado"
    ) {
      confidence += 0.2;
      if (extracted.establishment.length > 5) confidence += 0.1;
    }

    // Categoria específica
    if (extracted.category !== "outros") {
      confidence += 0.1;
    }

    if (confidence >= 0.7) return "high";
    if (confidence >= 0.4) return "medium";
    return "low";
  }

  preprocessImage(canvas) {
    console.log("🖼️ Aplicando pré-processamento universal...");

    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const processedVersions = [
      this.applyContrastEnhancement(imageData),
      this.applyNoiseReduction(imageData),
      this.applySharpening(imageData),
    ];

    const bestVersion = this.selectBestImageVersion(processedVersions);

    // ✅ CORREÇÃO: Criar ImageData compatível com Node.js Canvas
    const finalImageData = ctx.createImageData(
      bestVersion.width,
      bestVersion.height
    );
    finalImageData.data.set(bestVersion.data);

    ctx.putImageData(finalImageData, 0, 0);
    return canvas;
  }
  // ✅ CRIAR múltiplas versões da imagem
  async createMultipleCanvasVersions(image) {
    const versions = [];

    // Versão original
    const originalCanvas = createCanvas(image.width, image.height);
    const originalCtx = originalCanvas.getContext("2d");
    originalCtx.drawImage(image, 0, 0);
    versions.push(this.preprocessImage(originalCanvas));

    // Versão redimensionada (se muito pequena ou muito grande)
    if (image.width < 800 || image.width > 2000) {
      const targetWidth = 1200;
      const scale = targetWidth / image.width;
      const scaledHeight = Math.round(image.height * scale);

      const scaledCanvas = createCanvas(targetWidth, scaledHeight);
      const scaledCtx = scaledCanvas.getContext("2d");
      scaledCtx.drawImage(image, 0, 0, targetWidth, scaledHeight);
      versions.push(this.preprocessImage(scaledCanvas));

      console.log(
        `📏 Criada versão redimensionada: ${targetWidth}x${scaledHeight}`
      );
    }

    return versions;
  }

  applyContrastEnhancement(imageData) {
    const data = new Uint8ClampedArray(imageData.data);

    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const enhanced = this.applySCurve(gray);

      data[i] = enhanced;
      data[i + 1] = enhanced;
      data[i + 2] = enhanced;
    }

    return {
      data: data,
      width: imageData.width,
      height: imageData.height,
    };
  }

  applyNoiseReduction(imageData) {
    const data = new Uint8ClampedArray(imageData.data);
    const originalData = new Uint8ClampedArray(imageData.data);
    const width = imageData.width;
    const height = imageData.height;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;

        const neighbors = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nIdx = ((y + dy) * width + (x + dx)) * 4;
            const gray =
              originalData[nIdx] * 0.299 +
              originalData[nIdx + 1] * 0.587 +
              originalData[nIdx + 2] * 0.114;
            neighbors.push(gray);
          }
        }

        neighbors.sort((a, b) => a - b);
        const median = neighbors[4];

        data[idx] = median;
        data[idx + 1] = median;
        data[idx + 2] = median;
      }
    }

    return {
      data: data,
      width: width,
      height: height,
    };
  }

  applySharpening(imageData) {
    const data = new Uint8ClampedArray(imageData.data);
    const originalData = new Uint8ClampedArray(imageData.data); // Manter original para leitura
    const width = imageData.width;
    const height = imageData.height;

    // Kernel de sharpening
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let sum = 0;
        let kernelIdx = 0;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const idx = ((y + dy) * width + (x + dx)) * 4;
            const gray =
              originalData[idx] * 0.299 +
              originalData[idx + 1] * 0.587 +
              originalData[idx + 2] * 0.114;
            sum += gray * kernel[kernelIdx++];
          }
        }

        const result = Math.max(0, Math.min(255, sum));
        const idx = (y * width + x) * 4;

        data[idx] = result;
        data[idx + 1] = result;
        data[idx + 2] = result;
      }
    }

    return {
      data: data,
      width: width,
      height: height,
    };
  }

  // ✅ CURVA S para contraste natural
  applySCurve(value) {
    const normalized = value / 255;
    const enhanced =
      Math.pow(normalized, 0.7) *
      Math.pow(4 * normalized * (1 - normalized), 0.8);
    return Math.max(0, Math.min(255, enhanced * 255));
  }

  // ✅ SELETOR da melhor versão da imagem
  selectBestImageVersion(versions) {
    // Calcular "qualidade" baseada em contraste e definição
    let bestVersion = versions[0];
    let bestScore = this.calculateImageQuality(versions[0]);

    for (let i = 1; i < versions.length; i++) {
      const score = this.calculateImageQuality(versions[i]);
      if (score > bestScore) {
        bestScore = score;
        bestVersion = versions[i];
      }
    }

    console.log(
      `✅ Melhor versão selecionada com score: ${bestScore.toFixed(2)}`
    );
    return bestVersion;
  }

  // ✅ CALCULAR qualidade da imagem
  calculateImageQuality(imageData) {
    const data = imageData.data;
    let contrast = 0;
    let sharpness = 0;

    // Calcular contraste (diferença entre pixels adjacentes)
    for (let i = 0; i < data.length - 4; i += 4) {
      const gray1 = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const gray2 =
        data[i + 4] * 0.299 + data[i + 5] * 0.587 + data[i + 6] * 0.114;
      contrast += Math.abs(gray1 - gray2);
    }

    // Normalizar scores
    contrast /= data.length / 4;

    return contrast;
  }

  // ✅ REALIZAR OCR com configurações específicas
  async performOCR(canvas, attemptIndex) {
    const configs = [
      // Configuração padrão
      {
        tessedit_pageseg_mode: 6,
        tessedit_char_whitelist:
          "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÍÎÏíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûü .,:/()$R%-",
      },
      // Configuração para texto esparso
      {
        tessedit_pageseg_mode: 11,
        tessedit_char_whitelist:
          "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀ-ÿ .,:/()$R%-",
      },
      // Configuração para uma única coluna
      {
        tessedit_pageseg_mode: 8,
        tessedit_char_whitelist:
          "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀ-ÿ .,:/()$R%-",
      },
    ];

    const config = configs[attemptIndex] || configs[0];

    return await Tesseract.recognize(canvas.toBuffer(), this.config.lang, {
      logger: (m) => {}, // Silenciar logs repetidos
      ...config,
      preserve_interword_spaces: 1,
      user_defined_dpi: 300,
    });
  }

  // ✅ MELHORAR extractPaymentInfo - Detectar parcelas melhor
  extractPaymentInfo(text) {
    console.log("💳 Extraindo informações de pagamento universalmente...");

    const paymentInfo = {
      total: null,
      installments: null,
      installmentValue: null,
      paymentMethod: null,
    };

    // Buscar TOTAL mais agressivamente
    const totalPatterns = [
      /(?:total|btal|tetal|or\s*total)[\s:]*[^\d]*?(\d{1,4}[,\.]\d{2})/gi,
      /(?:pagamento|pago)[\s:]*[^\d]*?(\d{1,4}[,\.]\d{2})/gi,
    ];

    for (const pattern of totalPatterns) {
      const matches = [...text.matchAll(pattern)];
      console.log(
        `💰 Padrão TOTAL encontrou:`,
        matches.map((m) => m[0])
      );

      for (const match of matches) {
        if (match[1]) {
          const cleanTotal = match[1].replace(/[Dd]/g, "1").replace(",", ".");
          const total = parseFloat(cleanTotal);
          if (!isNaN(total) && total > 0 && total < 50000) {
            paymentInfo.total = total;
            console.log(`✅ Total encontrado: R$ ${total}`);
            break;
          }
        }
      }
      if (paymentInfo.total) break;
    }

    // Buscar PARCELAS universalmente
    const installmentPatterns = [
      // "PARCELAS: 2X R$ 68,09" ou "2 x 68,09"
      /(?:parcela[s]?[\s:]*)?(\d{1,2})\s*[xX]\s*[rs\$]*\s*(\d{1,4}[,\.]\d{2})/gi,
      // OCR ruim: "ta ee x 68,89" ou "02 x"
      /(?:ta\s*ee|te\s*ee|o\s*2|02)\s*[xX]\s*[rs\$]*\s*(\d{1,4}[,\.]\d{2})/gi,
      // Só buscar "x valor" sem número de parcelas
      /[xX]\s*[rs\$]*\s*(\d{1,4}[,\.]\d{2})/gi,
    ];

    for (const pattern of installmentPatterns) {
      const matches = [...text.matchAll(pattern)];
      console.log(
        `💳 Padrão PARCELAS encontrou:`,
        matches.map((m) => m[0])
      );

      for (const match of matches) {
        let installments = null;
        let installmentValue = null;

        if (match[2]) {
          // Tem número de parcelas explícito
          installments = parseInt(match[1]);
          installmentValue = parseFloat(match[2].replace(",", "."));
        } else if (match[1] && !isNaN(parseInt(match[1]))) {
          // Pode ser número de parcelas ou valor
          const num = parseFloat(match[1].replace(",", "."));
          if (num <= 24) {
            // Provavelmente é número de parcelas, valor em outro lugar
            installments = parseInt(match[1]);
          } else {
            // Provavelmente é valor
            installmentValue = num;
          }
        } else if (match[1]) {
          // Só valor
          installmentValue = parseFloat(match[1].replace(",", "."));
          if (
            pattern.toString().includes("ta.*ee") ||
            pattern.toString().includes("02")
          ) {
            installments = 2; // Assumir 2x para "ta ee x"
          }
        }

        if (
          installmentValue &&
          installmentValue > 0 &&
          installmentValue < 10000
        ) {
          paymentInfo.installments = installments;
          paymentInfo.installmentValue = installmentValue;
          console.log(
            `✅ Parcela encontrada: ${
              installments || "?"
            }x de R$ ${installmentValue}`
          );

          // Se não tem total mas tem parcelas, calcular
          if (!paymentInfo.total && installments && installmentValue) {
            paymentInfo.total = installments * installmentValue;
            console.log(
              `✅ Total calculado: ${installments} x ${installmentValue} = R$ ${paymentInfo.total}`
            );
          }
          break;
        }
      }
      if (paymentInfo.installmentValue) break;
    }

    // Buscar método de pagamento
    const paymentMethods = [
      "visa",
      "mastercard",
      "crédito",
      "credito",
      "débito",
      "debito",
      "dinheiro",
      "pix",
    ];
    for (const method of paymentMethods) {
      if (text.toLowerCase().includes(method)) {
        paymentInfo.paymentMethod = method;
        console.log(`💳 Método de pagamento: ${method}`);
        break;
      }
    }

    console.log("💳 Informações de pagamento finais:", paymentInfo);
    return paymentInfo;
  }

  // ✅ determineCategory (VERIFICAR SE EXISTE)
  determineCategory(establishment, text) {
    const lowerEstablishment = establishment ? establishment.toLowerCase() : "";
    const lowerText = text.toLowerCase();

    console.log("🔍 Determinando categoria para:", establishment);

    // ✅ MAPEAMENTO DE CATEGORIAS
    const categoryMap = {
      // SAÚDE/FARMÁCIA
      saúde: [
        "drogaria",
        "farmacia",
        "droga",
        "raia",
        "drogasil",
        "pacheco",
        "ultrafarma",
        "onofre",
      ],

      // ALIMENTAÇÃO
      alimentação: [
        "restaurante",
        "lanchonete",
        "pizzaria",
        "hamburgueria",
        "padaria",
        "mcdonalds",
        "burger king",
        "kfc",
        "subway",
        "laranjinha",
      ],

      // MERCADO/SUPERMERCADO
      mercado: [
        "supermercado",
        "mercado",
        "carrefour",
        "extra",
        "walmart",
        "atacadao",
        "assai",
        "pao de acucar",
        "bompreco",
        "big",
      ],

      // TRANSPORTE
      transporte: [
        "uber",
        "99",
        "taxi",
        "posto",
        "shell",
        "petrobras",
        "ipiranga",
      ],

      // VESTUÁRIO
      vestuário: ["renner", "cea", "riachuelo", "zara", "hm", "magazine luiza"],

      // SERVIÇOS
      serviços: ["salao", "barbearia", "oficina", "lavanderia", "academia"],
    };

    // Verificar cada categoria
    for (const [category, keywords] of Object.entries(categoryMap)) {
      for (const keyword of keywords) {
        if (
          lowerEstablishment.includes(keyword) ||
          lowerText.includes(keyword)
        ) {
          console.log(`✅ Categoria: ${category} (via: ${keyword})`);
          return category;
        }
      }
    }

    console.log('📂 Categoria não identificada, usando "outros"');
    return "outros";
  }

  // ✅ getValueContext (VERIFICAR SE EXISTE)
  getValueContext(text, matchText) {
    // Pegar 50 caracteres antes e depois do match
    const index = text.indexOf(matchText);
    if (index === -1) return "";

    const start = Math.max(0, index - 50);
    const end = Math.min(text.length, index + matchText.length + 50);
    const context = text.substring(start, end).toLowerCase();

    console.log(`🔍 Contexto para "${matchText}": "${context}"`);
    return context;
  }

  // ✅ MELHORAR generateConfirmationMessage para mostrar parcelas corretas
  generateConfirmationMessage(extracted) {
    if (!extracted.amount) {
      return (
        `❌ **Não consegui extrair o valor do recibo.**\n\n` +
        `Por favor, digite o valor manualmente:\n` +
        `Exemplo: "gastei 50 no mercado"`
      );
    }

    const amountFormatted = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(extracted.amount);

    let message =
      `📷 **DADOS EXTRAÍDOS DO RECIBO**\n\n` +
      `💰 **Valor:** ${amountFormatted}\n`;

    if (
      extracted.establishment &&
      extracted.establishment !== "Estabelecimento não identificado"
    ) {
      message += `🏪 **Estabelecimento:** ${extracted.establishment}\n`;
    }

    if (extracted.date) {
      message += `📅 **Data:** ${moment(extracted.date).format(
        "DD/MM/YYYY"
      )}\n`;
    }

    message += `📂 **Categoria:** ${extracted.category}\n`;

    // ✅ MELHORAR exibição de parcelas usando dados extraídos
    const valueData = this.extractValuesWithAlternatives(extracted.text || "");
    if (valueData.bestMatch && valueData.bestMatch.type === "installment") {
      const { installments, installmentValue } = valueData.bestMatch;
      message += `💳 **Parcelamento:** ${installments}x de ${new Intl.NumberFormat(
        "pt-BR",
        {
          style: "currency",
          currency: "BRL",
        }
      ).format(installmentValue)}\n`;
    }

    message += `\n`;

    if (extracted.confidence === "low") {
      message += `⚠️ **Confiança baixa** - Por favor, confirme os dados acima.\n\n`;
      message += `Responda:\n• "sim" para confirmar\n• "não" para cancelar\n• "editar valor 150" para corrigir`;
    } else {
      message += `✅ **Confirma este gasto?**\n\n`;
      message += `Responda:\n• "sim" para confirmar\n• "não" para cancelar`;
    }

    return message;
  }

  // ✅ generateDescription (VERIFICAR SE EXISTE)
  generateDescription(extracted) {
    const parts = [];

    if (
      extracted.establishment &&
      extracted.establishment !== "Estabelecimento não identificado"
    ) {
      parts.push(extracted.establishment);
    }

    if (extracted.amount) {
      parts.push(`R$ ${extracted.amount.toFixed(2)}`);
    }

    if (extracted.date) {
      const moment = require("moment");
      parts.push(moment(extracted.date).format("DD/MM/YYYY"));
    }

    return parts.join(" - ") || "Transação via OCR";
  }

  // Validar se a imagem parece ser um recibo
  validateReceiptImage(imageBuffer) {
    // Verificações básicas
    const minSize = 1024; // 1KB
    const maxSize = 10 * 1024 * 1024; // 10MB

    if (imageBuffer.length < minSize) {
      return { valid: false, reason: "Imagem muito pequena" };
    }

    if (imageBuffer.length > maxSize) {
      return { valid: false, reason: "Imagem muito grande" };
    }

    return { valid: true };
  }
}

module.exports = OCRService;
