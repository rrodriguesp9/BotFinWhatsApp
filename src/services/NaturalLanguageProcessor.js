const nlp = require("compromise");
const moment = require("moment");

class NaturalLanguageProcessor {
  constructor() {
    // Configurar compromise para português
    nlp.extend(require("compromise-numbers"));
    // nlp.extend(require('compromise-dates')); // Comentado temporariamente
  }

  // ✅ MÉTODO PRINCIPAL melhorado
  processMessage(message) {
    const text = message.toLowerCase().trim();
    console.log("🧠 Processando texto:", text);

    // Normalizar texto
    const normalizedText = this.normalizeText(text);

    // Detectar intenção principal
    const intention = this.detectIntention(normalizedText);

    // Extrair dados específicos baseado na intenção
    let extracted = {};

    switch (intention) {
      case "expense":
        extracted = this.extractExpenseData(normalizedText);
        break;
      case "income":
        extracted = this.extractIncomeData(normalizedText);
        break;
      case "balance":
        extracted = this.extractBalanceQuery(normalizedText);
        break;
      case "report":
        extracted = this.extractReportQuery(normalizedText);
        break;
      case "goal":
        extracted = this.extractGoalData(normalizedText);
        break;
      default:
        extracted = this.extractGenericData(normalizedText);
    }

    const confidence = this.calculateConfidence(intention, extracted);

    return {
      intention,
      originalText: message,
      confidence,
      extracted: {
        type: intention === "income" ? "income" : "expense",
        ...extracted,
      },
    };
  }

  // ✅ NORMALIZAR texto para melhor processamento
  normalizeText(text) {
    return text
      .replace(/\b(reais?|real|brl)\b/gi, "reais")
      .replace(/\b(r\$|rs)\b/gi, "reais")
      .replace(/\b(comprei|paguei|pago|gastei|gasto|despesa)\b/gi, "gastei")
      .replace(/\b(recebi|receita|ganho|ganhei|salario|salário)\b/gi, "recebi")
      .replace(/\b(mercado|supermercado|super)\b/gi, "mercado")
      .replace(/\b(farmacia|farmácia|drogaria)\b/gi, "farmacia")
      .replace(
        /\b(posto|gasolina|combustivel|combustível|alcool|álcool)\b/gi,
        "posto"
      )
      .replace(/\b(conta de luz|energia|light|cemig)\b/gi, "conta_luz")
      .replace(/\b(conta de agua|água|saneamento)\b/gi, "conta_agua")
      .replace(/\b(telefone|celular|tim|vivo|claro|oi)\b/gi, "telefone");
  }

  // ✅ DETECTAR intenção principal
  detectIntention(text) {
    // Padrões de despesa
    const expensePatterns = [
      /\b(gastei|comprei|paguei|pago|despesa)\b/gi,
      /\b(no mercado|na farmacia|no posto|na loja)\b/gi,
      /\b(conta de|pagar|pagamento)\b/gi,
    ];

    // Padrões de receita
    const incomePatterns = [
      /\b(recebi|receita|ganho|ganhei|salario|salário)\b/gi,
      /\b(do trabalho|do emprego|freelance|extra)\b/gi,
    ];

    // Padrões de consulta de saldo
    const balancePatterns = [
      /\b(saldo|quanto tenho|dinheiro|disponivel|disponível)\b/gi,
      /\b(meu saldo|saldo atual)\b/gi,
    ];

    // Padrões de relatório
    const reportPatterns = [
      /\b(gastos|resumo|relatorio|relatório|extrato)\b/gi,
      /\b(semana|mes|mês|hoje|ontem)\b/gi,
      /\b(por categoria|categorias)\b/gi,
    ];

    // Padrões de meta
    const goalPatterns = [
      /\b(meta|limite|orçamento|orcamento)\b/gi,
      /\b(meta de|limite de|orcamento de|orçamento de)\b/gi,
    ];

    // Verificar padrões na ordem de prioridade
    if (expensePatterns.some((pattern) => pattern.test(text))) {
      return "expense";
    }
    if (incomePatterns.some((pattern) => pattern.test(text))) {
      return "income";
    }
    if (balancePatterns.some((pattern) => pattern.test(text))) {
      return "balance";
    }
    if (reportPatterns.some((pattern) => pattern.test(text))) {
      return "report";
    }
    if (goalPatterns.some((pattern) => pattern.test(text))) {
      return "goal";
    }

    return "unknown";
  }

