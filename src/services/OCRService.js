const Tesseract = require('tesseract.js');
const { createCanvas, loadImage } = require('canvas');
const moment = require('moment');

class OCRService {
  constructor() {
    this.config = {
      lang: process.env.TESSERACT_LANG || 'por',
      logger: m => console.log(m)
    };
  }

  // Processar imagem e extrair dados
  async processImage(imageBuffer) {
    try {
      console.log('🔍 Iniciando processamento OCR...');
      
      // Carregar imagem
      const image = await loadImage(imageBuffer);
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      
      // Aplicar pré-processamento para melhorar OCR
      const processedCanvas = this.preprocessImage(canvas);
      
      // Extrair texto
      const result = await Tesseract.recognize(
        processedCanvas.toBuffer(),
        this.config.lang,
        {
          logger: this.config.logger
        }
      );

      console.log('📝 Texto extraído:', result.data.text);
      
      // Processar texto extraído
      const extractedData = this.extractFinancialData(result.data.text);
      
      return {
        success: true,
        text: result.data.text,
        extracted: extractedData,
        confidence: result.data.confidence
      };
      
    } catch (error) {
      console.error('❌ Erro no OCR:', error);
      return {
        success: false,
        error: error.message,
        text: '',
        extracted: null
      };
    }
  }

  // Pré-processar imagem para melhorar OCR
  preprocessImage(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Converter para escala de cinza e aumentar contraste
    for (let i = 0; i < data.length; i += 4) {
      const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const contrast = Math.min(255, Math.max(0, (gray - 128) * 1.5 + 128));
      
      data[i] = contrast;     // R
      data[i + 1] = contrast; // G
      data[i + 2] = contrast; // B
      // data[i + 3] = alpha (mantém)
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  // Extrair dados financeiros do texto
  extractFinancialData(text) {
    const extracted = {
      amount: null,
      date: null,
      establishment: null,
      category: 'outros',
      description: '',
      confidence: 'low'
    };

    try {
      // Extrair valor monetário
      extracted.amount = this.extractAmount(text);
      
      // Extrair data
      extracted.date = this.extractDate(text);
      
      // Extrair estabelecimento
      extracted.establishment = this.extractEstablishment(text);
      
      // Determinar categoria baseada no estabelecimento
      extracted.category = this.determineCategory(extracted.establishment, text);
      
      // Gerar descrição
      extracted.description = this.generateDescription(extracted);
      
      // Calcular confiança
      extracted.confidence = this.calculateConfidence(extracted);
      
    } catch (error) {
      console.error('Erro ao extrair dados:', error);
    }

    return extracted;
  }

  // Extrair valor monetário
  extractAmount(text) {
    const amountPatterns = [
      // R$ 123,45 ou R$123,45
      /r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/gi,
      // 123,45 reais
      /(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:reais?|r\$)/gi,
      // Total: R$ 123,45
      /(?:total|valor|preço|custo):?\s*r?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/gi,
      // Apenas números que parecem valores monetários
      /(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/g
    ];

    let maxAmount = 0;
    
    for (const pattern of amountPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          const cleanMatch = match.replace(/r?\$?\s*/gi, '').replace(/\s*(?:reais?|r\$)/gi, '');
          const amount = parseFloat(cleanMatch.replace('.', '').replace(',', '.'));
          
          if (!isNaN(amount) && amount > maxAmount && amount < 100000) {
            maxAmount = amount;
          }
        }
      }
    }

    return maxAmount > 0 ? maxAmount : null;
  }

  // Extrair data
  extractDate(text) {
    const datePatterns = [
      // DD/MM/YYYY ou DD/MM/YY
      /(\d{1,2}\/\d{1,2}\/\d{2,4})/g,
      // DD-MM-YYYY
      /(\d{1,2}-\d{1,2}-\d{2,4})/g,
      // DD.MM.YYYY
      /(\d{1,2}\.\d{1,2}\.\d{2,4})/g,
      // Data: DD/MM/YYYY
      /(?:data|em):\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/gi
    ];

    for (const pattern of datePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          const date = moment(match, ['DD/MM/YYYY', 'DD/MM/YY', 'DD-MM-YYYY', 'DD.MM.YYYY']);
          if (date.isValid()) {
            return date.toDate();
          }
        }
      }
    }

