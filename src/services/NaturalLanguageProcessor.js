const moment = require('moment');

class NaturalLanguageProcessor {
  constructor() {
    // NLP baseado em regex otimizado para português brasileiro
  }

  // Expandir abreviações comuns antes de processar
  expandAbbreviations(text) {
    const abbreviations = {
      'gst': 'gastei', 'pag': 'pagamento', 'pgto': 'pagamento',
      'rcb': 'recebi', 'rcbi': 'recebi', 'dep': 'depósito',
      'qto': 'quanto', 'qnt': 'quanto', 'hj': 'hoje',
      'sal': 'saldo', 'rel': 'relatório', 'obj': 'objetivo',
      'merc': 'mercado', 'sup': 'supermercado', 'rest': 'restaurante',
      'farm': 'farmácia', 'transp': 'transporte'
    };

    // Usar lookahead para não substituir dentro de palavras com acentos
    const letterAfter = '[a-záàâãéèêíïóôõöúçñ]';
    let expanded = text;
    for (const [abbr, full] of Object.entries(abbreviations)) {
      expanded = expanded.replace(new RegExp(`\\b${abbr}(?!${letterAfter})`, 'gi'), full);
    }
    return expanded;
  }

  // Processar mensagem e extrair intenção
  processMessage(message) {
    const raw = message.toLowerCase().trim();
    const expanded = this.expandAbbreviations(raw);
    // Normalizar "viagem, 5000" → "viagem 5000" (vírgula entre texto e número)
    const text = expanded.replace(/,\s+(?=\d)/g, ' ');

    // Padrões de regex para diferentes tipos de comandos
    // IMPORTANTE: a ordem define prioridade. Padrões mais específicos primeiro.
    const patterns = {
      // Saudações (primeiro para respostas rápidas)
      greeting: [
        /^(oi|olá|ola|hey|eai|e\s*ai|fala|salve|bom\s*dia|boa\s*tarde|boa\s*noite|hello|hi|opa|eae|blz|beleza|tudo\s*bem)(\s|$|[!?,.])/i
      ],

      // Ajuda (antes dos demais para evitar conflitos com "como")
      help: [
        /(?:ajuda|help|comandos|como\s+(?:usar|funciona)|o\s+que\s+posso)/i
      ],

      // Gerenciamento de PIN
      pin: [
        /(?:alterar|mudar|trocar|modificar)\s+(?:o?\s*)?(?:pin|senha)/i,
        /(?:resetar|redefinir|esqueci)\s+(?:o?\s*)?(?:pin|senha)/i,
        /(?:criar|definir|configurar)\s+(?:o?\s*)?(?:pin|senha)/i,
        /(?:meu\s+)?pin$/i
      ],

      // Modo silencioso
      silent: [
        /(?:pausar|silenciar|silêncio)\s+(?:notificações?|alertas?)\s+(?:por\s+)?(\d+)\s+(?:dias?|dia)/i,
        /(?:modo\s+)?(?:silencioso|silêncio)\s+(?:por\s+)?(\d+)\s+(?:dias?|dia)/i
      ],

      // Exportação
      export: [
        /(?:exportar|exporte|baixar|download)\s+(?:relatório|dados|este|esse)?\s*(?:mês|semana)?\s*(?:em|para)\s+(pdf|csv|excel)/i,
        /(?:exporte|baixar)\s+(?:este\s+)?(?:mês|semana)\s+(?:em|para)\s+(pdf|csv|excel)/i,
        /(?:exportar|exporte|baixar|download)\s+(?:em\s+)?(pdf|csv|excel)/i
      ],

      // Divisão de despesas
      split: [
        /(?:dividir|dividido)\s+([a-záàâãéèêíïóôõöúçñ]+)\s+(?:de\s+)?([\d.,]+)\s+(?:entre|por)\s+(\d+)/i,
        /([\d.,]+)\s+(?:dividido|dividir)\s+(?:entre|por)\s+(\d+)/i
      ],

      // Metas (antes de expense para "meta de mercado 600" não casar com expense)
      goal: [
        /(?:meta|limite)\s+(?:de\s+)?([a-záàâãéèêíïóôõöúçñ]+)\s+([\d.,]+)/i,
        /(?:definir|criar)\s+(?:meta|limite)\s+(?:de\s+)?([a-záàâãéèêíïóôõöúçñ]+)\s+([\d.,]+)/i
      ],

      // Cofrinhos (antes de expense para "cofrinho viagem 2000" não confundir)
      savings: [
        // Adicionar/aplicar: "adicionar 100 ao cofrinho viagem" ou "aplicar 500 no cofrinho" (nome opcional)
        /(?:adicionar|depositar|colocar|guardar|aplicar)\s+([\d.,]+[kK]?)\s+(?:no|ao|pro)\s+(?:cofrinho)(?:\s+(.+))?/i,
        // Retirar/resgatar: "retirar 50 do cofrinho viagem" ou "resgatar 2k do cofrinho" (nome opcional)
        /(?:retirar|tirar|sacar|pegar|resgatar)\s+([\d.,]+[kK]?)\s+(?:do|no)\s+(?:cofrinho)(?:\s+(.+))?/i,
        // Listar: "meus cofrinhos", "listar cofrinhos", "ver cofrinhos"
        /(?:meus?\s+)?cofrinhos$/i,
        /(?:listar|ver)\s+cofrinhos/i,
        // Ver específico: "ver cofrinho viagem", "status do cofrinho ferias"
        /(?:ver|status|detalhe)\s+(?:do\s+)?cofrinho\s+(.+)/i,
        // Criar: "cofrinho viagem 2000", "criar cofrinho ferias 5000"
        /(?:cofrinho|objetivo|guardar\s+para|poupar\s+para)\s+(?:para\s+)?([a-záàâãéèêíïóôõöúçñ\s]+?)\s+([\d.,]+[kK]?)/i,
        /(?:criar\s+)?(?:cofrinho|objetivo)\s+([a-záàâãéèêíïóôõöúçñ\s]+?)\s+([\d.,]+[kK]?)/i,
        // Criar sem params: "criar cofrinho", "cofrinho" (mostra ajuda)
        /^(?:criar\s+)?cofrinho$/i
      ],

      // Calendário / Agenda Google
      calendar: [
        /(?:conectar|ligar|vincular|ativar)\s+(?:o?\s*)?(?:calendário|calendar|agenda|google)/i,
        /(?:desconectar|remover|desativar|desvincular)\s+(?:o?\s*)?(?:calendário|calendar|agenda|google)/i,
        /(?:meu\s+)?(?:calendário|calendar|agenda)\s*$/i,
        /(?:status|ver)\s+(?:do?\s*)?(?:calendário|calendar|agenda)/i
      ],

      // Consulta por categoria: "quanto gastei em mercado?", "detalhes de outros", "gastos com transporte"
      category_query: [
        /(?:quanto\s+)?(?:gastei|gasto|despesas?)\s+(?:em|no|na|de|com)\s+([a-záàâãéèêíïóôõöúçñ\s]+)/i,
        /(?:detalh(?:es?|ar)|itens?|o\s+que\s+(?:tem|compõe))\s+(?:de|do|da|em|no|na)\s+(?:categoria\s+)?([a-záàâãéèêíïóôõöúçñ\s]+)/i,
        /(?:ver|mostrar|listar)\s+(?:gastos?|despesas?)\s+(?:de|do|da|em|no|na|com)\s+([a-záàâãéèêíïóôõöúçñ\s]+)/i
      ],

      // Consultas de saldo
      balance: [
        /(?:quanto|saldo|tenho|disponível|dinheiro)\s+(?:tenho|agora|disponível)?/i,
        /(?:meu\s+)?saldo/i,
        /(?:quanto\s+)?(?:dinheiro|valor)\s+(?:tenho|disponível)/i
      ],

      // Relatórios
      report: [
        /(?:resumo|relatório|extrato)\s+(?:da\s+)?(?:semana|mês|mês\s+passado)/i,
        /(?:gastos?|despesas?)\s+(?:da\s+)?(?:semana|mês)/i,
        /(?:relatório|resumo)\s+(?:deste|do)\s+(?:mês|semana)/i
      ],

      // Receitas
      income: [
        /(?:recebi|ganhei|entrou|depositei|salário|freela|pagamento)\s+(?:de\s+)?r?\$?\s*([\d.,]+\s*[kK]?)/i,
        /(?:recebi|ganhei|entrou|depositei)\s+([\d.,]+\s*[kK]?)\s+(?:reais?|r\$)/i,
        /(?:salário|freela|pagamento)\s+(?:de\s+)?([\d.,]+\s*[kK]?)/i,
        /(?:receb[ei]|caiu|entrou)\s+(?:um\s+)?(?:pix|transferência)\s+(?:de\s+)?r?\$?\s*([\d.,]+\s*[kK]?)/i
      ],

      // Despesas (por último entre os financeiros)
      expense: [
        /(?:gastei|paguei|comprei|compras?|conta|boleto)\s+(?:de\s+)?r?\$?\s*([\d.,]+\s*[kK]?)/i,
        /(?:gastei|paguei|comprei)\s+([\d.,]+\s*[kK]?)\s+(?:reais?|r\$)/i,
        /(?:fiz|mandei|enviei)\s+(?:um\s+)?(?:pix|transferência)\s+(?:de\s+)?r?\$?\s*([\d.,]+\s*[kK]?)/i,
        /(?:transferi|pix)\s+(?:de\s+)?r?\$?\s*([\d.,]+\s*[kK]?)/i,
        /(?:conta|boleto)\s+(?:de\s+)?([\d.,]+\s*[kK]?)/i,
        /(?:uber|99|taxi|ônibus|metrô|transporte)\s+([\d.,]+\s*[kK]?)/i,
        /(?:almoço|jantar|café|lanche|restaurante)\s+([\d.,]+\s*[kK]?)/i,
        /(?:mercado|supermercado|feira)\s+([\d.,]+\s*[kK]?)/i
      ]
    };

    // Testar cada padrão
    for (const [intention, patternList] of Object.entries(patterns)) {
      for (const pattern of patternList) {
        const match = text.match(pattern);
        if (match) {
          return this.extractIntent(intention, match, text);
        }
      }
    }

    // Se não encontrou padrão específico, tentar extração genérica
    return this.extractGenericIntent(text);
  }

