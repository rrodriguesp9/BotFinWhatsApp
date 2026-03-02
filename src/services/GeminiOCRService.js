const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiOCRService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Lista de modelos para tentar em ordem (free tier varia por modelo)
    this.modelNames = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'];
    console.log('✅ GeminiOCRService inicializado');
  }

  /**
   * Processa imagem de nota fiscal/recibo usando Gemini Vision.
   * Tenta múltiplos modelos caso o free tier de um esteja indisponível.
   * Retorna no mesmo formato do OCRService para compatibilidade.
   */
  async processImage(imageBuffer) {
    try {
      const mimeType = this.detectMimeType(imageBuffer);
      console.log(`🔍 Gemini Vision: processando imagem (${imageBuffer.length} bytes, ${mimeType})...`);

      // Converter buffer para base64
      const base64Image = imageBuffer.toString('base64');

      const prompt = `Você é um especialista em ler notas fiscais e recibos brasileiros.
Extraia as informações financeiras da imagem e responda APENAS com JSON válido:
{
  "success": true,
  "amount": número (valor total em reais, ex: 45.90),
  "date": "DD/MM/YYYY" ou null,
  "establishment": "nome do estabelecimento" ou null,
  "category": "alimentação|mercado|transporte|contas|saúde|educação|lazer|transferência|outros",
  "description": "descrição curta da compra",
  "items_count": número de itens ou null,
  "payment_method": "dinheiro|cartão|pix|débito|crédito" ou null
}

Regras:
- O amount DEVE ser o VALOR TOTAL da nota (não valor de item individual)
- Se houver parcelas (ex: 3x R$50), calcule o total (150)
- Sempre use ponto decimal, não vírgula (45.90 não 45,90)
- Se não conseguir ler a imagem, retorne {"success": false, "error": "motivo"}
- Categorias: mercado/supermercado→mercado, restaurante/lanche→alimentação, farmácia→saúde`;

      const imageData = {
        inlineData: {
          mimeType: mimeType,
          data: base64Image,
        },
      };

      // Tentar modelos em ordem até um funcionar
      let content = null;
      let lastError = null;

      for (const modelName of this.modelNames) {
        try {
          console.log(`🔍 Tentando modelo: ${modelName}...`);
          const model = this.genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent([prompt, imageData]);
          const response = await result.response;
          content = response.text().trim();
          console.log(`🤖 Gemini (${modelName}) resposta:`, content.substring(0, 200));
          break; // Funcionou, sair do loop
        } catch (modelError) {
          lastError = modelError;
          console.log(`⚠️ Modelo ${modelName} falhou: ${modelError.message.substring(0, 100)}`);
          // Se é erro 429 (quota), tentar próximo modelo
          if (modelError.message.includes('429') || modelError.message.includes('quota')) {
            continue;
          }
          // Outro tipo de erro, não adianta tentar outro modelo
          throw modelError;
        }
      }

      if (!content) {
        throw lastError || new Error('Todos os modelos Gemini falharam');
      }

      // Parsear JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('⚠️ Gemini Vision: resposta não é JSON');
        return { success: false, error: 'Resposta inválida da IA' };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.success) {
        return { success: false, error: parsed.error || 'Não foi possível ler a imagem' };
      }

      // Formatar no padrão do OCRService
      return {
        success: true,
        text: content,
        extracted: {
          amount: parsed.amount || null,
          date: this.parseDate(parsed.date),
          establishment: parsed.establishment || null,
          category: parsed.category || 'outros',
          description: this.buildDescription(parsed),
          type: 'expense',
          confidence: 'high',
          paymentMethod: parsed.payment_method || null,
          itemsCount: parsed.items_count || null
        },
        confidence: 85,
        source: 'gemini_vision'
      };

    } catch (error) {
      console.error('❌ Gemini Vision erro:', error.message);
      if (error.status) console.error('❌ Gemini Vision HTTP status:', error.status);
      return { success: false, error: error.message };
    }
  }

  /**
   * Gera mensagem de confirmação para o usuário.
   */
  generateConfirmationMessage(extracted) {
    const amountFormatted = extracted.amount
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(extracted.amount)
      : 'Não identificado';

    let message = `📷 *Nota fiscal lida com sucesso!*\n\n`;

    if (extracted.establishment) {
      message += `🏪 *Local:* ${extracted.establishment}\n`;
    }
    message += `💰 *Valor:* ${amountFormatted}\n`;
    message += `📂 *Categoria:* ${extracted.category}\n`;

    if (extracted.date) {
      const moment = require('moment');
      message += `📅 *Data:* ${moment(extracted.date).format('DD/MM/YYYY')}\n`;
    }

    if (extracted.paymentMethod) {
      message += `💳 *Pagamento:* ${extracted.paymentMethod}\n`;
    }

    if (extracted.itemsCount) {
      message += `📦 *Itens:* ${extracted.itemsCount}\n`;
    }

    message += `\n✅ Confirma o registro desta despesa? (sim/não)`;

    return message;
  }

  buildDescription(parsed) {
    const parts = [];
    if (parsed.establishment) parts.push(parsed.establishment);
    if (parsed.description && parsed.description !== parsed.establishment) {
      parts.push(parsed.description);
    }
    return parts.join(' - ') || 'Compra via nota fiscal';
  }

  parseDate(dateStr) {
    if (!dateStr) return new Date();
    const moment = require('moment');
    const parsed = moment(dateStr, ['DD/MM/YYYY', 'DD/MM/YY', 'YYYY-MM-DD']);
    return parsed.isValid() ? parsed.toDate() : new Date();
  }

  detectMimeType(buffer) {
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
    if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
    return 'image/jpeg'; // fallback
  }
}

module.exports = GeminiOCRService;
