const OpenAI = require('openai');

class OpenAINLPService {
  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = 'gpt-4o-mini'; // Rápido e barato
  }

  /**
   * Processa mensagem usando GPT quando o regex falha.
   * Retorna o mesmo formato do NaturalLanguageProcessor para compatibilidade.
   */
  async processMessage(message) {
    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        temperature: 0,
        max_tokens: 300,
        messages: [
          {
            role: 'system',
            content: `Você é um parser de comandos financeiros de um bot WhatsApp brasileiro.
Analise a mensagem do usuário e extraia a intenção financeira.

Responda APENAS com JSON válido no formato:
{
  "intention": "expense|income|balance|report|goal|help|greeting|unknown",
  "extracted": {
    "type": "expense|income|query|greeting|help",
    "amount": number ou null,
    "category": "string",
    "description": "string curta"
  },
  "confidence": 0.0 a 1.0
}

Regras:
- "pix", "transferi", "mandei", "enviei" = expense (a menos que diga "recebi pix")
- "k" ou "K" após número = multiplicar por 1000 (2k=2000, 1.5k=1500)
- Categorias: transporte, alimentação, mercado, contas, lazer, saúde, educação, transferência, outros
- Se for saudação (oi, olá, bom dia, etc): intention=greeting
- Se não conseguir entender: intention=unknown
- Extraia a descrição curta (ex: "pix para Carlos", "uber pro trabalho")
- Se mencionar saldo/quanto tenho: intention=balance, type=query`
          },
          {
            role: 'user',
            content: message
          }
        ]
      });

      const content = response.choices[0].message.content.trim();

      // Parsear JSON da resposta
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('⚠️ OpenAI NLP: resposta não é JSON:', content);
        return this.fallbackResult(message);
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        intention: parsed.intention || 'unknown',
        originalText: message,
        confidence: parsed.confidence || 0.7,
        extracted: {
          type: parsed.extracted?.type || parsed.intention,
          amount: parsed.extracted?.amount || null,
          category: parsed.extracted?.category || 'outros',
          description: parsed.extracted?.description || message,
          date: new Date()
        },
        source: 'openai'
      };

    } catch (error) {
      console.error('❌ OpenAI NLP erro:', error.message);
      return this.fallbackResult(message);
    }
  }

  fallbackResult(message) {
    return {
      intention: 'unknown',
      originalText: message,
      confidence: 0,
      extracted: { type: 'unknown' },
      source: 'openai_error'
    };
  }
}

module.exports = OpenAINLPService;