  // Extrair intenção específica
  extractIntent(intention, match, originalText) {
    const extracted = {
      intention,
      originalText,
      confidence: 0.9,
      extracted: {}
    };

    switch (intention) {
      case 'income':
        extracted.extracted = {
          type: 'income',
          amount: this.extractAmount(match[1]),
          category: this.extractCategory(originalText),
          description: this.extractDescription(originalText),
          date: this.extractDate(originalText)
        };
        break;

      case 'expense':
        extracted.extracted = {
          type: 'expense',
          amount: this.extractAmount(match[1]),
          category: this.extractCategory(originalText),
          description: this.extractDescription(originalText),
          date: this.extractDate(originalText)
        };
        break;

      case 'category_query':
        extracted.extracted = {
          type: 'category_query',
          category: this.normalizeCategoryName(match[1]?.trim()),
          rawCategory: match[1]?.trim(),
          period: this.extractPeriod(originalText)
        };
        break;

      case 'balance':
        extracted.extracted = {
          type: 'query',
          query: 'balance'
        };
        break;

      case 'report':
        extracted.extracted = {
          type: 'query',
          query: 'report',
          period: this.extractPeriod(originalText)
        };
        break;

      case 'goal':
        extracted.extracted = {
          type: 'goal',
          category: match[1],
          limit: this.extractAmount(match[2])
        };
        break;

      case 'savings':
        extracted.extracted = this.extractSavingsAction(match, originalText);
        break;

      case 'calendar':
        extracted.extracted = {
          type: 'calendar',
          action: /desconectar|remover|desativar|desvincular/i.test(originalText) ? 'disconnect' :
                  /(?:meu|status|ver)\s/i.test(originalText) || /calendário$|calendar$|agenda$/i.test(originalText) ? 'status' : 'connect'
        };
        break;

      case 'split':
        extracted.extracted = {
          type: 'split',
          description: match[1] || 'despesa dividida',
          totalAmount: this.extractAmount(match[2] || match[1]),
          people: parseInt(match[3] || match[2])
        };
        break;

      case 'export':
        extracted.extracted = {
          type: 'export',
          format: match[1],
          period: this.extractPeriod(originalText)
        };
        break;

      case 'help':
        extracted.extracted = {
          type: 'help'
        };
        break;

      case 'pin':
        extracted.extracted = {
          type: 'pin',
          action: /resetar|redefinir|esqueci/i.test(originalText) ? 'reset' :
                  /alterar|mudar|trocar|modificar/i.test(originalText) ? 'change' :
                  /criar|definir|configurar/i.test(originalText) ? 'create' : 'info'
        };
        break;

      case 'silent':
        extracted.extracted = {
          type: 'silent',
          days: parseInt(match[1])
        };
        break;

      case 'greeting':
        extracted.extracted = {
          type: 'greeting'
        };
        extracted.confidence = 0.95;
        break;
    }

    return extracted;
  }

