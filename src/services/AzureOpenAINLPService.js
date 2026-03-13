const { AzureOpenAI } = require('openai');

class AzureOpenAINLPService {
  constructor() {
    this.client = new AzureOpenAI({
      apiKey: process.env.AZURE_OPENAI_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview',
    });
    this.deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'Test-gpt-4.1';
    console.log(`✅ AzureOpenAINLPService inicializado (${this.deployment})`);
  }

  /**
   * Processa mensagem usando Azure OpenAI como NLP PRIMÁRIO.
   * Retorna o mesmo formato do NaturalLanguageProcessor para compatibilidade.
   */
  async processMessage(message) {
    try {
      const response = await this.client.chat.completions.create({
        model: this.deployment,
        temperature: 0,
        max_tokens: 400,
        messages: [
          {
            role: 'system',
            content: `Você é o parser de comandos financeiros do AgendaCash, um bot WhatsApp brasileiro de finanças pessoais.
Analise a mensagem do usuário e extraia a intenção financeira com precisão.

Responda APENAS com JSON válido no formato:
{
  "intention": "expense|income|balance|report|goal|savings|split|export|silent|pin|calendar|category_query|help|greeting|unknown",
  "extracted": {
    "type": "expense|income|query|greeting|help|goal|savings|split|export|silent|pin|calendar|category_query",
    "amount": number ou null,
    "category": "string",
    "description": "string curta e clara"
  },
  "confidence": 0.0 a 1.0
}

REGRAS CRÍTICAS DE VALOR:
- "mil" = multiplicar por 1000: "5 mil" = 5000, "2 mil" = 2000, "1 mil e 500" = 1500, "1500" = 1500
- "k" ou "K" após número = multiplicar por 1000: "2k" = 2000, "1.5k" = 1500
- "meio" ou "meia" = 0.5: "meio mil" = 500
- Valores com vírgula decimal: "2.500,00" = 2500, "1.200" = 1200
- NUNCA interprete "mil" como o número 1000 isolado quando acompanha outro número

REGRAS DE INTENÇÃO:
- "gastei", "paguei", "comprei", "conta", "boleto", "fiz um pix", "transferi", "mandei" = expense
- "recebi", "ganhei", "entrou", "salário", "freela", "recebi pix", "caiu" = income
- "quanto tenho", "saldo", "disponível" = balance
- "resumo", "relatório", "extrato" = report
- "meta", "limite" = goal
- "cofrinho", "guardar para", "poupar" = savings
- "dividir", "dividido" = split
- "exportar", "baixar" = export
- "pausar", "silenciar" = silent
- "alterar pin", "mudar senha" = pin
- "conectar calendário" = calendar
- "quanto gastei em X", "detalhes de X" = category_query
- Saudações (oi, olá, bom dia, etc) = greeting
- "ajuda", "help", "comandos" = help

CATEGORIAS (use a mais específica):
- salário, freela, renda = "salário" (para income)
- uber, 99, taxi, gasolina, ônibus, metrô = "transporte"
- almoço, jantar, café, restaurante, ifood, lanche = "alimentação"
- mercado, supermercado, feira = "mercado"
- pix, transferência, ted, doc = "transferência"
- conta, boleto, luz, água, internet, aluguel = "contas"
- cinema, bar, show, netflix, viagem = "lazer"
- farmácia, médico, dentista, academia = "saúde"
- curso, faculdade, livro = "educação"
- roupa, calçado, loja = "vestuário"
- Se nenhuma se encaixar = "outros"

DESCRIÇÃO:
- Gere uma descrição curta e clara: "Salário", "Uber pro trabalho", "Mercado semanal"
- NÃO inclua o valor na descrição
- Capitalize a primeira letra`
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
        console.error('⚠️ Azure OpenAI NLP: resposta não é JSON:', content);
        return this.fallbackResult(message);
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        intention: parsed.intention || 'unknown',
        originalText: message,
        confidence: parsed.confidence || 0.85,
        extracted: {
          type: parsed.extracted?.type || parsed.intention,
          amount: parsed.extracted?.amount || null,
          category: parsed.extracted?.category || 'outros',
          description: parsed.extracted?.description || message,
          date: new Date()
        },
        source: 'azure_openai'
      };

    } catch (error) {
      console.error('❌ Azure OpenAI NLP erro:', error.message);
      return this.fallbackResult(message);
    }
  }

  fallbackResult(message) {
    return {
      intention: 'unknown',
      originalText: message,
      confidence: 0,
      extracted: { type: 'unknown' },
      source: 'azure_openai_error'
    };
  }
}

module.exports = AzureOpenAINLPService;
