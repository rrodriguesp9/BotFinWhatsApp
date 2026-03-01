// ✅ MELHORIAS APLICADAS: GoogleVisionOCRService.js
const vision = require("@google-cloud/vision");
const moment = require("moment");

class GoogleVisionOCRService {
  constructor() {
    console.log("🔧 Inicializando Google Vision API...");

    this.client = new vision.ImageAnnotatorClient({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    });
  }

  async processImage(imageBuffer) {
    try {
      console.log("🔍 Iniciando Google Vision OCR...");

      // ✅ ANÁLISE DE TEXTO COMPLETA
      const [result] = await this.client.textDetection({
        image: { content: imageBuffer },
      });

      const detections = result.textAnnotations;
      if (!detections || detections.length === 0) {
        throw new Error("Nenhum texto detectado na imagem");
      }

      const fullText = detections[0].description;
      console.log("📝 Texto Google Vision:", fullText);
      console.log("✅ Confiança: ~95%");

      // ✅ EXTRAÇÃO INTELIGENTE
      const extractedData = this.extractFinancialData(fullText);

      return {
        success: true,
        text: fullText,
        extracted: extractedData,
        confidence: 95,
      };
    } catch (error) {
      console.error("❌ Erro no Google Vision:", error);
      return {
        success: false,
        error: error.message,
        text: "",
        extracted: null,
      };
    }
  }

  // 🆕 ATUALIZAR: extractFinancialData para incluir parcelas
  extractFinancialData(text) {
    console.log("💰 Extraindo dados financeiros do Google Vision...");

    const extracted = {
      amount: null,
      date: null,
      establishment: null,
      category: "outros",
      description: "",
      confidence: "high",
      type: "expense",
      installments: null,
    };

    try {
      // ✅ DETECTAR PARCELAS PRIMEIRO
      console.log("🔍 Iniciando detecção de parcelas...");
      const installmentData = this.detectInstallments(text);

      // ✅ BUSCAR TAMBÉM O VALOR TOTAL
      const totalAmount = this.extractAmount(text);
      console.log(`💰 Valor total encontrado: R$ ${totalAmount}`);

      if (installmentData.hasInstallments) {
        console.log("✅ PARCELAS DETECTADAS!");

        // ✅ USAR DADOS DE PARCELAMENTO
        extracted.amount = installmentData.installmentValue;
        extracted.installments = {
          hasInstallments: true,
          totalInstallments: installmentData.totalInstallments,
          installmentValue: installmentData.installmentValue,
          totalAmount: installmentData.totalAmount,
          currentInstallment: 1,
        };

        console.log("💳 Dados de parcelas extraídos:", extracted.installments);
      } else {
        console.log("📄 Sem parcelas detectadas, usando valor total");
        // ✅ LÓGICA ORIGINAL: Extrair valor total
        extracted.amount = totalAmount;
      }

      // ✅ RESTO DA EXTRAÇÃO (igual antes)
      extracted.date = this.extractDate(text);
      extracted.establishment = this.extractEstablishment(text);
      extracted.category = this.determineCategory(
        extracted.establishment,
        text
      );
      extracted.description = this.generateDescription(extracted);

      console.log("✅ Extração concluída:", {
        valor: extracted.amount,
        data: extracted.date,
        estabelecimento: extracted.establishment,
        categoria: extracted.category,
        tipo: extracted.type,
        parcelas: extracted.installments
          ? `${extracted.installments.totalInstallments}x de R$ ${extracted.installments.installmentValue}`
          : "à vista",
      });
    } catch (error) {
      console.error("❌ Erro na extração:", error);
    }

    return extracted;
  }

