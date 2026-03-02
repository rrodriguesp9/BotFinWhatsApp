const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Goal = require('../models/Goal');
const Cofrinho = require('../models/Cofrinho');
const NaturalLanguageProcessor = require('../services/NaturalLanguageProcessor');
const OCRService = require('../services/OCRService');
const WhatsAppService = require('../services/WhatsAppService');
const ReportService = require('../services/ReportService');

// Google Calendar — integração opcional
let GoogleCalendarService = null;
try {
  GoogleCalendarService = require('../services/GoogleCalendarService');
} catch (e) {
  console.log('⚠️ GoogleCalendarService não disponível:', e.message);
}

// Whisper (áudio) — via Groq (grátis) ou OpenAI (pago)
let WhisperService = null;
try {
  WhisperService = require('../services/WhisperService');
} catch (e) {
  console.log('⚠️ WhisperService não disponível:', e.message);
}

// Gemini OCR — leitura de notas fiscais via Gemini Vision (grátis)
let GeminiOCRService = null;
try {
  GeminiOCRService = require('../services/GeminiOCRService');
} catch (e) {
  console.log('⚠️ GeminiOCRService não disponível:', e.message);
}

// OpenAI OCR — fallback para leitura de notas fiscais via GPT Vision (pago)
let OpenAIOCRService = null;
try {
  OpenAIOCRService = require('../services/OpenAIOCRService');
} catch (e) {
  console.log('⚠️ OpenAIOCRService não disponível:', e.message);
}

// Groq NLP — fallback inteligente quando regex não entende (grátis)
let GroqNLPService = null;
try {
  GroqNLPService = require('../services/GroqNLPService');
} catch (e) {
  console.log('⚠️ GroqNLPService não disponível:', e.message);
}

// OpenAI NLP — fallback secundário (pago)
let OpenAINLPService = null;
try {
  OpenAINLPService = require('../services/OpenAINLPService');
} catch (e) {
  console.log('⚠️ OpenAINLPService não disponível:', e.message);
}

class BotController {
  constructor() {
    this.nlp = new NaturalLanguageProcessor();
    this.ocr = new OCRService();
    this.whatsapp = new WhatsAppService();
    this.report = new ReportService();

    // Whisper (áudio) — via Groq (grátis) ou OpenAI (pago)
    if (WhisperService && (process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY)) {
      try {
        this.whisperService = new WhisperService();
      } catch (e) {
        this.whisperService = null;
        console.log('⚠️ WhisperService falhou ao instanciar:', e.message);
      }
    } else {
      this.whisperService = null;
      console.log('⚠️ WhisperService desativado (configure GROQ_API_KEY ou OPENAI_API_KEY)');
    }

    // OCR para notas fiscais — Gemini (grátis, primário) ou OpenAI Vision (pago, fallback)
    if (GeminiOCRService && process.env.GEMINI_API_KEY) {
      this.visionOCR = new GeminiOCRService();
      console.log('✅ Gemini Vision OCR (leitura de notas — grátis) ativado');
    } else if (OpenAIOCRService && process.env.OPENAI_API_KEY) {
      this.visionOCR = new OpenAIOCRService();
      console.log('✅ OpenAI Vision OCR (leitura de notas — pago) ativado');
    } else {
      this.visionOCR = null;
      console.log('⚠️ Vision OCR desativado (configure GEMINI_API_KEY ou OPENAI_API_KEY)');
    }

    // NLP fallback — Groq (grátis, primário) ou OpenAI (pago, fallback)
    if (GroqNLPService && process.env.GROQ_API_KEY) {
      this.aiNLP = new GroqNLPService();
      console.log('✅ Groq NLP (fallback inteligente — grátis) ativado');
    } else if (OpenAINLPService && process.env.OPENAI_API_KEY) {
      this.aiNLP = new OpenAINLPService();
      console.log('✅ OpenAI NLP (fallback inteligente — pago) ativado');
    } else {
      this.aiNLP = null;
      console.log('⚠️ NLP AI desativado (configure GROQ_API_KEY ou OPENAI_API_KEY)');
    }

    // Google Calendar — integração opcional
    if (GoogleCalendarService && process.env.GOOGLE_CLIENT_ID) {
      try {
        this.calendar = new GoogleCalendarService();
        console.log('✅ Google Calendar ativado');
      } catch (e) {
        this.calendar = null;
        console.log('⚠️ GoogleCalendarService falhou ao instanciar:', e.message);
      }
    } else {
      this.calendar = null;
      console.log('⚠️ Google Calendar desativado (configure GOOGLE_CLIENT_ID)');
    }

    // Cache de sessões ativas
    this.sessions = new Map();
  }

