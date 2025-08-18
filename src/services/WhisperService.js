const OpenAI = require("openai");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const fs = require("fs");
const path = require("path");

ffmpeg.setFfmpegPath(ffmpegStatic);

class WhisperService {
  constructor() {
    console.log(
      "🔑 Chave OpenAI carregada:",
      process.env.OPENAI_API_KEY?.substring(0, 20) + "..."
    );
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async processWhatsAppAudio(audioBuffer) {
    try {
      const convertedPath = await this.convertAudio(audioBuffer);
      const transcription = await this.transcribeWithWhisper(convertedPath);
      const extracted = this.parseFinancialCommand(transcription);
      this.cleanupTempFiles([convertedPath]);

      return { success: true, transcription, extracted, confidence: "high" };
    } catch (error) {
      console.error("❌ Erro no processamento de áudio:", error);
      return {
        success: false,
        error: error.message,
        transcription: "",
        extracted: null,
      };
    }
  }

  async convertAudio(inputBuffer) {
    return new Promise((resolve, reject) => {
      const tempInputPath = path.join(
        __dirname,
        "../../temp",
        `input_${Date.now()}.ogg`
      );
      const tempOutputPath = path.join(
        __dirname,
        "../../temp",
        `output_${Date.now()}.mp3`
      );
      if (!fs.existsSync(path.dirname(tempInputPath)))
        fs.mkdirSync(path.dirname(tempInputPath), { recursive: true });
      fs.writeFileSync(tempInputPath, inputBuffer);

      ffmpeg(tempInputPath)
        .toFormat("mp3")
        .audioFrequency(16000)
        .audioChannels(1)
        .audioBitrate(64)
        .on("error", (err) => {
          this.cleanupTempFiles([tempInputPath, tempOutputPath]);
          reject(err);
        })
        .on("end", () => {
          this.cleanupTempFiles([tempInputPath]);
          resolve(tempOutputPath);
        })
        .save(tempOutputPath);
    });
  }

  async transcribeWithWhisper(audioFilePath) {
    const transcription = await this.openai.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: "whisper-1",
      language: "pt",
      response_format: "text",
    });
    return transcription.trim();
  }

  parseFinancialCommand(text) {
    const extracted = {
      amount: null,
      establishment: null,
      category: "outros",
      description: text,
      confidence: "medium",
    };

    const valuePatterns = [
      /(?:gastei|comprei|paguei|pago)\s+(\d+(?:[,\.]\d{1,2})?)/gi,
      /(\d+(?:[,\.]\d{1,2})?)\s+(?:no|na|do|da|em)/gi,
      /r\$?\s*(\d+(?:[,\.]\d{1,2})?)/gi,
    ];
    for (const pattern of valuePatterns) {
      const match = [...text.matchAll(pattern)][0];
      if (match) {
        const amount = parseFloat(match[1].replace(",", "."));
        if (amount > 0 && amount < 50000) {
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
    const pattern = /(?:no|na|do|da)\s+([a-záàâãçéêíóôõú\s]+)/i;
    const match = text.match(pattern);
    if (!match) return "Estabelecimento não identificado";
    let est = match[1]
      .trim()
      .replace(/\b(de|da|do|na|no|com|para|e|a|o)\b/gi, "")
      .trim();
    return est.charAt(0).toUpperCase() + est.slice(1).toLowerCase();
  }

  determineCategory(establishment, text) {
    const lowerText = (establishment + " " + text).toLowerCase();
    const categories = {
      alimentação: [
        "mercado",
        "supermercado",
        "restaurante",
        "lanchonete",
        "padaria",
        "pizza",
        "hambúrguer",
        "comida",
      ],
      saúde: ["farmácia", "drogaria", "médico", "hospital", "remédio"],
      transporte: ["posto", "gasolina", "uber", "taxi", "ônibus", "metrô"],
      vestuário: ["roupa", "calça", "camisa", "sapato", "loja"],
      casa: ["casa", "construção", "tinta", "ferramenta"],
      lazer: ["cinema", "bar", "festa", "show", "teatro"],
      serviços: ["salão", "barbeiro", "mecânico", "lavanderia"],
    };
    for (const [cat, keys] of Object.entries(categories))
      if (keys.some((k) => lowerText.includes(k))) return cat;
    return "outros";
  }

  calculateConfidence(extracted, text) {
    let score = 0;
    if (extracted.amount) score += 0.5;
    if (extracted.establishment !== "Estabelecimento não identificado")
      score += 0.3;
    if (text.length > 10) score += 0.1;
    if (extracted.category !== "outros") score += 0.1;
    if (score >= 0.8) return "high";
    if (score >= 0.5) return "medium";
    return "low";
  }

  generateConfirmationMessage(extracted) {
    if (!extracted.amount)
      return "❌ Não consegui entender o valor. Por favor, fale novamente ou digite o comando manualmente.";
    const amountFormatted = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(extracted.amount);
    return `🎤 **DADOS EXTRAÍDOS DO ÁUDIO**\n💰 **Valor:** ${amountFormatted}\n🏪 **Estabelecimento:** ${
      extracted.establishment
    }\n📂 **Categoria:** ${extracted.category}\n📝 **Transcrição:** "${
      extracted.description
    }"\n\n${
      extracted.confidence === "low"
        ? "⚠️ Confiança baixa, confirme os dados."
        : "✅ Confirme este gasto?"
    }`;
  }

  cleanupTempFiles(paths) {
    paths.forEach((p) => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
  }
}

module.exports = WhisperService;
