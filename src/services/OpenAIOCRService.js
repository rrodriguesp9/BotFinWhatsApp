const OpenAI = require('openai');

class OpenAIOCRService {
  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = 'gpt-4o-mini';
  }

  /**
   * Processa imagem de nota fiscal/recibo usando GPT Vision.
   * Retorna no mesmo formato do OCRService para compatibilidade.
   */
  async processImage(imageBuffer) {
    try {
      console.log('🔍 Processando imagem com OpenAI Vision...');

      // Converter buffer para base64
      const base64Image = imageBuffer.toString('base64');
      const mimeType = this.detectMimeType(imageBuffer);

      const response = await this.openai.chat.completions.create({
        model: this.model,
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content: `Você é um especialista em ler notas fiscais e recibos brasileiros.
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
- Categorias: mercado/supermercado→mercado, restaurante/lanche→alimentação, farmácia→saúde`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Leia esta nota fiscal/recibo e extraia os dados financeiros:'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                  detail: 'high'
                }
              }
            ]
          }
        ]
      });

      const content = response.choices[0].message.content.trim();
      console.log('🤖 OpenAI Vision resposta:', content);

      // Parsear JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('⚠️ OpenAI Vision: resposta não é JSON');
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
        confidence: 85, // Alta confiança para GPT Vision
        source: 'openai_vision'
      };

    } catch (error) {
      console.error('❌ OpenAI Vision erro:', error.message);
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
    // Detectar tipo pelo magic number do buffer
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
    if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
    return 'image/jpeg'; // fallback
  }

  validateReceiptImage(imageBuffer) {
    if (imageBuffer.length < 1024) {
      return { valid: false, reason: 'Imagem muito pequena' };
    }
    if (imageBuffer.length > 20 * 1024 * 1024) {
      return { valid: false, reason: 'Imagem muito grande (máx 20MB)' };
    }
    return { valid: true };
  }
}

module.exports = OpenAIOCRService;
