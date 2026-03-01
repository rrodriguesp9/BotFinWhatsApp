const moment = require('moment');

class NaturalLanguageProcessor {
  constructor() {
    // NLP baseado em regex otimizado para português brasileiro
  }

  // Processar mensagem e extrair intenção
  processMessage(message) {
    const text = message.toLowerCase().trim();
    
    // Padrões de regex para diferentes tipos de comandos
    // IMPORTANTE: a ordem define prioridade. Padrões mais específicos primeiro.
    const patterns = {
      // Ajuda (primeiro para evitar conflitos com "como")
      help: [
        /(?:ajuda|help|comandos|como\s+(?:usar|funciona)|o\s+que\s+posso)/i
      ],

      // Modo silencioso
      silent: [
        /(?:pausar|silenciar|silêncio)\s+(?:notificações?|alertas?)\s+(?:por\s+)?(\d+)\s+(?:dias?|dia)/i,
        /(?:modo\s+)?(?:silencioso|silêncio)\s+(?:por\s+)?(\d+)\s+(?:dias?|dia)/i
      ],

      // Exportação
      export: [
        /(?:exportar|exporte|baixar|download)\s+(?:relatório|dados|este|esse)?\s*(?:mês|semana)?\s*(?:em|para)\s+(pdf|csv|excel)/i,
        /(?:exporte|baixar)\s+(?:este\s+)?(?:mês|semana)\s+(?:em|para)\s+(pdf|csv|excel)/i
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
        /(?:cofrinho|objetivo|guardar\s+para|poupar\s+para)\s+(?:para\s+)?([a-záàâãéèêíïóôõöúçñ]+)\s+([\d.,]+)/i,
        /(?:criar\s+)?(?:cofrinho|objetivo)\s+([a-záàâãéèêíïóôõöúçñ]+)\s+([\d.,]+)/i
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
        /(?:recebi|ganhei|entrou|depositei|salário|freela|pagamento)\s+(?:de\s+)?r?\$?\s*([\d.,]+)/i,
        /(?:recebi|ganhei|entrou|depositei)\s+([\d.,]+)\s+(?:reais?|r\$)/i,
        /(?:salário|freela|pagamento)\s+(?:de\s+)?([\d.,]+)/i
      ],

      // Despesas (por último entre os financeiros)
      expense: [
        /(?:gastei|paguei|comprei|compras?|conta|boleto)\s+(?:de\s+)?r?\$?\s*([\d.,]+)/i,
        /(?:gastei|paguei|comprei)\s+([\d.,]+)\s+(?:reais?|r\$)/i,
        /(?:conta|boleto)\s+(?:de\s+)?([\d.,]+)/i,
        /(?:uber|99|taxi|ônibus|metrô|transporte)\s+([\d.,]+)/i,
        /(?:almoço|jantar|café|lanche|restaurante)\s+([\d.,]+)/i,
        /(?:mercado|supermercado|feira)\s+([\d.,]+)/i
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
        extracted.extracted = {
          type: 'savings',
          name: match[1],
          target: this.extractAmount(match[2])
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

      case 'silent':
        extracted.extracted = {
          type: 'silent',
          days: parseInt(match[1])
        };
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
      income: ['recebi', 'ganhei', 'entrou', 'salário', 'salario', 'freela', 'pagamento'],
      expense: ['gastei', 'paguei', 'comprei', 'conta', 'boleto', 'uber', 'mercado'],
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

  // Extrair valor monetário
  extractAmount(text) {
    if (!text) return null;
    
    // Remover "R$", "reais", etc.
    const cleanText = text.replace(/r?\$?\s*/gi, '').replace(/\s*(?:reais?|r\$)/gi, '');
    
    // Converter vírgula para ponto
    const normalized = cleanText.replace(',', '.');
    
    const amount = parseFloat(normalized);
    return isNaN(amount) ? null : amount;
  }

  // Extrair categoria
  extractCategory(text) {
    const categoryMap = {
      // Transporte
      'uber': 'transporte',
      '99': 'transporte',
      'taxi': 'transporte',
      'ônibus': 'transporte',
      'metrô': 'transporte',
      'transporte': 'transporte',
      
      // Alimentação
      'almoço': 'alimentação',
      'jantar': 'alimentação',
      'café': 'alimentação',
      'lanche': 'alimentação',
      'restaurante': 'alimentação',
      'alimentação': 'alimentação',
      
      // Mercado
      'mercado': 'mercado',
      'supermercado': 'mercado',
      'feira': 'mercado',
      'compras': 'mercado',
      
      // Contas
      'conta': 'contas',
      'boleto': 'contas',
      'luz': 'contas',
      'água': 'contas',
      'internet': 'contas',
      'telefone': 'contas',
      
      // Lazer
      'cinema': 'lazer',
      'teatro': 'lazer',
      'show': 'lazer',
      'bar': 'lazer',
      'balada': 'lazer',
      'lazer': 'lazer',
      
      // Saúde
      'farmácia': 'saúde',
      'médico': 'saúde',
      'dentista': 'saúde',
      'exame': 'saúde',
      'saúde': 'saúde',
      
      // Educação
      'curso': 'educação',
      'faculdade': 'educação',
      'universidade': 'educação',
      'livro': 'educação',
      'educação': 'educação'
    };

    const lowerText = text.toLowerCase();
    
    for (const [keyword, category] of Object.entries(categoryMap)) {
      if (lowerText.includes(keyword)) {
        return category;
      }
    }

    return 'outros';
  }

  // Extrair descrição
  extractDescription(text) {
    // Remover números e palavras comuns
    const cleanText = text
      .replace(/r?\$?\s*[\d.,]+/gi, '')
      .replace(/\s*(?:reais?|r\$)/gi, '')
      .replace(/\b(?:gastei|paguei|recebi|ganhei|comprei|entrou)\b/gi, '')
      .replace(/\b(?:de|com|no|na|em|para)\b/gi, '')
      .trim();

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
           `• "Relatório do mês"\n\n` +
           
           `🎯 **Metas:**\n` +
           `• "Meta de mercado 600"\n` +
           `• "Meta de transporte 200"\n\n` +
           
           `💰 **Cofrinhos:**\n` +
           `• "Criar cofrinho viagem 2000"\n\n` +
           
           `📤 **Exportação:**\n` +
           `• "Exporte este mês em PDF"\n` +
           `• "Exporte agosto em CSV"\n\n` +
           
           `🔕 **Configurações:**\n` +
           `• "Pausar notificações por 3 dias"\n\n` +
           
           `📷 **OCR:**\n` +
           `• Envie uma foto de recibo para extração automática`;
  }
}

module.exports = NaturalLanguageProcessor; 