  // Processar mensagem recebida
  async processMessage(phoneNumber, message, mediaUrl = null) {
    try {
      console.log(`📱 Processando mensagem de ${phoneNumber}: ${message}`);
      
      // Buscar ou criar usuário
      let user = await User.findByPhone(phoneNumber);
      if (!user) {
        user = await User.create(phoneNumber);
        // Iniciar fluxo de onboarding
        this.sessions.set(phoneNumber, {
          type: 'onboarding',
          step: 'awaiting_name',
          timestamp: Date.now()
        });
        await this.sendMessage(phoneNumber,
          `🤖 *Bem-vindo ao AgendaCash!*\n\n` +
          `Sou seu assistente financeiro via WhatsApp.\n\n` +
          `Para começar, qual é o seu nome?`);
        return;
      }

      // Verificar se está em modo silencioso
      if (user.isInSilentMode()) {
        console.log(`🔕 Usuário ${phoneNumber} em modo silencioso`);
        return;
      }

      // Processar mídia se fornecida
      if (mediaUrl) {
        return await this.processMediaMessage(user, mediaUrl);
      }

      // Processar texto
      return await this.processTextMessage(user, message);
      
    } catch (error) {
      console.error('❌ Erro ao processar mensagem:', error);
      await this.sendErrorMessage(phoneNumber);
    }
  }