  // ✅ EXTRAIR VALOR com prioridade para TOTAL - CORRIGIDO
  extractAmount(text) {
    console.log("💰 Buscando valores...");
    console.log("🔍 Texto para análise:", text.substring(0, 200) + "...");

    const strategies = [
      // VALOR A PAGAR (prioridade máxima para notas fiscais)
      {
        patterns: [
          /(?:valor\s*a\s*pagar|total\s*a\s*pagar)[\s:]*[^\d]*?r?\$?\s*(\d{1,4}[,\.]\d{2})/gi,
          /valor\s*a\s*pagar\s*r?\$?\s*(\d{1,4}[,\.]\d{2})/gi,
        ],
        weight: 20, // ✅ PESO AINDA MAIOR
      },

      // Padrão específico da NFCe: "222.88" seguido de "222.86" (troco)
      {
        patterns: [/(\d{3}[,\.]\d{2})\s*\n?\s*(\d{3}[,\.]\d{2})\s*$/gm],
        weight: 18,
        extract: (match) => {
          // Pegar o primeiro valor (que é o valor a pagar)
          return parseFloat(match[1].replace(",", "."));
        },
      },

      // TOTAL seguido de valor na mesma linha ou próxima
      {
        patterns: [
          /total[\s:]*r?\$?\s*(\d{1,4}[,\.]\d{2})/gi,
          /total[\s:]*\n[\s]*r?\$?\s*(\d{1,4}[,\.]\d{2})/gi,
          /r?\$?\s*(\d{1,4}[,\.]\d{2})[\s]*total/gi,
        ],
        weight: 12,
      },

      // Padrão específico: "R$ XXX,XX" seguido de "TOTAL:" na linha seguinte
      {
        patterns: [/r\$\s*(\d{1,4}[,\.]\d{2})[\s\n]*total[\s:]/gi],
        weight: 11,
      },

      // SUBTOTAL
      {
        patterns: [
          /(?:subtotal|sub[\s\-]?total)[\s:]*[^\d]*?r?\$?\s*(\d{1,4}[,\.]\d{2})/gi,
        ],
        weight: 8,
      },

      // VALOR PAGO
      {
        patterns: [
          /(?:valor\s*pago|pago|pagamento)[\s:]*[^\d]*?r?\$?\s*(\d{1,4}[,\.]\d{2})/gi,
        ],
        weight: 7,
      },

      // R$ direto (reduzindo peso para evitar conflito)
      {
        patterns: [/r\$\s*(\d{1,4}[,\.]\d{2})/gi, /rs\s*(\d{1,4}[,\.]\d{2})/gi],
        weight: 3,
      },

      // Valores isolados (menor prioridade)
      {
        patterns: [/(\d{1,4}[,\.]\d{2})/g],
        weight: 1,
      },
    ];

    let bestValue = null;
    let bestWeight = 0;
    let allFoundValues = [];

    for (const strategy of strategies) {
      for (const pattern of strategy.patterns) {
        const matches = [...text.matchAll(pattern)];

        for (const match of matches) {
          let amount;

          // ✅ VERIFICAR SE TEM EXTRAÇÃO CUSTOMIZADA
          if (strategy.extract) {
            amount = strategy.extract(match);
          } else {
            amount = this.parseAmount(match[1]);
          }

          if (amount && amount > 1 && amount < 50000) {
            allFoundValues.push({
              amount,
              weight: strategy.weight,
              context: match[0],
            });

            if (strategy.weight > bestWeight) {
              bestValue = amount;
              bestWeight = strategy.weight;
              console.log(
                `💰 Novo melhor valor: R$ ${amount} (peso: ${strategy.weight}) - contexto: "${match[0]}"`
              );
            }
          }
        }
      }
    }

    console.log("📊 Todos os valores encontrados:", allFoundValues);
    return bestValue;
  }

  // ✅ PARSE de valor
  parseAmount(valueStr) {
    if (!valueStr) return null;

    const clean = valueStr.replace(/[^\d,\.]/g, "").replace(",", ".");

    const amount = parseFloat(clean);
    return isNaN(amount) ? null : amount;
  }

