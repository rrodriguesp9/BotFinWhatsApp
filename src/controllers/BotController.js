const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Goal = require('../models/Goal');
const NaturalLanguageProcessor = require('../services/NaturalLanguageProcessor');
const OCRService = require('../services/OCRService');
const WhatsAppService = require('../services/WhatsAppService');
const ReportService = require('../services/ReportService');

class BotController {
  constructor() {
    this.nlp = new NaturalLanguageProcessor();
    this.ocr = new OCRService();
    this.whatsapp = new WhatsAppService();
    this.report = new ReportService();
    
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
        await this.sendWelcomeMessage(phoneNumber);
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
      // Processar linguagem natural
      const intent = this.nlp.processMessage(message);
      console.log('🧠 Intenção detectada:', intent);

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
          
        case 'help':
          return await this.sendHelpMessage(user.phoneNumber);
          
        case 'silent':
          return await this.handleSilentMode(user, intent.extracted.days);
          
        default:
          return await this.handleUnknownCommand(user, message);
      }
      
    } catch (error) {
      console.error('❌ Erro ao processar texto:', error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // Processar mensagem de mídia
  async processMediaMessage(user, mediaUrl) {
    try {
      console.log('📷 Processando mídia...');
      
      // Baixar imagem
      const imageBuffer = await this.whatsapp.downloadMedia(mediaUrl);
      
      // Validar imagem
      const validation = this.ocr.validateReceiptImage(imageBuffer);
      if (!validation.valid) {
        await this.sendMessage(user.phoneNumber, 
          `❌ **Erro:** ${validation.reason}\n\n` +
          `Por favor, envie uma imagem mais clara do recibo.`);
        return;
      }
      
      // Processar OCR
      const ocrResult = await this.ocr.processImage(imageBuffer);
      
      if (!ocrResult.success) {
        await this.sendMessage(user.phoneNumber,
          `❌ **Erro no processamento da imagem**\n\n` +
          `Não consegui ler o recibo. Por favor:\n` +
          `• Verifique se a imagem está clara\n` +
          `• Tente enviar novamente\n` +
          `• Ou digite o valor manualmente`);
        return;
      }
      
      // Gerar mensagem de confirmação
      const confirmationMessage = this.ocr.generateConfirmationMessage(ocrResult.extracted);
      await this.sendMessage(user.phoneNumber, confirmationMessage);
      
      // Salvar dados temporários para confirmação
      this.sessions.set(user.phoneNumber, {
        type: 'ocr_confirmation',
        data: ocrResult.extracted,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('❌ Erro ao processar mídia:', error);
      await this.sendErrorMessage(user.phoneNumber);
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

  // Lidar com comando desconhecido
  async handleUnknownCommand(user, message) {
    await this.sendMessage(user.phoneNumber,
      `❓ **Comando não reconhecido**\n\n` +
      `Não entendi: "${message}"\n\n` +
      `Digite "ajuda" para ver todos os comandos disponíveis.`);
  }

  // Enviar mensagem de boas-vindas
  async sendWelcomeMessage(phoneNumber) {
    await this.sendMessage(phoneNumber,
      `🤖 **BEM-VINDO AO BOT FINANCEIRO!**\n\n` +
      `💰 **Controle suas finanças via WhatsApp**\n\n` +
      `**Como usar:**\n` +
      `• "Gastei 50 no Uber" - Registra despesa\n` +
      `• "Recebi 2500 do salário" - Registra receita\n` +
      `• "Quanto tenho agora?" - Consulta saldo\n` +
      `• "Resumo da semana" - Relatório\n\n` +
      `📷 **Envie uma foto de recibo** para extração automática!\n\n` +
      `Digite "ajuda" para ver todos os comandos.`);
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