  // Extrair intenção genérica (fallback)
  extractGenericIntent(text) {
    // Extrair números do texto
    const numberMatch = text.match(/(\d+[.,]?\d*)/);
    const amount = numberMatch ? parseFloat(numberMatch[1].replace(',', '.')) : null;

    // Extrair data do texto
    const date = this.extractDate(text);

    // Detectar palavras-chave
    const keywords = {
      income: ['recebi', 'ganhei', 'entrou', 'salário', 'salario', 'freela', 'pagamento', 'caiu'],
      expense: ['gastei', 'paguei', 'comprei', 'conta', 'boleto', 'uber', 'mercado', 'pix', 'transferi', 'transferência', 'mandei', 'enviei'],
      balance: ['quanto', 'saldo', 'tenho', 'disponível', 'disponivel'],
      report: ['resumo', 'relatório', 'relatorio', 'extrato']
    };

    let detectedType = 'unknown';
    for (const [type, words] of Object.entries(keywords)) {
      if (words.some(word => text.includes(word))) {
        detectedType = type;
        break;
      }
    }

    return {
      intention: detectedType,
      originalText: text,
      confidence: 0.3,
      extracted: {
        type: detectedType,
        amount,
        date,
        category: this.extractCategory(text),
        description: this.extractDescription(text)
      }
    };
  }