  // ✅ EXTRAIR dados de despesa com múltiplos padrões
  extractExpenseData(text) {
    const extracted = {
      amount: null,
      category: "outros",
      description: text,
      date: new Date(),
      establishment: null,
    };

    // === EXTRAIR VALOR ===
    const valuePatterns = [
      // "gastei 50", "paguei 100 reais"
      /(?:gastei|paguei|pago|comprei)\s+(\d{1,4}(?:[,\.]\d{1,2})?)\s*(?:reais?|real|r\$|brl)?/gi,
      // "50 reais no mercado"
      /(\d{1,4}(?:[,\.]\d{1,2})?)\s*(?:reais?|real|r\$|brl)?\s+(?:no|na|do|da|em)/gi,
      // "R$ 50", "rs 25"
      /(?:r\$|rs)\s*(\d{1,4}(?:[,\.]\d{1,2})?)/gi,
      // Números isolados (menor prioridade)
      /(\d{1,4}(?:[,\.]\d{1,2})?)/g,
    ];

    for (const pattern of valuePatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        const amount = this.parseAmount(match[1]);
        if (amount && amount > 0 && amount < 50000) {
          extracted.amount = amount;
          console.log(`💰 Valor encontrado: R$ ${amount}`);
          break;
        }
      }
      if (extracted.amount) break;
    }

    // === EXTRAIR ESTABELECIMENTO ===
    const establishmentPatterns = [
      // "no mercado", "na farmacia"
      /(?:no|na|do|da)\s+([a-záàâãçéêíóôõú\s]+?)(?:\s|$|,|\.|!|\?)/gi,
      // "mercado extra", "farmacia pacheco"
      /(?:gastei|comprei|paguei).*?(?:no|na|do|da)\s+([a-záàâãçéêíóôõú\s]+?)(?:\s|$|,|\.|!|\?)/gi,
      // Estabelecimentos diretos "mercado", "farmacia"
      /\b(mercado|farmacia|posto|padaria|restaurante|lanchonete|cinema|teatro)\b/gi,
    ];

