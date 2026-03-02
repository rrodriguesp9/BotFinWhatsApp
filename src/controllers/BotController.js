const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Goal = require('../models/Goal');
const NaturalLanguageProcessor = require('../services/NaturalLanguageProcessor');
const OCRService = require('../services/OCRService');
const WhatsAppService = require('../services/WhatsAppService');
const ReportService = require('../services/ReportService');

// Whisper (áudio) — opcional, depende de OPENAI_API_KEY
let WhisperService = null;
try {
  WhisperService = require('../services/WhisperService');
} catch (e) {
  console.log('⚠️ WhisperService não disponível:', e.message);
}

// Google Vision OCR — opcional, fallback quando Tesseract tem baixa confiança
let GoogleVisionOCRService = null;
try {
  GoogleVisionOCRService = require('../services/GoogleVisionOCRService');
} catch (e) {
  console.log('⚠️ GoogleVisionOCRService não disponível:', e.message);
}

// OpenAI NLP — fallback inteligente quando regex não entende
let OpenAINLPService = null;
try {
  OpenAINLPService = require('../services/OpenAINLPService');
} catch (e) {
  console.log('⚠️ OpenAINLPService não disponível:', e.message);
}

// OpenAI OCR — leitura de notas fiscais via GPT Vision
let OpenAIOCRService = null;
try {
  OpenAIOCRService = require('../services/OpenAIOCRService');
} catch (e) {
  console.log('⚠️ OpenAIOCRService não disponível:', e.message);
}

class BotController {
  constructor() {
    this.nlp = new NaturalLanguageProcessor();
    this.ocr = new OCRService();
    this.whatsapp = new WhatsAppService();
    this.report = new ReportService();

    // Whisper (áudio) — só instancia se OPENAI_API_KEY existir
    if (WhisperService && process.env.OPENAI_API_KEY) {
      this.whisperService = new WhisperService();
      console.log('✅ WhisperService (áudio) ativado');
    } else {
      this.whisperService = null;
      console.log('⚠️ WhisperService desativado (OPENAI_API_KEY não configurada)');
    }

    // Google Vision OCR — só instancia se credenciais existirem
    if (GoogleVisionOCRService && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      this.googleVisionOCR = new GoogleVisionOCRService();
      console.log('✅ GoogleVisionOCR (fallback) ativado');
    } else {
      this.googleVisionOCR = null;
    }

    // OpenAI NLP — fallback quando regex não entende
    if (OpenAINLPService && process.env.OPENAI_API_KEY) {
      this.openaiNLP = new OpenAINLPService();
      console.log('✅ OpenAI NLP (fallback inteligente) ativado');
    } else {
      this.openaiNLP = null;
    }

    // OpenAI OCR — leitura de notas fiscais via GPT Vision (primário quando disponível)
    if (OpenAIOCRService && process.env.OPENAI_API_KEY) {
      this.openaiOCR = new OpenAIOCRService();
      console.log('✅ OpenAI Vision OCR (leitura de notas) ativado');
    } else {
      this.openaiOCR = null;
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

    // Se regex não entendeu ou confiança baixa, tentar OpenAI
    if ((intent.intention === 'unknown' || intent.confidence < 0.4) && this.openaiNLP) {
      console.log('🤖 Tentando OpenAI NLP fallback...');
      const aiIntent = await this.openaiNLP.processMessage(message);
      console.log('🤖 OpenAI NLP:', aiIntent.intention, 'confidence:', aiIntent.confidence);
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
      console.log('📷 Processando mídia...');

      // Baixar imagem
      const imageBuffer = await this.whatsapp.downloadMedia(mediaUrl);

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
      if (this.openaiOCR) {
        console.log('🤖 Usando OpenAI Vision para ler nota fiscal...');
        ocrResult = await this.openaiOCR.processImage(imageBuffer);

        if (ocrResult.success) {
          confirmationMessage = this.openaiOCR.generateConfirmationMessage(ocrResult.extracted);
        } else {
          console.log('⚠️ OpenAI Vision falhou:', ocrResult.error);
        }
      }

      // Estratégia 2: Tesseract (fallback — gratuito, sem API)
      if (!ocrResult || !ocrResult.success) {
        console.log('📷 Tentando Tesseract OCR...');
        try {
          // Timeout de 30 segundos para evitar travamento
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
      console.error('❌ Erro ao processar mídia:', error);
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

  // Lidar com cofrinho
  async handleSavingsGoal(user, savingsData) {
    try {
      // Implementar criação de cofrinho
      await this.sendMessage(user.phoneNumber,
        `💰 **Cofrinho criado!**\n\n` +
        `🎯 **Objetivo:** ${savingsData.name}\n` +
        `💰 **Meta:** ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(savingsData.target)}\n\n` +
        `Para adicionar dinheiro ao cofrinho, digite:\n` +
        `"adicionar 100 ao cofrinho ${savingsData.name}"`);

    } catch (error) {
      console.error('❌ Erro ao criar cofrinho:', error);
      await this.sendErrorMessage(user.phoneNumber);
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

  // Lidar com exportação
  async handleExport(user, exportData) {
    try {
      const format = exportData.format || 'pdf';
      const period = exportData.period || 'month';
      
      // Gerar relatório
      const reportBuffer = await this.report.generateReport(user.id, format, period);
      
      // Enviar arquivo
      await this.whatsapp.sendMedia(user.phoneNumber, reportBuffer, format);
      
      await this.sendMessage(user.phoneNumber,
        `📤 **Relatório enviado!**\n\n` +
        `📄 **Formato:** ${format.toUpperCase()}\n` +
        `📅 **Período:** ${period}\n\n` +
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
        await this.sendMessage(phoneNumber,
          '⚠️ Processamento de áudio não disponível no momento.\n' +
          'Por favor, envie sua mensagem como texto.\n\n' +
          'Exemplo: "gastei 50 no mercado"');
        return;
      }

      console.log('🎤 Processando áudio com Whisper...');

      // Baixar áudio
      const audioBuffer = await this.whatsapp.downloadMedia(audioMediaId);

      // Processar com Whisper
      const result = await this.whisperService.processWhatsAppAudio(audioBuffer);

      if (result.success) {
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
        await this.sendMessage(phoneNumber,
          '❌ Não consegui processar o áudio.\n' +
          'Tente falar mais claramente ou envie como texto.');
      }
    } catch (error) {
      console.error('❌ Erro no processamento de áudio:', error);
      await this.sendMessage(phoneNumber,
        '❌ Erro ao processar áudio. Tente novamente.');
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