  // Extrair valor monetário (suporta K: 2k=2000, 1.5k=1500, "15 mil"=15000)
  extractAmount(text) {
    if (!text) return null;

    const trimmed = text.trim();

    // Verificar multiplicadores: K ou "mil"
    const hasK = /[kK]\s*$/.test(trimmed);
    const hasMil = /\s*mil\s*$/i.test(trimmed);

    // Remover "R$", "reais", "k", "mil", etc.
    const cleanText = trimmed
      .replace(/r?\$?\s*/gi, '')
      .replace(/\s*(?:reais?|r\$)/gi, '')
      .replace(/\s*[kK]\s*$/g, '')
      .replace(/\s*mil\s*$/gi, '');

    // Converter vírgula para ponto
    const normalized = cleanText.replace(',', '.');

    let amount = parseFloat(normalized);
    if (isNaN(amount)) return null;

    // Aplicar multiplicador
    if (hasK || hasMil) amount *= 1000;

    return amount;
  }

  // Extrair categoria
  extractCategory(text) {
    const categoryMap = {
      // Transporte
      'uber': 'transporte', '99': 'transporte', 'taxi': 'transporte',
      'ônibus': 'transporte', 'metrô': 'transporte', 'transporte': 'transporte',
      'gasolina': 'transporte', 'combustível': 'transporte', 'posto': 'transporte',
      'estacionamento': 'transporte', 'pedágio': 'transporte', 'passagem': 'transporte',

      // Alimentação
      'almoço': 'alimentação', 'jantar': 'alimentação', 'café': 'alimentação',
      'lanche': 'alimentação', 'restaurante': 'alimentação', 'alimentação': 'alimentação',
      'pizza': 'alimentação', 'hambúrguer': 'alimentação', 'sushi': 'alimentação',
      'açaí': 'alimentação', 'sorvete': 'alimentação', 'padaria': 'alimentação',
      'ifood': 'alimentação', 'delivery': 'alimentação', 'comida': 'alimentação',
      'lanchonete': 'alimentação',

      // Mercado / Supermercado
      'mercado': 'mercado', 'supermercado': 'mercado', 'feira': 'mercado',
      'compras': 'mercado', 'hortifruti': 'mercado', 'atacadão': 'mercado',
      'refrigerante': 'mercado', 'bebida': 'mercado',

      // Transferências
      'pix': 'transferência', 'transferência': 'transferência',
      'transferencia': 'transferência', 'ted': 'transferência', 'doc': 'transferência',

      // Contas / Moradia
      'conta': 'contas', 'boleto': 'contas', 'luz': 'contas', 'água': 'contas',
      'internet': 'contas', 'telefone': 'contas', 'aluguel': 'contas',
      'condomínio': 'contas', 'gás': 'contas', 'iptu': 'contas', 'ipva': 'contas',
      'seguro': 'contas', 'fatura': 'contas', 'mensalidade': 'contas',

      // Lazer / Entretenimento
      'cinema': 'lazer', 'teatro': 'lazer', 'show': 'lazer', 'bar': 'lazer',
      'balada': 'lazer', 'lazer': 'lazer', 'netflix': 'lazer', 'spotify': 'lazer',
      'jogo': 'lazer', 'game': 'lazer', 'viagem': 'lazer', 'hotel': 'lazer',
      'festa': 'lazer', 'parque': 'lazer',

      // Saúde
      'farmácia': 'saúde', 'farmacia': 'saúde', 'médico': 'saúde', 'medico': 'saúde',
      'dentista': 'saúde', 'exame': 'saúde', 'saúde': 'saúde', 'remédio': 'saúde',
      'hospital': 'saúde', 'consulta': 'saúde', 'plano de saúde': 'saúde',
      'academia': 'saúde',

      // Educação
      'curso': 'educação', 'faculdade': 'educação', 'universidade': 'educação',
      'livro': 'educação', 'educação': 'educação', 'escola': 'educação',
      'material escolar': 'educação', 'apostila': 'educação',

      // Vestuário
      'roupa': 'vestuário', 'calçado': 'vestuário', 'sapato': 'vestuário',
      'tênis': 'vestuário', 'camisa': 'vestuário', 'calça': 'vestuário',
      'vestido': 'vestuário', 'loja': 'vestuário',

      // Assinaturas
      'assinatura': 'assinaturas', 'plano': 'assinaturas',

      // Pet
      'pet': 'pet', 'veterinário': 'pet', 'ração': 'pet', 'petshop': 'pet'
    };

    const lowerText = text.toLowerCase();
    
    for (const [keyword, category] of Object.entries(categoryMap)) {
      if (lowerText.includes(keyword)) {
        return category;
      }
    }

    return 'outros';
  }