    return new Date(); // Data atual como fallback
  }

  // Extrair estabelecimento
  extractEstablishment(text) {
    const establishmentPatterns = [
      // Padrões comuns de estabelecimentos
      /(?:estabelecimento|empresa|loja|mercado|supermercado|farmácia|restaurante):\s*([^\n\r]+)/gi,
      // Nomes de estabelecimentos conhecidos
      /(?:carrefour|extra|pão\s+de\s+açúcar|assai|atacadão|sam's|walmart|big|bompreço|supermercado\s+[a-z]+)/gi,
      // Padrões de CNPJ (pode indicar estabelecimento)
      /cnpj[:\s]*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/gi
    ];

    for (const pattern of establishmentPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1] || match[0];
      }
    }

    // Tentar extrair primeira linha que parece nome de estabelecimento
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    for (const line of lines) {
      const cleanLine = line.trim();
      if (cleanLine.length > 3 && cleanLine.length < 50 && 
          !cleanLine.match(/^\d/) && 
          !cleanLine.match(/r?\$/) &&
          !cleanLine.match(/total|valor|data|cnpj/i)) {
        return cleanLine;
      }
    }

    return 'Estabelecimento não identificado';
  }

  // Determinar categoria baseada no estabelecimento
  determineCategory(establishment, text) {
    const lowerEstablishment = establishment.toLowerCase();
    const lowerText = text.toLowerCase();

    // Mapeamento de estabelecimentos para categorias
    const categoryMap = {
      // Mercado/Supermercado
      'carrefour': 'mercado',
      'extra': 'mercado',
      'pão de açúcar': 'mercado',
      'assai': 'mercado',
      'atacadão': 'mercado',
      'walmart': 'mercado',
      'big': 'mercado',
      'bompreço': 'mercado',
      'supermercado': 'mercado',
      'mercado': 'mercado',
      
      // Farmácia
      'farmácia': 'saúde',
      'drogaria': 'saúde',
      'raia': 'saúde',
      'drogasil': 'saúde',
      
      // Restaurante
      'restaurante': 'alimentação',
      'lanchonete': 'alimentação',
      'pizzaria': 'alimentação',
      'hamburgueria': 'alimentação',
      
      // Transporte
      'uber': 'transporte',
      '99': 'transporte',
      'taxi': 'transporte',
      
      // Contas
      'energia': 'contas',
      'luz': 'contas',
      'água': 'contas',
      'internet': 'contas',
      'telefone': 'contas',
      'gás': 'contas'
    };

    // Verificar estabelecimento
    for (const [keyword, category] of Object.entries(categoryMap)) {
      if (lowerEstablishment.includes(keyword) || lowerText.includes(keyword)) {
        return category;
      }
    }

    return 'outros';
  }

  // Gerar descrição
  generateDescription(extracted) {
    const parts = [];
    
    if (extracted.establishment && extracted.establishment !== 'Estabelecimento não identificado') {
      parts.push(extracted.establishment);
    }
    
    if (extracted.amount) {
      parts.push(`R$ ${extracted.amount.toFixed(2)}`);
    }
    
    if (extracted.date) {
      parts.push(moment(extracted.date).format('DD/MM/YYYY'));
    }
    
    return parts.join(' - ') || 'Transação via OCR';
  }

  // Calcular confiança da extração
  calculateConfidence(extracted) {
    let confidence = 0;
    
    if (extracted.amount) confidence += 0.4;
    if (extracted.date) confidence += 0.3;
    if (extracted.establishment && extracted.establishment !== 'Estabelecimento não identificado') confidence += 0.2;
    if (extracted.category !== 'outros') confidence += 0.1;
    
    if (confidence >= 0.7) return 'high';
    if (confidence >= 0.4) return 'medium';
    return 'low';
  }

  // Validar se a imagem parece ser um recibo
  validateReceiptImage(imageBuffer) {
    // Verificações básicas
    const minSize = 1024; // 1KB
    const maxSize = 10 * 1024 * 1024; // 10MB
    
    if (imageBuffer.length < minSize) {
      return { valid: false, reason: 'Imagem muito pequena' };
    }
    
    if (imageBuffer.length > maxSize) {
      return { valid: false, reason: 'Imagem muito grande' };
    }
    
    return { valid: true };
  }

  // Gerar mensagem de confirmação
  generateConfirmationMessage(extracted) {
    if (!extracted.amount) {
      return `❌ **Não consegui extrair o valor do recibo.**\n\n` +
             `Por favor, digite o valor manualmente:\n` +
             `Exemplo: "gastei 50 no mercado"`;
    }

    const amountFormatted = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(extracted.amount);

    let message = `📷 **DADOS EXTRAÍDOS DO RECIBO**\n\n` +
                  `💰 **Valor:** ${amountFormatted}\n`;
    
    if (extracted.establishment && extracted.establishment !== 'Estabelecimento não identificado') {
      message += `🏪 **Estabelecimento:** ${extracted.establishment}\n`;
    }
    
    if (extracted.date) {
      message += `📅 **Data:** ${moment(extracted.date).format('DD/MM/YYYY')}\n`;
    }
    
    message += `📂 **Categoria:** ${extracted.category}\n\n`;
    
    if (extracted.confidence === 'low') {
      message += `⚠️ **Confiança baixa** - Por favor, confirme os dados acima.`;
    } else {
      message += `✅ **Confirma este gasto?**\n` +
                 `Responda "sim" para confirmar ou "não" para cancelar.`;
    }
    
    return message;
  }
}

module.exports = OCRService; 