  // Processar mensagem de texto
  async processTextMessage(user, message) {
    try {
      // Expirar sessões antigas (5 minutos)
      const session = this.sessions.get(user.phoneNumber);
      if (session && (Date.now() - session.timestamp) > 5 * 60 * 1000) {
        this.sessions.delete(user.phoneNumber);
      }

      // Verificar sessões pendentes em ordem de prioridade
      const currentSession = this.sessions.get(user.phoneNumber);

      if (currentSession && currentSession.type === 'onboarding') {
        return await this.handleOnboarding(user, message, currentSession);
      }

      if (currentSession && currentSession.type === 'ocr_confirmation') {
        return await this.handleOcrConfirmation(user, message, currentSession);
      }

      if (currentSession && currentSession.type === 'audio_confirmation') {
        return await this.handleAudioConfirmation(user, message, currentSession);
      }

      if (currentSession && currentSession.type === 'pin_setup') {
        return await this.handlePinSetup(user, message, currentSession);
      }

      if (currentSession && currentSession.type === 'pin_verification') {
        return await this.handlePinVerification(user, message, currentSession);
      }

      return await this.processTextMessageInternal(user, message);

    } catch (error) {
      console.error('❌ Erro ao processar texto:', error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // Lógica interna de processamento NLP (separada para reuso no fallback de OCR)
  async processTextMessageInternal(user, message) {
    // Processar linguagem natural (regex primeiro)
    let intent = this.nlp.processMessage(message);
    console.log('🧠 Regex NLP:', intent.intention, 'confidence:', intent.confidence);

    // Se regex não entendeu ou confiança baixa, tentar IA (Groq/OpenAI)
    if ((intent.intention === 'unknown' || intent.confidence < 0.4) && this.aiNLP) {
      console.log('🤖 Tentando NLP AI fallback...');
      const aiIntent = await this.aiNLP.processMessage(message);
      console.log('🤖 NLP AI:', aiIntent.intention, 'confidence:', aiIntent.confidence);
      if (aiIntent.intention !== 'unknown' && aiIntent.confidence > intent.confidence) {
        intent = aiIntent;
      }
    }

    // Executar ação baseada na intenção
    switch (intent.intention) {
      case 'income':
      case 'expense':
        return await this.handleTransaction(user, intent.extracted);

      case 'balance':
        return await this.handleBalanceQuery(user);

      case 'report':
        return await this.handleReportQuery(user, intent.extracted.period);

      case 'goal':
        return await this.handleGoalCreation(user, intent.extracted);

      case 'savings':
        return await this.handleSavingsGoal(user, intent.extracted);

      case 'calendar':
        return await this.handleCalendar(user, intent.extracted);

      case 'split':
        return await this.handleSplitExpense(user, intent.extracted);

      case 'export':
        return await this.handleExport(user, intent.extracted);

      case 'greeting':
        return await this.handleGreeting(user);

      case 'help':
        return await this.sendHelpMessage(user.phoneNumber);

      case 'silent':
        return await this.handleSilentMode(user, intent.extracted.days);

      default:
        return await this.handleUnknownCommand(user, message);
    }
  }

  // Processar mensagem de mídia
  async processMediaMessage(user, mediaUrl) {
    try {
      console.log(`📷 Processando mídia para ${user.phoneNumber}... (mediaId: ${mediaUrl})`);

      // Baixar imagem do WhatsApp
      let imageBuffer;
      try {
        imageBuffer = await this.whatsapp.downloadMedia(mediaUrl);
      } catch (downloadError) {
        console.error('❌ Falha ao baixar imagem:', downloadError.message);
        await this.sendMessage(user.phoneNumber,
          '❌ Não consegui baixar a imagem.\n' +
          'Tente enviar novamente ou digite o valor manualmente:\n' +
          'Exemplo: "gastei 50 no mercado"');
        return;
      }

      console.log(`📷 Imagem baixada: ${imageBuffer.length} bytes`);

      // Validar tamanho básico
      if (imageBuffer.length < 1024) {
        await this.sendMessage(user.phoneNumber, '❌ Imagem muito pequena. Envie uma foto mais clara.');
        return;
      }
      if (imageBuffer.length > 20 * 1024 * 1024) {
        await this.sendMessage(user.phoneNumber, '❌ Imagem muito grande (máx 20MB).');
        return;
      }

      let ocrResult = null;
      let confirmationMessage = null;

      // Estratégia 1: OpenAI Vision (primário — mais preciso, como ChatGPT)
      if (this.visionOCR) {
        try {
          console.log('🤖 Usando Vision AI para ler nota fiscal...');
          ocrResult = await this.visionOCR.processImage(imageBuffer);
          console.log('🤖 Vision AI resultado:', ocrResult.success ? 'sucesso' : `falha: ${ocrResult.error}`);

          if (ocrResult.success) {
            confirmationMessage = this.visionOCR.generateConfirmationMessage(ocrResult.extracted);
          }
        } catch (visionError) {
          console.error('❌ Vision AI exceção:', visionError.message);
          ocrResult = null;
        }
      } else {
        console.log('⚠️ Vision OCR não está ativo (configure GEMINI_API_KEY ou OPENAI_API_KEY)');
      }

      // Estratégia 2: Tesseract (fallback — gratuito, sem API)
      if (!ocrResult || !ocrResult.success) {
        console.log('📷 Tentando Tesseract OCR como fallback...');
        try {
          ocrResult = await Promise.race([
            this.ocr.processImage(imageBuffer),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Tesseract timeout (30s)')), 30000)
            )
          ]);

          if (ocrResult.success) {
            confirmationMessage = this.ocr.generateConfirmationMessage(ocrResult.extracted);
          }
        } catch (tesseractError) {
          console.error('⚠️ Tesseract falhou:', tesseractError.message);
        }
      }

      // Nenhum OCR funcionou
      if (!ocrResult || !ocrResult.success) {
        await this.sendMessage(user.phoneNumber,
          '❌ Não consegui ler a nota fiscal.\n\n' +
          'Tente:\n' +
          '• Enviar uma foto mais clara e bem iluminada\n' +
          '• Ou digitar o valor manualmente: "gastei 50 no mercado"');
        return;
      }

      // Verificar se extraiu valor
      if (!ocrResult.extracted || !ocrResult.extracted.amount) {
        await this.sendMessage(user.phoneNumber,
          '⚠️ Li a imagem mas não encontrei o valor total.\n\n' +
          'Por favor, digite o valor manualmente:\n' +
          'Exemplo: "gastei 50 no mercado"');
        return;
      }

      // Enviar confirmação
      await this.sendMessage(user.phoneNumber, confirmationMessage);

      // Salvar dados temporários para confirmação
      this.sessions.set(user.phoneNumber, {
        type: 'ocr_confirmation',
        data: ocrResult.extracted,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('❌ Erro ao processar mídia:', error.message, error.stack);
      await this.sendMessage(user.phoneNumber,
        '❌ Erro ao processar imagem. Tente novamente ou digite o valor manualmente.');
    }
  }

  // Lidar com confirmação de OCR (sim/não)
  async handleOcrConfirmation(user, message, session) {
    const response = message.toLowerCase().trim();
    this.sessions.delete(user.phoneNumber);

    if (response === 'sim' || response === 's') {
      const data = session.data;
      await this.handleTransaction(user, {
        type: 'expense',
        amount: data.amount,
        category: data.category || 'outros',
        description: data.description || 'Transação via OCR',
        date: data.date || new Date(),
        source: 'image'
      });
    } else if (response === 'não' || response === 'nao' || response === 'n') {
      await this.sendMessage(user.phoneNumber,
        '❌ **Transação cancelada.**\n\n' +
        'Você pode digitar o valor manualmente.\n' +
        'Exemplo: "gastei 50 no mercado"');
    } else {
      // Não era sim/não - reprocessar como mensagem normal
      return await this.processTextMessageInternal(user, message);
    }
  }

  // Lidar com transação
  async handleTransaction(user, transactionData) {
    try {
      // Validar dados
      const errors = Transaction.validate({
        userId: user.id,
        ...transactionData
      });
      
      if (errors.length > 0) {
        await this.sendMessage(user.phoneNumber,
          `❌ **Dados inválidos:**\n\n` +
          `${errors.join('\n')}\n\n` +
          `Exemplo: "gastei 50 no mercado"`);
        return;
      }

      // Criar transação
      const transaction = await Transaction.create({
        userId: user.id,
        ...transactionData
      });

      // Obter saldo atualizado
      const newBalance = await Transaction.getCurrentBalance(user.id);

      // Verificar metas
      const goal = await Goal.findByCategory(user.id, transactionData.category);
      let goalMessage = '';

      if (goal) {
        const progress = await goal.calculateProgress();
        if (progress.shouldAlert) {
          goalMessage = '\n\n' + await goal.generateAlertMessage();

          // Lembrete no Google Calendar (não bloqueia)
          if (progress.percentage >= 100) {
            this._tryCalendarReminder(user.id, 'goal_exceeded', { goal, totalGasto: progress.currentSpent });
          } else if (progress.percentage >= 80) {
            this._tryCalendarReminder(user.id, 'goal_80', { goal });
          }
        }
      }

      // Enviar confirmação
      const amountFormatted = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      }).format(transactionData.amount);

      const balanceFormatted = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      }).format(newBalance);

      const message = `${transactionData.type === 'income' ? '💵' : '💸'} **${transactionData.type === 'income' ? 'Receita' : 'Despesa'} registrada!**\n\n` +
                     `💰 **Valor:** ${amountFormatted}\n` +
                     `📂 **Categoria:** ${transactionData.category}\n` +
                     `📝 **Descrição:** ${transactionData.description}\n` +
                     `💳 **Saldo atual:** ${balanceFormatted}${goalMessage}`;

      await this.sendMessage(user.phoneNumber, message);

    } catch (error) {
      console.error('❌ Erro ao criar transação:', error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // Lidar com consulta de saldo
  async handleBalanceQuery(user) {
    try {
      const balance = await Transaction.getCurrentBalance(user.id);
      const balanceFormatted = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      }).format(balance);

      const message = `💳 **SEU SALDO ATUAL**\n\n` +
                     `💰 **Disponível:** ${balanceFormatted}\n\n` +
                     `💡 **Dica:** Envie "resumo da semana" para ver suas movimentações.`;

      await this.sendMessage(user.phoneNumber, message);

    } catch (error) {
      console.error('❌ Erro ao consultar saldo:', error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // Lidar com relatório
  async handleReportQuery(user, period = 'month') {
    try {
      const transactions = await Transaction.findByUser(user.id, {
        startDate: Transaction.getPeriodStartDate(period)
      });

      if (transactions.length === 0) {
        await this.sendMessage(user.phoneNumber,
          `📊 **RELATÓRIO ${period.toUpperCase()}**\n\n` +
          `Nenhuma transação encontrada neste período.`);
        return;
      }

      // Calcular estatísticas
      const stats = await Transaction.getCategoryStats(user.id, period);
      const totalIncome = transactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);
      const totalExpense = transactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);

      let message = `📊 **RELATÓRIO ${period.toUpperCase()}**\n\n`;
      
      if (totalIncome > 0) {
        message += `💵 **Receitas:** ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalIncome)}\n`;
      }
      
      if (totalExpense > 0) {
        message += `💸 **Despesas:** ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalExpense)}\n`;
      }
      
      message += `\n📂 **Por Categoria:**\n`;
      
      Object.entries(stats).forEach(([category, data]) => {
        if (data.total > 0) {
          message += `• ${category}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(data.total)}\n`;
        }
      });

      message += `\n💡 **Dica:** Envie "exporte em PDF" para baixar o relatório completo.`;

      await this.sendMessage(user.phoneNumber, message);

    } catch (error) {
      console.error('❌ Erro ao gerar relatório:', error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // Lidar com criação de meta
  async handleGoalCreation(user, goalData) {
    try {
      const errors = Goal.validate({
        userId: user.id,
        ...goalData
      });

      if (errors.length > 0) {
        await this.sendMessage(user.phoneNumber,
          `❌ **Erro ao criar meta:**\n\n` +
          `${errors.join('\n')}\n\n` +
          `Exemplo: "meta de mercado 600"`);
        return;
      }

      // Verificar se já existe meta para esta categoria
      const existingGoal = await Goal.findByCategory(user.id, goalData.category);
      if (existingGoal) {
        await existingGoal.update({ monthlyLimit: goalData.limit });
        await this.sendMessage(user.phoneNumber,
          `✅ **Meta atualizada!**\n\n` +
          `📂 **Categoria:** ${goalData.category}\n` +
          `💰 **Limite:** ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(goalData.limit)}\n\n` +
          `Receberá alertas quando atingir 80% do limite.`);
      } else {
        const goal = await Goal.create({
          userId: user.id,
          ...goalData
        });

        await this.sendMessage(user.phoneNumber,
          `🎯 **Meta criada com sucesso!**\n\n` +
          `📂 **Categoria:** ${goalData.category}\n` +
          `💰 **Limite mensal:** ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(goalData.limit)}\n\n` +
          `Receberá alertas quando atingir 80% do limite.`);
      }

    } catch (error) {
      console.error('❌ Erro ao criar meta:', error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // Lidar com cofrinho — dispatcher
  async handleSavingsGoal(user, savingsData) {
    try {
      const action = savingsData.action || 'create';
      switch (action) {
        case 'create':
          return await this.handleCofrinhoCreate(user, savingsData);
        case 'add':
          return await this.handleCofrinhoAdd(user, savingsData);
        case 'withdraw':
          return await this.handleCofrinhoWithdraw(user, savingsData);
        case 'list':
          return await this.handleCofrinhoList(user);
        case 'view':
          return await this.handleCofrinhoView(user, savingsData);
        default:
          return await this.handleCofrinhoCreate(user, savingsData);
      }
    } catch (error) {
      console.error('❌ Erro no cofrinho:', error);
      await this.sendMessage(user.phoneNumber,
        `❌ Erro: ${error.message || 'Erro ao processar cofrinho'}`);
    }
  }

  async handleCofrinhoCreate(user, data) {
    const cofrinho = await Cofrinho.create({
      userId: user.id,
      nome: data.name,
      meta: data.target,
      prazo: data.prazo || null,
      categoria: data.categoria || 'economia',
      descricao: data.descricao || ''
    });

    await this.sendMessage(user.phoneNumber,
      `💰 *Cofrinho criado!*\n\n` +
      `🏷️ *Nome:* ${cofrinho.nome}\n` +
      `🎯 *Meta:* ${Cofrinho.formatarMoeda(cofrinho.meta)}\n\n` +
      `Para adicionar dinheiro:\n` +
      `"adicionar 100 ao cofrinho ${cofrinho.nome}"`);
  }

  async handleCofrinhoAdd(user, data) {
    const cofrinho = await Cofrinho.findByName(user.id, data.name);
    if (!cofrinho) {
      await this.sendMessage(user.phoneNumber,
        `❌ Cofrinho "${data.name}" não encontrado.\n` +
        `Digite "meus cofrinhos" para ver seus cofrinhos.`);
      return;
    }

    await cofrinho.adicionarValor(data.amount, 'Depósito via chat');
    const progresso = cofrinho.calcularProgresso();

    // Lembrete no Google Calendar (não bloqueia)
    if (progresso.atingido) {
      this._tryCalendarReminder(user.id, 'cofrinho_meta', { cofrinho });
    } else if (parseFloat(progresso.percentual) >= 80) {
      this._tryCalendarReminder(user.id, 'cofrinho_80', { cofrinho });
    }

    await this.sendMessage(user.phoneNumber,
      `✅ *Depósito realizado!*\n\n` +
      `🏷️ *Cofrinho:* ${cofrinho.nome}\n` +
      `💵 *Depositado:* ${Cofrinho.formatarMoeda(data.amount)}\n` +
      `💰 *Total guardado:* ${Cofrinho.formatarMoeda(cofrinho.valorAtual)}\n` +
      `📊 *Progresso:* ${progresso.percentual}%\n` +
      (progresso.atingido ? `🎉 *Meta atingida!*` : `📉 *Faltam:* ${Cofrinho.formatarMoeda(progresso.faltam)}`));
  }

  async handleCofrinhoWithdraw(user, data) {
    const cofrinho = await Cofrinho.findByName(user.id, data.name);
    if (!cofrinho) {
      await this.sendMessage(user.phoneNumber,
        `❌ Cofrinho "${data.name}" não encontrado.\n` +
        `Digite "meus cofrinhos" para ver seus cofrinhos.`);
      return;
    }

    await cofrinho.retirarValor(data.amount, 'Retirada via chat');
    const progresso = cofrinho.calcularProgresso();

    await this.sendMessage(user.phoneNumber,
      `✅ *Retirada realizada!*\n\n` +
      `🏷️ *Cofrinho:* ${cofrinho.nome}\n` +
      `💸 *Retirado:* ${Cofrinho.formatarMoeda(data.amount)}\n` +
      `💰 *Saldo restante:* ${Cofrinho.formatarMoeda(cofrinho.valorAtual)}\n` +
      `📊 *Progresso:* ${progresso.percentual}%`);
  }

  async handleCofrinhoList(user) {
    const cofrinhos = await Cofrinho.findByUser(user.id);
    if (cofrinhos.length === 0) {
      await this.sendMessage(user.phoneNumber,
        `💰 Você ainda não tem cofrinhos.\n\n` +
        `Para criar: "cofrinho viagem 2000"`);
      return;
    }

    const resumo = await Cofrinho.obterResumoUsuario(user.id);
    let msg = `💰 *Seus Cofrinhos (${cofrinhos.length})*\n`;
    msg += `💵 Total guardado: ${Cofrinho.formatarMoeda(resumo.totalGuardado)}\n\n`;

    cofrinhos.forEach((c, i) => {
      const prog = c.calcularProgresso();
      msg += `${i + 1}. *${c.nome}*\n`;
      msg += `   ${Cofrinho.formatarMoeda(c.valorAtual)} / ${Cofrinho.formatarMoeda(c.meta)} (${prog.percentual}%)\n`;
    });

    msg += `\nPara detalhes: "ver cofrinho <nome>"`;
    await this.sendMessage(user.phoneNumber, msg);
  }

  async handleCofrinhoView(user, data) {
    const cofrinho = await Cofrinho.findByName(user.id, data.name);
    if (!cofrinho) {
      await this.sendMessage(user.phoneNumber,
        `❌ Cofrinho "${data.name}" não encontrado.\n` +
        `Digite "meus cofrinhos" para ver seus cofrinhos.`);
      return;
    }

    await this.sendMessage(user.phoneNumber, cofrinho.gerarRelatorio());
  }

  // Lidar com calendário
  async handleCalendar(user, calendarData) {
    if (!this.calendar) {
      await this.sendMessage(user.phoneNumber,
        `⚠️ Google Calendar não está configurado.\n` +
        `Solicite ao administrador que configure as credenciais do Google.`);
      return;
    }

    try {
      if (calendarData.action === 'disconnect') {
        await User.updateGoogleTokens(user.id, null);
        await this.sendMessage(user.phoneNumber,
          `✅ *Calendário desconectado!*\n\n` +
          `Sua conta Google foi desvinculada.`);
      } else {
        // connect — gerar URL OAuth
        const authUrl = this.calendar.generateAuthUrl(user.id);
        await this.sendMessage(user.phoneNumber,
          `📅 *Conectar Google Calendar*\n\n` +
          `Clique no link abaixo para autorizar:\n${authUrl}\n\n` +
          `Após autorizar, seus compromissos serão sincronizados automaticamente.`);
      }
    } catch (error) {
      console.error('❌ Erro no calendário:', error);
      await this.sendMessage(user.phoneNumber, `❌ Erro ao processar calendário: ${error.message}`);
    }
  }

  // Lidar com divisão de despesas
  async handleSplitExpense(user, splitData) {
    try {
      const myShare = splitData.totalAmount / splitData.people;
      
      // Registrar apenas a parte do usuário
      await Transaction.create({
        userId: user.id,
        type: 'expense',
        amount: myShare,
        category: 'outros',
        description: `${splitData.description} (dividido por ${splitData.people})`,
        date: new Date()
      });

      await this.sendMessage(user.phoneNumber,
        `🧮 **Despesa dividida registrada!**\n\n` +
        `📝 **Descrição:** ${splitData.description}\n` +
        `💰 **Total:** ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(splitData.totalAmount)}\n` +
        `👥 **Dividido por:** ${splitData.people} pessoas\n` +
        `💸 **Sua parte:** ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(myShare)}`);

    } catch (error) {
      console.error('❌ Erro ao dividir despesa:', error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // Lidar com exportação — pede PIN antes de enviar
  async handleExport(user, exportData) {
    try {
      // Se usuário não tem PIN cadastrado, pedir para criar primeiro
      if (!user.pinHash) {
        this.sessions.set(user.phoneNumber, {
          type: 'pin_setup',
          action: 'export',
          params: exportData,
          timestamp: Date.now()
        });
        await this.sendMessage(user.phoneNumber,
          `🔒 Você ainda não tem um PIN de segurança.\n\n` +
          `Crie um *PIN de 4 dígitos* para proteger suas informações:`);
        return;
      }

      this.sessions.set(user.phoneNumber, {
        type: 'pin_verification',
        action: 'export',
        params: exportData,
        timestamp: Date.now()
      });
      await this.sendMessage(user.phoneNumber,
        `🔒 Para exportar seus dados, digite seu *PIN de 4 dígitos*:`);
    } catch (error) {
      console.error('❌ Erro ao solicitar PIN:', error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // Cadastro de PIN (usuário não tem PIN ainda)
  async handlePinSetup(user, message, session) {
    const pin = message.trim();

    if (!/^\d{4}$/.test(pin)) {
      await this.sendMessage(user.phoneNumber,
        'O PIN deve ter exatamente *4 dígitos numéricos*.\nExemplo: 1234');
      return; // mantém a sessão ativa para nova tentativa
    }

    // Salvar o PIN
    await user.updatePin(pin);
    this.sessions.delete(user.phoneNumber);

    await this.sendMessage(user.phoneNumber,
      `✅ *PIN criado com sucesso!*\n\n` +
      `Agora executando sua operação...`);

    // Executar a operação pendente
    switch (session.action) {
      case 'export':
        return await this._executeExport(user, session.params);
      default:
        break;
    }
  }

  // Verificação de PIN
  async handlePinVerification(user, message, session) {
    const pin = message.trim();
    this.sessions.delete(user.phoneNumber);

    if (!/^\d{4}$/.test(pin)) {
      await this.sendMessage(user.phoneNumber,
        '❌ PIN inválido. Operação cancelada.\n' +
        'O PIN deve ter 4 dígitos numéricos.');
      return;
    }

    const isValid = await user.verifyPin(pin);
    if (!isValid) {
      await this.sendMessage(user.phoneNumber,
        '❌ PIN incorreto. Operação cancelada.');
      return;
    }

    // PIN correto — executar operação salva
    switch (session.action) {
      case 'export':
        return await this._executeExport(user, session.params);
      default:
        await this.sendMessage(user.phoneNumber, '✅ PIN verificado.');
    }
  }

  // Executar exportação após verificação de PIN
  async _executeExport(user, exportData) {
    try {
      const format = exportData.format || 'pdf';
      const period = exportData.period || 'month';

      await this.sendMessage(user.phoneNumber, '⏳ Gerando relatório...');

      const reportBuffer = await this.report.generateReport(user.id, format, period);
      await this.whatsapp.sendMedia(user.phoneNumber, reportBuffer, format);

      await this.sendMessage(user.phoneNumber,
        `📤 *Relatório enviado!*\n\n` +
        `📄 *Formato:* ${format.toUpperCase()}\n` +
        `📅 *Período:* ${period}\n\n` +
        `O arquivo foi enviado acima.`);
    } catch (error) {
      console.error('❌ Erro ao exportar:', error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // Lidar com modo silencioso
  async handleSilentMode(user, days) {
    try {
      await user.toggleSilentMode(days);
      
      const message = days ? 
        `🔕 **Modo silencioso ativado!**\n\n` +
        `Notificações pausadas por ${days} dias.\n` +
        `Para reativar, envie "ativar notificações".` :
        `🔔 **Notificações reativadas!**\n\n` +
        `Você voltará a receber alertas e relatórios.`;
      
      await this.sendMessage(user.phoneNumber, message);

    } catch (error) {
      console.error('❌ Erro ao alterar modo silencioso:', error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // Lidar com fluxo de onboarding (nome + PIN)
  async handleOnboarding(user, message, session) {
    const text = message.trim();

    if (session.step === 'awaiting_name') {
      // Validar nome (mínimo 2 caracteres, sem números)
      if (text.length < 2 || /\d/.test(text)) {
        await this.sendMessage(user.phoneNumber,
          'Por favor, digite um nome válido (mínimo 2 letras):');
        return;
      }

      const name = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
      await User.updateName(user.phoneNumber, name);

      this.sessions.set(user.phoneNumber, {
        type: 'onboarding',
        step: 'awaiting_pin',
        name: name,
        timestamp: Date.now()
      });

      await this.sendMessage(user.phoneNumber,
        `Prazer, *${name}*! 😊\n\n` +
        `Agora crie um *PIN de 4 dígitos* para proteger suas informações:`);
      return;
    }

    if (session.step === 'awaiting_pin') {
      if (!/^\d{4}$/.test(text)) {
        await this.sendMessage(user.phoneNumber,
          'O PIN deve ter exatamente *4 dígitos numéricos*.\nExemplo: 1234');
        return;
      }

      // Recarregar o usuário do banco para ter o objeto atualizado
      const updatedUser = await User.findByPhone(user.phoneNumber);
      await updatedUser.updatePin(text);

      this.sessions.delete(user.phoneNumber);

      const name = session.name || 'amigo';
      await this.sendMessage(user.phoneNumber,
        `✅ *Tudo pronto, ${name}!*\n\n` +
        `Seu AgendaCash está configurado. Veja o que posso fazer:\n\n` +
        `💰 "gastei 50 no mercado" — registrar despesa\n` +
        `💵 "recebi 3000 salário" — registrar receita\n` +
        `📊 "saldo" — ver saldo atual\n` +
        `📋 "relatório" — ver relatório\n` +
        `📷 Envie uma *foto de recibo* para extração automática\n` +
        `🎤 Envie um *áudio* dizendo o que gastou\n\n` +
        `Digite *ajuda* para ver todos os comandos.`);
      return;
    }
  }

  // Lidar com saudação
  async handleGreeting(user) {
    const name = user.name ? `, ${user.name}` : '';
    await this.sendMessage(user.phoneNumber,
      `Olá${name}! Como posso te ajudar? 😊\n\n` +
      `Exemplos rápidos:\n` +
      `💰 "gastei 50 no mercado"\n` +
      `💵 "recebi 3000 salário"\n` +
      `📊 "saldo"\n\n` +
      `Digite *ajuda* para ver todos os comandos.`);
  }

  // Lidar com confirmação de áudio (sim/não)
  async handleAudioConfirmation(user, message, session) {
    const response = message.toLowerCase().trim();
    this.sessions.delete(user.phoneNumber);

    if (response === 'sim' || response === 's') {
      const data = session.data;
      await this.handleTransaction(user, {
        type: data.type || 'expense',
        amount: data.amount,
        category: data.category || 'outros',
        description: data.description || 'Transação via áudio',
        date: data.date || new Date(),
        source: 'audio'
      });
    } else if (response === 'não' || response === 'nao' || response === 'n') {
      await this.sendMessage(user.phoneNumber,
        '❌ *Transação cancelada.*\n\n' +
        'Você pode digitar o valor manualmente.\n' +
        'Exemplo: "gastei 50 no mercado"');
    } else {
      // Não era sim/não - reprocessar como mensagem normal
      return await this.processTextMessageInternal(user, message);
    }
  }

  // Processar mensagem de áudio
  async processAudioMessage(phoneNumber, audioMediaId) {
    try {
      // Verificar se Whisper está disponível
      if (!this.whisperService) {
        console.log('⚠️ WhisperService não ativo — verifique OPENAI_API_KEY');
        await this.sendMessage(phoneNumber,
          '⚠️ Processamento de áudio não disponível no momento.\n' +
          'Por favor, envie sua mensagem como texto.\n\n' +
          'Exemplo: "gastei 50 no mercado"');
        return;
      }

      console.log(`🎤 Processando áudio de ${phoneNumber} (mediaId: ${audioMediaId})`);

      // Baixar áudio do WhatsApp
      let audioBuffer;
      try {
        audioBuffer = await this.whatsapp.downloadMedia(audioMediaId);
        console.log(`🎤 Áudio baixado: ${audioBuffer.length} bytes`);
      } catch (downloadError) {
        console.error('❌ Falha ao baixar áudio:', downloadError.message);
        await this.sendMessage(phoneNumber,
          '❌ Não consegui baixar o áudio.\n' +
          'Tente enviar novamente ou envie como texto.');
        return;
      }

      // Processar com Whisper (envia OGG diretamente, sem conversão)
      const result = await this.whisperService.processWhatsAppAudio(audioBuffer);
      console.log(`🎤 Whisper resultado: success=${result.success}, transcrição="${result.transcription || ''}"`);

      if (result.success) {
        // Se Whisper transcrever mas não extrair valor, usar OpenAI NLP
        if (!result.extracted || !result.extracted.amount) {
          console.log('🎤 Whisper transcreveu mas não extraiu valor, tentando NLP...');

          // Buscar usuário para usar processTextMessageInternal
          const user = await User.findByPhone(phoneNumber);
          if (user && result.transcription) {
            await this.sendMessage(phoneNumber,
              `🎤 *Transcrição:* "${result.transcription}"\n\n` +
              `Processando como texto...`);
            await this.processTextMessageInternal(user, result.transcription);
            return;
          }
        }

        const confirmationMessage = this.whisperService.generateConfirmationMessage(result.extracted);
        await this.sendMessage(phoneNumber, confirmationMessage);

        // Criar sessão de confirmação
        this.sessions.set(phoneNumber, {
          type: 'audio_confirmation',
          data: result.extracted,
          transcription: result.transcription,
          timestamp: Date.now()
        });
      } else {
        console.log('❌ Whisper falhou:', result.error);
        await this.sendMessage(phoneNumber,
          '❌ Não consegui processar o áudio.\n\n' +
          'Tente:\n' +
          '• Falar mais claramente\n' +
          '• Enviar em um ambiente mais silencioso\n' +
          '• Ou digitar o comando: "gastei 50 no mercado"');
      }
    } catch (error) {
      console.error('❌ Erro no processamento de áudio:', error.message, error.stack);
      await this.sendMessage(phoneNumber,
        '❌ Erro ao processar áudio. Tente novamente ou envie como texto.');
    }
  }

  // Lidar com comando desconhecido
  async handleUnknownCommand(user, message) {
    await this.sendMessage(user.phoneNumber,
      `❓ Não entendi o comando.\n\n` +
      `Exemplos do que posso fazer:\n` +
      `💰 "gastei 50 no mercado" — registrar despesa\n` +
      `💵 "recebi 3000 salário" — registrar receita\n` +
      `📊 "saldo" — ver saldo atual\n` +
      `📋 "relatório" — ver relatório\n\n` +
      `Digite *ajuda* para ver todos os comandos.`);
  }

  // Enviar mensagem de ajuda
  async sendHelpMessage(phoneNumber) {
    const helpMessage = this.nlp.generateHelpMessage();
    await this.sendMessage(phoneNumber, helpMessage);
  }

  // Enviar mensagem de erro
  async sendErrorMessage(phoneNumber) {
    await this.sendMessage(phoneNumber,
      `❌ **Erro interno**\n\n` +
      `Desculpe, ocorreu um erro. Tente novamente em alguns instantes.\n\n` +
      `Se o problema persistir, entre em contato com o suporte.`);
  }

  // Tentar criar lembrete no Google Calendar (fire-and-forget, não bloqueia fluxo)
  async _tryCalendarReminder(userId, type, data) {
    if (!this.calendar) return;
    try {
      const User = require('../models/User');
      const user = await User.findById(userId);
      if (!user || !user.googleTokens) return;

      const authOk = await this.calendar.setUserAuth(userId);
      if (!authOk) return;

      switch (type) {
        case 'goal_80':
          await this.calendar.criarLembreteMeta80(userId, data.goal);
          break;
        case 'goal_exceeded':
          await this.calendar.criarLembreteMetaEstourada(userId, data.goal, data.totalGasto);
          break;
        case 'cofrinho_80':
          await this.calendar.criarLembreteCofrinho80(userId, data.cofrinho);
          break;
        case 'cofrinho_meta':
          await this.calendar.criarLembreteCofrinhoMeta(userId, data.cofrinho);
          break;
      }
    } catch (error) {
      console.log(`⚠️ Calendar reminder falhou (${type}):`, error.message);
    }
  }

  // Enviar mensagem
  async sendMessage(phoneNumber, message) {
    try {
      await this.whatsapp.sendMessage(phoneNumber, message);
    } catch (error) {
      console.error('❌ Erro ao enviar mensagem:', error);
    }
  }
}

module.exports = BotController; 