  // Extrair descrição — preserva detalhes úteis como itens e local
  extractDescription(text) {
    const cleanText = text
      .replace(/r?\$?\s*[\d.,]+\s*[kK]?/gi, '')
      .replace(/\s*(?:reais?|r\$)/gi, '')
      .replace(/\b(?:gastei|paguei|recebi|ganhei|comprei|entrou|depositei)\b/gi, '')
      .replace(/^\s*(?:de|com|no|na|em|para)\s+/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Capitalizar primeira letra
    if (cleanText.length >= 2) {
      return cleanText.charAt(0).toUpperCase() + cleanText.slice(1);
    }
    return cleanText || 'Transação';
  }

  // Extrair data
  extractDate(text) {
    // Tentar extrair data no formato DD/MM/YYYY ou DD/MM/YY
    const datePattern = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/;
    const dateMatch = text.match(datePattern);
    if (dateMatch) {
      const parsed = moment(dateMatch[0], ['DD/MM/YYYY', 'DD/MM/YY', 'DD-MM-YYYY']);
      if (parsed.isValid()) {
        return parsed.toDate();
      }
    }

    // Verificar palavras como "hoje", "ontem", etc.
    const dateKeywords = {
      'hoje': 0,
      'ontem': -1,
      'anteontem': -2,
      'amanhã': 1
    };

    for (const [keyword, days] of Object.entries(dateKeywords)) {
      if (text.toLowerCase().includes(keyword)) {
        return moment().add(days, 'days').toDate();
      }
    }

    return new Date();
  }

  // Extrair ação de cofrinho com base no padrão que casou
  extractSavingsAction(match, text) {
    // Adicionar/depositar/aplicar: "adicionar 100 ao cofrinho viagem" ou "aplicar 500 no cofrinho"
    if (/(?:adicionar|depositar|colocar|guardar|aplicar)\s+[\d]/i.test(text)) {
      return { type: 'savings', action: 'add', amount: this.extractAmount(match[1]), name: match[2]?.trim() || null };
    }
    // Retirar/resgatar: "retirar 50 do cofrinho viagem" ou "resgatar 2k do cofrinho"
    if (/(?:retirar|tirar|sacar|pegar|resgatar)\s+[\d]/i.test(text)) {
      return { type: 'savings', action: 'withdraw', amount: this.extractAmount(match[1]), name: match[2]?.trim() || null };
    }
    // Listar: "meus cofrinhos", "listar cofrinhos"
    if (/(?:meus?\s+)?cofrinhos$|(?:listar|ver)\s+cofrinhos/i.test(text)) {
      return { type: 'savings', action: 'list' };
    }
    // Ver específico: "ver cofrinho viagem"
    if (/(?:ver|status|detalhe)\s+(?:do\s+)?cofrinho\s+/i.test(text)) {
      return { type: 'savings', action: 'view', name: match[1]?.trim() };
    }
    // Criar sem params: "criar cofrinho"
    if (/^(?:criar\s+)?cofrinho$/i.test(text)) {
      return { type: 'savings', action: 'create_help' };
    }
    // Criar (padrão): "cofrinho viagem 2000"
    return { type: 'savings', action: 'create', name: match[1]?.trim(), target: this.extractAmount(match[2]) };
  }

  // Normalizar nome de categoria (input do usuário → categoria do banco)
  normalizeCategoryName(input) {
    if (!input) return 'outros';
    const lower = input.toLowerCase().trim()
      .replace(/[?!.,]+$/, '').trim(); // remover pontuação final

    const aliases = {
      'mercado': 'mercado', 'supermercado': 'mercado', 'feira': 'mercado', 'compras': 'mercado',
      'alimentação': 'alimentação', 'alimentacao': 'alimentação', 'comida': 'alimentação',
      'restaurante': 'alimentação', 'almoço': 'alimentação', 'jantar': 'alimentação',
      'lanche': 'alimentação', 'café': 'alimentação',
      'transporte': 'transporte', 'uber': 'transporte', 'taxi': 'transporte',
      'ônibus': 'transporte', 'metrô': 'transporte', 'gasolina': 'transporte',
      'transferência': 'transferência', 'transferencia': 'transferência', 'pix': 'transferência',
      'contas': 'contas', 'conta': 'contas', 'luz': 'contas', 'água': 'contas',
      'internet': 'contas', 'aluguel': 'contas', 'telefone': 'contas',
      'lazer': 'lazer', 'cinema': 'lazer', 'bar': 'lazer', 'show': 'lazer',
      'saúde': 'saúde', 'saude': 'saúde', 'farmácia': 'saúde', 'farmacia': 'saúde',
      'médico': 'saúde', 'medico': 'saúde', 'dentista': 'saúde',
      'educação': 'educação', 'educacao': 'educação', 'curso': 'educação',
      'faculdade': 'educação', 'livro': 'educação',
      'cofrinho': 'cofrinho',
      'outros': 'outros'
    };

    return aliases[lower] || lower;
  }

  // Extrair período
  extractPeriod(text) {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('semana')) return 'week';
    if (lowerText.includes('mês') || lowerText.includes('mes')) return 'month';
    if (lowerText.includes('trimestre')) return 'quarter';
    if (lowerText.includes('ano')) return 'year';
    
    return 'month'; // padrão
  }