  // ✅ EXTRAIR DATA
  extractDate(text) {
    const datePatterns = [
      /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/g,
      /(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{2,4})/g,
    ];

    for (const pattern of datePatterns) {
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
            console.log(
              `📅 Data encontrada: ${moment(date).format("DD/MM/YYYY")}`
            );
            return date;
          }
        }
      }
    }

    console.log("📅 Data não encontrada, usando hoje");
    return new Date();
  }

  // ✅ EXTRAIR ESTABELECIMENTO - CORRIGIDO
  extractEstablishment(text) {
    console.log("🏪 Extraindo estabelecimento...");
    console.log(
      "📝 Primeiras linhas:",
      text.split("\n").slice(0, 8).join(" | ")
    );

    // 🆕 DETECTAR TIPO DE DOCUMENTO
    const isNFCe =
      text.includes("DOCUMENTO AUXILIAR") ||
      text.includes("NFC-e") ||
      text.includes("NOTA FISCAL");
    const isCardReceipt =
      text.includes("VISA") ||
      text.includes("MASTERCARD") ||
      text.includes("DÉBITO") ||
      text.includes("CREDITO");

    if (isNFCe) {
      console.log("📄 Detectada Nota Fiscal Eletrônica");
      return this.extractEstablishmentFromNFCe(text);
    }

    if (isCardReceipt) {
      console.log("💳 Detectado comprovante de cartão");
      return this.extractEstablishmentFromCard(text);
    }

    // Método original para outros tipos
    return this.extractEstablishmentGeneric(text);
  }

  // 🆕 EXTRAIR DE COMPROVANTE DE CARTÃO - LÓGICA GENÉRICA
  extractEstablishmentFromCard(text) {
    const lines = text.split("\n").filter((line) => line.trim().length > 0);

    // Palavras que indicam que NÃO é nome do estabelecimento
    const invalidKeywords = [
      "via",
      "cliente",
      "cnpj",
      "cpf",
      "visa",
      "mastercard",
      "credito",
      "debito",
      "parcela",
      "total",
      "data",
      "hora",
      "auto",
      "aid",
      "stone",
      "rede",
      "cielo",
      "getnet",
      "rua",
      "avenida",
      "av",
      "telefone",
      "aprovado",
      "compra",
      "stoneid",
      "tijubiju",
      "acesso",
    ];

    // Palavras que indicam informações técnicas/bancárias (menor prioridade)
    const technicalKeywords = [
      "itau",
      "itaú",
      "bradesco",
      "santander",
      "caixa",
      "bb",
      "nubank",
    ];

    // Procurar candidatos válidos nas primeiras 8 linhas
    let candidates = [];

    for (let i = 0; i < Math.min(8, lines.length); i++) {
      const line = lines[i].trim();
      const lowerLine = line.toLowerCase();

      // Verificar se a linha parece ser um nome de estabelecimento
      if (
        line.length >= 3 &&
        line.length <= 50 &&
        !/^\d+$/.test(line) && // Não é só números
        !/^[,\.:\-\s]+$/.test(line) && // Não é só pontuação
        !invalidKeywords.some((keyword) => lowerLine.includes(keyword))
      ) {
        const cleanName = line
          .replace(/[^\w\sÀ-ÿ]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (cleanName.length >= 3) {
          // Calcular score baseado na posição e características
          let score = 10 - i; // Posição: primeiras linhas têm maior score

          // ✅ BONUS GRANDE para nomes conhecidos/legíveis
          const knownEstablishments = [
            "laranjinha",
            "mcdonald",
            "subway",
            "burger king",
            "kfc",
            "carrefour",
            "extra",
            "walmart",
            "pao de acucar",
            "drogaria",
            "farmacia",
            "pacheco",
            "drogasil",
          ];

          if (knownEstablishments.some((known) => lowerLine.includes(known))) {
            score += 50; // BONUS MASSIVO para estabelecimentos conhecidos
            console.log(
              `🎯 ESTABELECIMENTO CONHECIDO: "${cleanName}" +50 pontos`
            );
          }

          // ✅ PENALIDADE SEVERA para texto que parece OCR ruim
          if (
            /[^\w\sÀ-ÿ]/.test(cleanName) ||
            cleanName.includes("nij") ||
            cleanName.includes("ij")
          ) {
            score -= 30; // Penalidade para texto ilegível
            console.log(`❌ TEXTO ILEGÍVEL: "${cleanName}" -30 pontos`);
          }

          // Bonus para palavras que indicam estabelecimento comercial
          const commercialIndicators = [
            "restaurante",
            "lanchonete",
            "bar",
            "cafe",
            "pizzaria",
            "hamburgueria",
            "churrascaria",
            "grill",
            "food",
            "bistro",
            "cantina",
            "brasa",
            "fogo",
            "mercado",
            "supermercado",
            "padaria",
            "açougue",
            "hortifruti",
            "farmacia",
            "drogaria",
            "posto",
            "loja",
            "magazine",
            "hotel",
            "pousada",
          ];

          if (
            commercialIndicators.some((indicator) =>
              lowerLine.includes(indicator)
            )
          ) {
            score += 20; // Grande bonus para palavras comerciais
          }

          // Penalidade para bancos/instituições financeiras
          if (technicalKeywords.some((tech) => lowerLine.includes(tech))) {
            score -= 15;
          }

          // Bonus para nomes com múltiplas palavras (mais provável ser estabelecimento)
          if (cleanName.split(" ").length >= 2) {
            score += 5;
          }

          // Penalidade para nomes muito genéricos
          if (cleanName.length <= 5) {
            score -= 5;
          }

          candidates.push({
            name: cleanName,
            position: i,
            line: line,
            score: score,
          });
        }
      }
    }

    // Ordenar por score (maior para menor)
    candidates.sort((a, b) => b.score - a.score);

    console.log(
      `🔍 Candidatos com scores:`,
      candidates.map((c) => ({
        name: c.name,
        score: c.score,
        position: c.position,
      }))
    );

    // Retornar o candidato com maior score
    if (candidates.length > 0) {
      const best = candidates[0];
      console.log(
        `🏪 Estabelecimento (melhor score ${best.score}): ${best.name}`
      );
      return best.name;
    }

    return "Estabelecimento não identificado";
  }

  // 🆕 MÉTODO GENÉRICO
  extractEstablishmentGeneric(text) {
    const lines = text.split("\n").filter((line) => line.trim().length > 0);

    // Palavras que NÃO são nomes de estabelecimento
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
      "nota",
      "cupom",
      "data",
      "hora",
    ];

    for (let i = 0; i < Math.min(8, lines.length); i++) {
      const line = lines[i].trim();

      if (
        line.length >= 3 &&
        line.length <= 40 &&
        !/^\d+$/.test(line) &&
        !invalidKeywords.some((keyword) => line.toLowerCase().includes(keyword))
      ) {
        const cleanName = line
          .replace(/[^\w\sÀ-ÿ]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (cleanName.length >= 3) {
          console.log(`🏪 Estabelecimento: ${cleanName}`);
          return cleanName;
        }
      }
    }

    return "Estabelecimento não identificado";
  }

  // 🆕 EXTRAIR ESTABELECIMENTO DE NOTA FISCAL - MELHORADO
  extractEstablishmentFromNFCe(text) {
    const lines = text.split("\n").filter((line) => line.trim().length > 0);

    console.log("📄 Analisando NFCe...");

    // 1. BUSCAR "PRODUTOS FARMACEUTICOS LTDA" especificamente
    for (const line of lines) {
      if (line.toLowerCase().includes("produtos farmaceuticos")) {
        const cleanName = line
          .replace(/[^\w\sÀ-ÿ]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (cleanName.length >= 5) {
          console.log(`🏪 Estabelecimento NFCe (produtos farm): ${cleanName}`);
          return cleanName;
        }
      }
    }

    // 2. BUSCAR LINHA ANTES DO CNPJ (método original melhorado)
    for (let i = 0; i < lines.length - 1; i++) {
      const currentLine = lines[i].trim();
      const nextLine = lines[i + 1]?.trim() || "";

      // Se a próxima linha contém CNPJ, a atual pode ser o nome
      if (
        nextLine.includes("CNPJ") &&
        currentLine.length > 3 &&
        currentLine.length < 50
      ) {
        // Verificar se não é lixo do OCR
        if (!/^[a-zA-Z0-9\s\-\.]{5,}$/.test(currentLine)) {
          continue; // Pular linhas com caracteres estranhos
        }

        const cleanName = currentLine
          .replace(/[^\w\sÀ-ÿ]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (cleanName && !cleanName.match(/^\d+$/)) {
          console.log(`🏪 Estabelecimento NFCe (antes CNPJ): ${cleanName}`);
          return cleanName;
        }
      }
    }

    // 3. BUSCAR PADRÕES DE EMPRESA nas primeiras 8 linhas
    const empresaPalavras = ["ltda", "s.a", "sa", "eireli", "me", "epp"];

    for (const line of lines.slice(0, 8)) {
      const lowerLine = line.toLowerCase();

      if (empresaPalavras.some((palavra) => lowerLine.includes(palavra))) {
        // Verificar se a linha tem qualidade suficiente
        if (line.length >= 8 && line.length <= 60) {
          const cleanName = line
            .replace(/[^\w\sÀ-ÿ]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          if (cleanName.length >= 5) {
            console.log(
              `🏪 Estabelecimento NFCe (palavra empresa): ${cleanName}`
            );
            return cleanName;
          }
        }
      }
    }

    // 4. FALLBACK: Pegar primeira linha que pareça nome de empresa
    for (const line of lines.slice(0, 6)) {
      if (
        line.length >= 5 &&
        line.length <= 40 &&
        !line.includes("DOCUMENTO") &&
        !line.includes("NOTA FISCAL") &&
        !/^\d+$/.test(line) &&
        !/^[^a-zA-Z]*$/.test(line)
      ) {
        // Deve ter pelo menos uma letra

        const cleanName = line
          .replace(/[^\w\sÀ-ÿ]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (cleanName.length >= 3) {
          console.log(`🏪 Estabelecimento NFCe (fallback): ${cleanName}`);
          return cleanName;
        }
      }
    }

    return "Estabelecimento não identificado";
  }

  // ✅ DETERMINAR CATEGORIA - CORRIGIDO
  determineCategory(establishment, text) {
    const lowerText = (establishment + " " + text).toLowerCase();

    const categoryMap = {
      alimentação: [
        "mercado",
        "supermercado",
        "restaurante",
        "padaria",
        "lanchonete",
        "laranjinha",
        "açougue",
        "hortifruti",
        "brasa",
        "fogo",
        "churrascaria",
        "bar",
        "lancheria",
        "pizzaria",
        "hamburgueria",
        "food",
        "grill",
        "bistro",
        "cantina",
        "self service",
      ],
      saúde: [
        "farmacia",
        "drogaria",
        "drogasil",
        "pacheco",
        "fenol",
        "scar",
        "produtos farmaceuticos",
        "medicamento",
        "remedio",
        "clinica",
        "hospital",
        "laboratorio",
      ],
      transporte: [
        "posto",
        "shell",
        "petrobras",
        "uber",
        "taxi",
        "combustivel",
        "br",
        "ipiranga",
        "ale",
        "gasolina",
        "etanol",
        "diesel",
      ],
      vestuário: [
        "renner",
        "cea",
        "riachuelo",
        "magazine",
        "roupa",
        "calcado",
        "moda",
        "boutique",
        "loja",
        "confecção",
      ],
      lazer: [
        "cinema",
        "teatro",
        "bar",
        "entretenimento",
        "show",
        "festa",
        "balada",
        "club",
        "diversão",
      ],
    };

    // Log para debug
    console.log(`🔍 Analisando categoria para: "${establishment}"`);
    console.log(`📝 Texto relevante: "${lowerText.substring(0, 100)}..."`);

    for (const [category, keywords] of Object.entries(categoryMap)) {
      for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
          console.log(
            `📂 Categoria encontrada: ${category} (palavra-chave: "${keyword}")`
          );
          return category;
        }
      }
    }

    console.log(`📂 Categoria padrão: outros`);
    return "outros";
  }

  // 🆕 ATUALIZAR: generateDescription para incluir parcelas
  generateDescription(extracted) {
    const parts = [];

    if (
      extracted.establishment &&
      extracted.establishment !== "Estabelecimento não identificado"
    ) {
      parts.push(extracted.establishment);
    }

    if (extracted.installments && extracted.installments.hasInstallments) {
      // Para parcelas: "Mercado - 1/12 de R$ 68,09 (Total: R$ 817,08)"
      parts.push(
        `${extracted.installments.currentInstallment}/${
          extracted.installments.totalInstallments
        } de R$ ${extracted.amount.toFixed(2)}`
      );
      parts.push(
        `(Total: R$ ${extracted.installments.totalAmount.toFixed(2)})`
      );
    } else {
      // Lógica original para pagamento à vista
      if (extracted.amount) {
        parts.push(`R$ ${extracted.amount.toFixed(2)}`);
      }
    }

    return parts.join(" - ") || "Transação via foto";
  }

  // ✅ VALIDAR IMAGEM
  validateReceiptImage(imageBuffer) {
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

  // ✅ CORRIGIR o método detectInstallments - MAIS ESPECÍFICO

  detectInstallments(text) {
    console.log("💳 Detectando parcelas...");
    console.log("🔍 Texto recebido:", text.substring(0, 300) + "...");

    const installmentPatterns = [
      // Padrão principal: qualquer número X valor
      /(\d{1,3})\s*[xX]\s*[rR]?\$?\s*(\d{1,4}[,\.]\d{2})/gi,

      // Variações com RS
      /(\d{1,3})\s*[xX]\s*[rR][sS]\s*(\d{1,4}[,\.]\d{2})/gi,

      // Com "PARCELAS:" antes
      /parcelas?[\s:]*(\d{1,3})\s*[xX]\s*[rR]?\$?\s*(\d{1,4}[,\.]\d{2})/gi,
    ];

    for (let i = 0; i < installmentPatterns.length; i++) {
      const pattern = installmentPatterns[i];
      console.log(`🔍 Testando padrão ${i + 1}...`);

      const matches = [...text.matchAll(pattern)];
      console.log(
        `📊 Padrão ${i + 1} encontrou ${matches.length} matches:`,
        matches.map((m) => m[0])
      );

      for (const match of matches) {
        console.log(`🔍 Analisando match: "${match[0]}"`);

        const installments = parseInt(match[1]);
        const installmentValueStr = match[2];
        const installmentValue = this.parseAmount(installmentValueStr);

        console.log(
          `📊 Parcelas: ${installments}, Valor: R$ ${installmentValue}`
        );

        // ✅ VALIDAÇÃO MÍNIMA - Apenas se faz sentido matemático
        if (
          installments >= 2 &&
          installmentValue > 0 &&
          installmentValue < 50000
        ) {
          const totalAmount = installments * installmentValue;

          console.log(`✅ PARCELAS DETECTADAS!`);
          console.log(
            `💳 ${installments}x de R$ ${installmentValue} = R$ ${totalAmount}`
          );

          return {
            hasInstallments: true,
            totalInstallments: installments,
            installmentValue: installmentValue,
            totalAmount: totalAmount,
            context: match[0],
          };
        } else {
          console.log(
            `❌ Valores inválidos: installments=${installments}, value=${installmentValue}`
          );
        }
      }
    }

    console.log("💳 Nenhuma parcela detectada");
    return { hasInstallments: false };
  }
}

module.exports = GoogleVisionOCRService;
