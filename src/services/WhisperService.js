const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

// NOTA: Não precisa de ffmpeg! O Whisper API aceita OGG/Opus diretamente,
// que é o formato nativo de áudio do WhatsApp.

class WhisperService {
  constructor() {
    console.log(
      "🔑 WhisperService: Chave OpenAI carregada:",
      process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.substring(0, 8) + "..." : "NÃO CONFIGURADA"
    );
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async processWhatsAppAudio(audioBuffer) {
    let tempPath = null;
    try {
      // Salvar buffer como arquivo temporário OGG (Whisper aceita OGG diretamente!)
      const tempDir = path.join(__dirname, "../../temp");
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      tempPath = path.join(tempDir, `audio_${Date.now()}.ogg`);
      fs.writeFileSync(tempPath, audioBuffer);

      console.log(`🎤 Áudio salvo: ${tempPath} (${audioBuffer.length} bytes)`);

      // Enviar diretamente para Whisper (aceita OGG/Opus nativamente)
      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(tempPath),
        model: "whisper-1",
        language: "pt",
        response_format: "text",
      });

      const text = typeof transcription === 'string' ? transcription.trim() : String(transcription).trim();
      console.log(`🎤 Transcrição Whisper: "${text}"`);

      if (!text || text.length === 0) {
        return {
          success: false,
          error: "Áudio vazio ou inaudível",
          transcription: "",
          extracted: null,
        };
      }

      const extracted = this.parseFinancialCommand(text);

      return { success: true, transcription: text, extracted, confidence: "high" };
    } catch (error) {
      console.error("❌ WhisperService erro:", error.message);
      return {
        success: false,
        error: error.message,
        transcription: "",
        extracted: null,
      };
    } finally {
      // Limpar arquivo temporário
      if (tempPath && fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (e) { /* ignore */ }
      }
    }
  }

  parseFinancialCommand(text) {
    const extracted = {
      amount: null,
      establishment: null,
      category: "outros",
      description: text,
      type: "expense",
      confidence: "medium",
    };

    // Detectar se é receita
    if (/\b(receb[ei]|ganhei|entrou|salário|salario|freelance|renda)\b/i.test(text)) {
      extracted.type = "income";
    }

    // Extrair valor com suporte a K
    const valuePatterns = [
      /(?:gastei|comprei|paguei|pago|pix\s+de|transferi|mandei|enviei|recebi|ganhei)\s+(?:r\$?\s*)?(\d+(?:[,\.]\d{1,2})?)\s*([kK])?/gi,
      /r\$?\s*(\d+(?:[,\.]\d{1,2})?)\s*([kK])?/gi,
      /(\d+(?:[,\.]\d{1,2})?)\s*([kK])?\s+(?:reais|no|na|do|da|em|pro|pra)/gi,
    ];

    for (const pattern of valuePatterns) {
      const match = [...text.matchAll(pattern)][0];
      if (match) {
        let amount = parseFloat(match[1].replace(",", "."));
        if (match[2] && match[2].toLowerCase() === 'k') {
          amount *= 1000;
        }
        if (amount > 0 && amount < 100000) {
          extracted.amount = amount;
          break;
        }
      }
    }

    extracted.establishment = this.extractEstablishment(text);
    extracted.category = this.determineCategory(extracted.establishment, text);
    extracted.confidence = this.calculateConfidence(extracted, text);

    return extracted;
  }

  extractEstablishment(text) {
    const pattern = /(?:no|na|do|da|pro|pra)\s+([a-záàâãçéêíóôõú\s]+)/i;
    const match = text.match(pattern);
    if (!match) return null;
    let est = match[1]
      .trim()
      .replace(/\b(de|da|do|na|no|com|para|e|a|o)\b/gi, "")
      .trim();
    if (est.length < 2) return null;
    return est.charAt(0).toUpperCase() + est.slice(1).toLowerCase();
  }

  determineCategory(establishment, text) {
    const lowerText = ((establishment || "") + " " + text).toLowerCase();
    const categories = {
      alimentação: ["mercado", "supermercado", "restaurante", "lanchonete", "padaria", "pizza", "hambúrguer", "comida", "almoço", "jantar", "café"],
      saúde: ["farmácia", "drogaria", "médico", "hospital", "remédio", "dentista"],
      transporte: ["posto", "gasolina", "uber", "taxi", "ônibus", "metrô", "estacionamento"],
      transferência: ["pix", "transferência", "transferi", "mandei", "enviei"],
      contas: ["conta", "aluguel", "luz", "água", "internet", "telefone"],
      lazer: ["cinema", "bar", "festa", "show", "teatro", "netflix", "spotify"],
    };
    for (const [cat, keys] of Object.entries(categories))
      if (keys.some((k) => lowerText.includes(k))) return cat;
    return "outros";
  }

  calculateConfidence(extracted, text) {
    let score = 0;
    if (extracted.amount) score += 0.5;
    if (extracted.establishment) score += 0.3;
    if (text.length > 10) score += 0.1;
    if (extracted.category !== "outros") score += 0.1;
    if (score >= 0.8) return "high";
    if (score >= 0.5) return "medium";
    return "low";
  }

  generateConfirmationMessage(extracted) {
    if (!extracted || !extracted.amount) {
      return "❌ Não consegui entender o valor. Por favor, fale novamente ou digite o comando manualmente.";
    }
    const amountFormatted = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(extracted.amount);

    const typeLabel = extracted.type === 'income' ? '💵 Receita' : '💸 Despesa';

    let msg = `🎤 *Dados extraídos do áudio:*\n\n`;
    msg += `${typeLabel}\n`;
    msg += `💰 *Valor:* ${amountFormatted}\n`;
    if (extracted.establishment) {
      msg += `🏪 *Local:* ${extracted.establishment}\n`;
    }
    msg += `📂 *Categoria:* ${extracted.category}\n`;
    msg += `📝 *Transcrição:* "${extracted.description}"\n\n`;

    if (extracted.confidence === "low") {
      msg += "⚠️ Confiança baixa — verifique os dados.\n\n";
    }
    msg += "✅ Confirma o registro? (sim/não)";

    return msg;
  }
}

module.exports = WhisperService;