  // Gerar resposta de ajuda
  generateHelpMessage() {
    return `🤖 **COMANDOS DISPONÍVEIS**\n\n` +
           `💰 **Registrar Gastos:**\n` +
           `• "Gastei 50 no Uber"\n` +
           `• "Paguei 150 na conta de luz"\n` +
           `• "Comprei 80 no mercado"\n\n` +
           
           `💵 **Registrar Receitas:**\n` +
           `• "Recebi 2500 do salário"\n` +
           `• "Ganhei 500 do freela"\n\n` +
           
           `📊 **Consultas:**\n` +
           `• "Quanto tenho agora?"\n` +
           `• "Resumo da semana"\n` +
           `• "Relatório do mês"\n` +
           `• "Quanto gastei em mercado?" (detalhes por categoria)\n` +
           `• "Detalhes de outros"\n\n` +
           
           `🎯 **Metas:**\n` +
           `• "Meta de mercado 600"\n` +
           `• "Meta de transporte 200"\n\n` +
           
           `💰 **Cofrinhos:**\n` +
           `• "Cofrinho viagem 2000" (criar)\n` +
           `• "Adicionar 100 ao cofrinho viagem"\n` +
           `• "Retirar 50 do cofrinho viagem"\n` +
           `• "Meus cofrinhos" (listar)\n` +
           `• "Ver cofrinho viagem"\n\n` +

           `📅 **Calendário:**\n` +
           `• "Conectar calendário"\n` +
           `• "Desconectar calendário"\n\n` +
           
           `📤 **Exportação:**\n` +
           `• "Exporte este mês em PDF"\n` +
           `• "Exporte agosto em CSV"\n\n` +
           
           `🔒 **PIN:**\n` +
           `• "Alterar pin"\n` +
           `• "Resetar pin"\n\n` +

           `🔕 **Configurações:**\n` +
           `• "Pausar notificações por 3 dias"\n\n` +
           
           `📷 **OCR:**\n` +
           `• Envie uma foto de recibo para extração automática\n\n` +
           `🎤 **Áudio:**\n` +
           `• Envie um áudio dizendo o que gastou ou recebeu`;
  }
}

module.exports = NaturalLanguageProcessor; 