    for (const pattern of establishmentPatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        let establishment = match[1] ? match[1].trim() : match[0].trim();
        establishment = establishment
          .replace(/\b(de|da|do|na|no|com|para|e|a|o|reais?|real)\b/gi, "")
          .trim();

        if (establishment.length >= 3) {
          extracted.establishment = this.capitalizeFirst(establishment);
          console.log(`🏪 Estabelecimento: ${extracted.establishment}`);
          break;
        }
      }
      if (extracted.establishment) break;
    }

    // === DETERMINAR CATEGORIA ===
    extracted.category = this.determineAdvancedCategory(
      extracted.establishment,
      text
    );

    // === GERAR DESCRIÇÃO ===
    extracted.description = this.generateDescription(extracted, text);

    return extracted;
  }

  // ✅ EXTRAIR dados de receita
  extractIncomeData(text) {
    const extracted = {
      amount: null,
      category: "receita",
      description: text,
      date: new Date(),
      source: null,
    };

    // Extrair valor (mesma lógica)
    const valuePatterns = [
      /(?:recebi|ganhei|receita)\s+(\d{1,4}(?:[,\.]\d{1,2})?)\s*(?:reais?|real|r\$|brl)?/gi,
      /(\d{1,4}(?:[,\.]\d{1,2})?)\s*(?:reais?|real|r\$|brl)?\s+(?:do|da|de)/gi,
      /(?:r\$|rs)\s*(\d{1,4}(?:[,\.]\d{1,2})?)/gi,
    ];

    for (const pattern of valuePatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        const amount = this.parseAmount(match[1]);
        if (amount && amount > 0) {
          extracted.amount = amount;
          break;
        }
      }
      if (extracted.amount) break;
    }

    // Extrair fonte
    const sourcePatterns = [
      /(?:do|da|de)\s+([a-záàâãçéêíóôõú\s]+?)(?:\s|$|,|\.|!|\?)/gi,
      /\b(salario|salário|trabalho|emprego|freelance|extra|bonus|bônus)\b/gi,
    ];

    for (const pattern of sourcePatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        let source = match[1] ? match[1].trim() : match[0].trim();
        if (source.length >= 3) {
          extracted.source = this.capitalizeFirst(source);
          break;
        }
      }
      if (extracted.source) break;
    }

    extracted.description = `Receita: ${extracted.source || "Valor recebido"}`;

    return extracted;
  }

  // ✅ EXTRAIR consulta de saldo
  extractBalanceQuery(text) {
    return {
      type: "balance_query",
      period: "current",
    };
  }

  // ✅ EXTRAIR consulta de relatório
  extractReportQuery(text) {
    let period = "month"; // padrão

    if (/\b(hoje|today)\b/gi.test(text)) period = "today";
    else if (/\b(ontem|yesterday)\b/gi.test(text)) period = "yesterday";
    else if (/\b(semana|week)\b/gi.test(text)) period = "week";
    else if (/\b(mes|mês|month)\b/gi.test(text)) period = "month";
    else if (/\b(ano|year)\b/gi.test(text)) period = "year";

    return {
      type: "report",
      period: period,
    };
  }

  // ✅ EXTRAIR dados de meta
  extractGoalData(text) {
    const extracted = {
      category: "outros",
      limit: null,
      period: "month",
    };

    // Extrair valor da meta
    const limitPatterns = [
      /(?:meta|limite|orcamento|orçamento).*?(\d{1,4}(?:[,\.]\d{1,2})?)/gi,
      /(\d{1,4}(?:[,\.]\d{1,2})?)\s*(?:reais?|real|r\$|brl)?.*?(?:meta|limite)/gi,
    ];

    for (const pattern of limitPatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        const limit = this.parseAmount(match[1]);
        if (limit && limit > 0) {
          extracted.limit = limit;
          break;
        }
      }
      if (extracted.limit) break;
    }

    // Extrair categoria da meta
    const categoryPatterns = [
      /(?:meta|limite).*?(?:de|do|da|para)\s+([a-záàâãçéêíóôõú]+)/gi,
      /([a-záàâãçéêíóôõú]+).*?(?:meta|limite)/gi,
    ];

    for (const pattern of categoryPatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        const category = match[1].trim();
        if (category.length >= 3) {
          extracted.category = this.mapToStandardCategory(category);
          break;
        }
      }
      if (extracted.category !== "outros") break;
    }

    return extracted;
  }

  // ✅ VERSÃO MELHORADA - Word boundary para TODAS as palavras

  determineAdvancedCategory(establishment, text) {
    const lowerText = (establishment + " " + text).toLowerCase();

    // Mapeamento expandido
    const categoryMap = {
      // VESTUÁRIO (prioridade alta)
      vestuário: [
        "roupa",
        "sapato",
        "tênis",
        "tenis",
        "loja",
        "shopping",
        "renner",
        "cea",
        "riachuelo",
        "zara",
        "hm",
        "magazine luiza",
        "c&a",
        "shein",
        "nike",
        "adidas",
        "puma",
        "hering",
        "farm",
      ],

      // ALIMENTAÇÃO
      alimentação: [
        // Fast food
        "mc",
        "mcdonald",
        "mcdonalds",
        "mc donald",
        "mc donalds",
        "burger",
        "burguer",
        "burger king",
        "bk",
        "kfc",
        "subway",
        "pizza",
        "pizzaria",

        // Supermercados
        "mercado",
        "supermercado",
        "super",
        "carrefour",
        "extra",
        "pão de açúcar",

        // Restaurantes
        "restaurante",
        "lanchonete",
        "padaria",
        "bar",
        "cafeteria",
        "ifood",
        "uber eats",
        "delivery",

        // Outros
        "açougue",
        "feira",
        "hortifruti",
        "comida",
        "almoço",
        "jantar",
        "lanche",
      ],

      // SAÚDE
      saúde: [
        "farmacia",
        "farmácia",
        "drogaria",
        "drogasil",
        "pacheco",
        "raia",
        "médico",
        "medico",
        "hospital",
        "remédio",
        "remedio",
        "consulta",
        "exame",
        "dentista",
        "oftalmologista",
        "laboratório",
        "clínica",
      ],

      // TRANSPORTE
      transporte: [
        "posto",
        "gasolina",
        "combustivel",
        "combustível",
        "alcool",
        "álcool",
        "shell",
        "petrobras",
        "ipiranga",
        "ale",
        "uber",
        "taxi",
        "99",
        "ônibus",
        "onibus",
        "metrô",
        "metro",
        "estacionamento",
        "pedágio",
        "pedagio",
        "oficina",
        "mecânico",
      ],

      // CONTAS/UTILIDADES
      contas: [
        "luz",
        "energia",
        "cemig",
        "light",
        "conta de luz",
        "agua",
        "água",
        "saneamento",
        "sabesp",
        "conta de agua",
        "gas",
        "gás",
        "comgas",
        "conta de gas",
        "telefone",
        "celular",
        "tim",
        "vivo",
        "claro",
        "oi",
        "internet",
        "netflix",
        "spotify",
        "amazon prime",
        "streaming",
        "iptu",
        "condominio",
        "condomínio",
        "seguro",
      ],

      // LAZER
      lazer: [
        "cinema",
        "teatro",
        "show",
        "festa",
        "viagem",
        "hotel",
        "pousada",
        "parque",
        "clube",
        "academia",
        "esporte",
      ],

      // CASA
      casa: [
        "construção",
        "tinta",
        "ferramenta",
        "móveis",
        "decoração",
        "jardim",
        "limpeza",
        "manutenção",
      ],

      // EDUCAÇÃO
      educação: [
        "escola",
        "curso",
        "livro",
        "material",
        "faculdade",
        "universidade",
        "aula",
        "professor",
      ],
    };

    // ✅ VERIFICAÇÃO COM WORD BOUNDARY PARA TODAS AS PALAVRAS
    for (const [category, keywords] of Object.entries(categoryMap)) {
      for (const keyword of keywords) {
        // ✅ Usar word boundary para TODAS as palavras
        // Isso evita matches parciais como "gas" em "gastei"
        const wordBoundaryRegex = new RegExp(
          `\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "i"
        );

        if (wordBoundaryRegex.test(lowerText)) {
          console.log(`📂 Categoria: ${category} (palavra-chave: ${keyword})`);
          return category;
        }
      }
    }

    // ✅ FALLBACK: Para frases compostas que não funcionam com word boundary
    const phrasePatterns = [
      { phrase: "mc donald", category: "alimentação" },
      { phrase: "mc donalds", category: "alimentação" },
      { phrase: "burger king", category: "alimentação" },
      { phrase: "uber eats", category: "alimentação" },
      { phrase: "conta de luz", category: "contas" },
      { phrase: "conta de agua", category: "contas" },
      { phrase: "conta de gas", category: "contas" },
      { phrase: "amazon prime", category: "contas" },
    ];

    for (const pattern of phrasePatterns) {
      if (lowerText.includes(pattern.phrase)) {
        console.log(
          `📂 Categoria: ${pattern.category} (frase: ${pattern.phrase})`
        );
        return pattern.category;
      }
    }

    console.log('📂 Categoria não identificada, usando "outros"');
    return "outros";
  }

  // ✅ MAPEAR categoria do texto para padrão
  mapToStandardCategory(category) {
    const mapping = {
      mercado: "alimentação",
      farmacia: "saúde",
      posto: "transporte",
      roupa: "vestuário",
      casa: "casa",
      conta: "contas",
      luz: "contas",
      agua: "contas",
      telefone: "contas",
    };

    return mapping[category.toLowerCase()] || "outros";
  }

  // ✅ PARSE valor mais robusto
  parseAmount(valueStr) {
    if (!valueStr) return null;

    const clean = valueStr.replace(/[^\d,\.]/g, "").replace(",", ".");

    const amount = parseFloat(clean);
    return isNaN(amount) ? null : amount;
  }

  // ✅ CAPITALIZAR primeira letra
  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  // ✅ GERAR descrição inteligente
  generateDescription(extracted, originalText) {
    const parts = [];

    if (extracted.establishment) {
      parts.push(extracted.establishment);
    }

    if (extracted.amount) {
      parts.push(`R$ ${extracted.amount.toFixed(2)}`);
    }

    if (extracted.category !== "outros") {
      parts.push(`(${extracted.category})`);
    }

    return parts.length > 0 ? parts.join(" - ") : originalText;
  }

  // ✅ CALCULAR confiança
  calculateConfidence(intention, extracted) {
    let confidence = 0.3; // base

    if (intention !== "unknown") confidence += 0.3;
    if (extracted.amount && extracted.amount > 0) confidence += 0.3;
    if (extracted.establishment || extracted.source) confidence += 0.1;

    return Math.min(0.9, confidence);
  }

  // ✅ EXTRAIR dados genéricos
  extractGenericData(text) {
    return {
      type: "unknown",
      amount: null,
      date: new Date(),
      category: "outros",
      description: text,
    };
  }

  // ✅ GERAR mensagem de ajuda
  generateHelpMessage() {
    return (
      `🤖 **COMANDOS DISPONÍVEIS**\n\n` +
      `💸 **DESPESAS:**\n` +
      `• "Gastei 50 no mercado"\n` +
      `• "Paguei 150 de conta de luz"\n` +
      `• "Comprei 25 na farmácia"\n\n` +
      `💵 **RECEITAS:**\n` +
      `• "Recebi 2500 do salário"\n` +
      `• "Ganhei 300 de freelance"\n\n` +
      `📊 **CONSULTAS:**\n` +
      `• "Saldo" ou "Quanto tenho?"\n` +
      `• "Gastos da semana"\n` +
      `• "Resumo do mês"\n\n` +
      `🎯 **METAS:**\n` +
      `• "Meta de mercado 600"\n` +
      `• "Limite de transporte 200"\n\n` +
      `📷 **Envie foto** do recibo para extração automática!`
    );
  }
}

module.exports = NaturalLanguageProcessor;
