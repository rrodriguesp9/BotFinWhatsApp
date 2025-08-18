const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Goal = require("../models/Goal");
const NaturalLanguageProcessor = require("../services/NaturalLanguageProcessor");
const OCRService = require("../services/OCRService"); // ✅ Para PDFs, documentos, textos
const GoogleVisionOCRService = require("../services/GoogleVisionOCRService"); // ✅ APENAS para imagens
const WhatsAppService = require("../services/WhatsAppService");
const ReportService = require("../services/ReportService");
const WhisperService = require("../services/WhisperService");
const PdfService = require("../services/PdfService");
const GoogleCalendarService = require("../services/GoogleCalendarService");
const moment = require("moment");

class BotController {
  constructor() {
    this.nlp = new NaturalLanguageProcessor();
    this.ocr = new OCRService(); // ✅ Para tudo exceto imagens
    this.imageOCR = new GoogleVisionOCRService(); // ✅ APENAS para imagens
    this.whatsapp = new WhatsAppService();
    this.report = new ReportService();
    this.whisperService = new WhisperService();
    this.calendar = new GoogleCalendarService();
    this.sessions = new Map();
  }

  /// ✅ VERSÃO MELHORADA da função processMessage no BotController
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

      // ✅ CORREÇÃO: Verificar tipo de mídia baseado no contexto
      if (mediaUrl) {
        // Verificar se veio de um webhook de áudio
        if (this.lastMessageType === "audio") {
          console.log("🎤 Detectado áudio pelo contexto do webhook");
          return await this.processAudioMessage(user, mediaUrl);
        }
        // Verificar pela URL
        else if (this.isAudioMedia(mediaUrl)) {
          console.log("🎤 Detectado áudio pela URL");
          return await this.processAudioMessage(user, mediaUrl);
        } else {
          console.log("📷 Detectada imagem ou documento");
          return await this.processMediaMessage(user, mediaUrl);
        }
      }

      // Processar texto
      return await this.processTextMessage(user, message);
    } catch (error) {
      console.error("❌ Erro ao processar mensagem:", error);
      await this.sendErrorMessage(phoneNumber);
    }
  }
  // ✅ VERSÃO CORRIGIDA da função isAudioMedia no BotController
  isAudioMedia(mediaUrl) {
    // Debug: Ver o que está recebendo
    console.log("🔍 Verificando tipo de mídia para:", mediaUrl);

    // WhatsApp áudios geralmente vêm como IDs, não URLs com extensão
    // Vamos verificar se foi chamado a partir de um contexto de áudio

    // Verificar se a URL contém padrões de áudio do WhatsApp
    if (mediaUrl && typeof mediaUrl === "string") {
      // Verificar extensões conhecidas
      const isAudioExtension =
        /\.(ogg|oga|m4a|mp3|opus|webm|aac|wav)(\?|$)/i.test(mediaUrl);

      // Verificar se a URL vem do contexto de áudio (hack temporário)
      const isAudioContext =
        mediaUrl.includes("audio") || this.lastMessageType === "audio";

      console.log("🔍 É extensão de áudio?", isAudioExtension);
      console.log("🔍 É contexto de áudio?", isAudioContext);

      return isAudioExtension || isAudioContext;
    }

    return false;
  }

  // ✅ NOVA: Processar mensagem de áudio
  async processAudioMessage(user, mediaUrl) {
    try {
      console.log("🎤 Processando áudio...");

      // Baixar áudio
      const audioBuffer = await this.whatsapp.downloadMedia(mediaUrl);

      // Processar com Whisper
      const result = await this.whisperService.processWhatsAppAudio(
        audioBuffer
      );

      if (!result.success) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Erro no processamento do áudio**\n\n` +
            `Não consegui entender o áudio. Por favor:\n` +
            `• Fale mais claramente\n` +
            `• Tente gravar novamente\n` +
            `• Ou digite o comando manualmente`
        );
        return;
      }

      // Gerar mensagem de confirmação
      const confirmationMessage =
        this.whisperService.generateConfirmationMessage(result.extracted);
      await this.sendMessage(user.phoneNumber, confirmationMessage);

      // Salvar dados temporários para confirmação
      this.sessions.set(user.phoneNumber, {
        type: "audio_confirmation",
        data: result.extracted,
        transcription: result.transcription,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("❌ Erro ao processar áudio:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ CORRIGIR a ordem de verificação no processTextMessage

  async processTextMessage(user, message) {
    console.log(`🧪 DEBUG - User object:`, {
      id: user.id,
      phoneNumber: user.phoneNumber,
      name: user.name,
    });

    try {
      const messageText = message.toLowerCase().trim();
      console.log(`💬 Processando texto de ${user.phoneNumber}: "${message}"`);
      console.log(`🔍 messageText processado: "${messageText}"`);

      // ✅ ADICIONAR ESTE LOG PARA VER SE CHEGOU ATÉ AQUI
      console.log("🧪 DEBUG - Iniciando verificação de comandos...");

      // ✅ VERIFICAR SE TEM SESSÃO ATIVA
      const activeSession = this.sessions.get(user.phoneNumber);
      if (activeSession && this.isConfirmationPending(activeSession)) {
        return await this.handleConfirmationResponse(
          user,
          messageText,
          activeSession
        );
      }

      // ✅ COMANDOS DE RELATÓRIO DIRETOS - ORDEM IMPORTANTE!

      // Saldo
      if (messageText.match(/^(saldo|quanto tenho|dinheiro|meu saldo)$/i)) {
        return await this.handleBalanceQuery(user);
      }

      // ✅ PRIORIDADE 1: Relatórios de categoria específica (ANTES dos períodos)
      if (messageText.match(/^gastos\s+de\s+([a-záàâãçéêíóôõú]+)$/i)) {
        const categoryMatch = messageText.match(
          /^gastos\s+de\s+([a-záàâãçéêíóôõú]+)$/i
        );
        const category = categoryMatch[1];
        console.log(`📂 Comando de categoria detectado: "${category}"`);
        return await this.handleCategoryReport(user, category);
      }

      // ✅ PRIORIDADE 2: Relatórios por período (DEPOIS das categorias)
      if (
        messageText.match(
          /^(gastos|resumo)\s+(de\s+)?(hoje|ontem|da\s+semana|do\s+mes|do\s+mês|do\s+ano)$/i
        )
      ) {
        const periodMatch = messageText.match(
          /(hoje|ontem|semana|mes|mês|ano)/i
        );
        const period = periodMatch ? periodMatch[1] : "month";
        console.log(`📅 Comando de período detectado: "${period}"`);
        return await this.handleReportQuery(user, period);
      }

      // ✅ PRIORIDADE 3: Comandos de período mais específicos
      if (messageText.match(/^(resumo\s+da\s+semana|gastos\s+da\s+semana)$/i)) {
        console.log(`📅 Comando específico: resumo da semana`);
        return await this.handleReportQuery(user, "week");
      }

      if (
        messageText.match(
          /^(resumo\s+do\s+mes|resumo\s+do\s+mês|gastos\s+do\s+mes|gastos\s+do\s+mês)$/i
        )
      ) {
        console.log(`📅 Comando específico: resumo do mês`);
        return await this.handleReportQuery(user, "month");
      }

      // Relatório comparativo
      if (
        messageText.match(
          /^(comparar|evolução|comparativo|mes\s+passado|mês\s+passado)$/i
        )
      ) {
        return await this.handleComparisonReport(user);
      }

      // ✅ COMANDOS RÁPIDOS EXISTENTES
      if (
        messageText.match(
          /^(oi|olá|ola|hello|hey|bom dia|boa tarde|boa noite)$/i
        )
      ) {
        return await this.sendGreetingMessage(user.phoneNumber, user.name);
      }

      if (messageText.match(/^(menu|ajuda|help|comandos)$/i)) {
        return await this.sendHelpMessage(user.phoneNumber);
      }

      // ✅ ADICIONAR AQUI (junto com os outros comandos):
      if (messageText.match(/^(autorizar|conectar|calendar|calendario)$/i)) {
        return await this.handleCalendarAuth(user);
      }

      // Comando para PDF mensal
      if (
        messageText.match(
          /^(pdf\s+mensal|relatorio\s+mensal\s+pdf|resumo\s+mensal\s+pdf)$/i
        )
      ) {
        return await this.handleMonthlyPDFRequest(user);
      }

      // ✅ COMANDOS FINANCEIROS DIRETOS
      const directCommand = this.parseDirectCommand(messageText);
      if (directCommand.found) {
        console.log("⚡ Comando direto detectado:", directCommand);
        return await this.handleDirectTransaction(user, directCommand);
      }

      // Comando para PDF semanal
      if (
        messageText.match(
          /^(pdf\s+semanal|relatorio\s+semanal\s+pdf|resumo\s+semanal\s+pdf)$/i
        )
      ) {
        return await this.handleWeeklyPDFRequest(user);
      }

      // ✅ LOG NO INÍCIO
      console.log(
        `🧪 DEBUG - Testando comandos de cofrinho para: "${messageText}"`
      );

      // ✅ 1. EDITAR META DO COFRINHO (PRIMEIRO - mais específico)
      if (
        messageText.match(
          /^editar\s+cofrinho\s+(.+)\s+meta\s+(\d+(?:[.,]\d{2})?)$/i
        )
      ) {
        console.log("🧪 DEBUG - COMANDO EDITAR META detectado!");

        const match = messageText.match(
          /^editar\s+cofrinho\s+(.+)\s+meta\s+(\d+(?:[.,]\d{2})?)$/i
        );
        const nome = match[1].trim();
        const novaMeta = parseFloat(match[2].replace(",", "."));
        return await this.handleEditCofrinhoMeta(user, nome, novaMeta);
      }

      // ✅ 2. EDITAR DESCRIÇÃO DO COFRINHO
      if (
        messageText.match(
          /^editar\s+cofrinho\s+(.+)\s+(?:descricao|descrição)\s+(.+)$/i
        )
      ) {
        console.log("🧪 DEBUG - COMANDO EDITAR DESCRIÇÃO detectado!");

        const match = messageText.match(
          /^editar\s+cofrinho\s+(.+)\s+(?:descricao|descrição)\s+(.+)$/i
        );
        const nome = match[1].trim();
        const novaDescricao = match[2].trim();
        return await this.handleEditCofrinhoDescricao(
          user,
          nome,
          novaDescricao
        );
      }

      // ✅ 3. DELETAR COFRINHO
      if (
        messageText.match(/^(?:deletar|excluir|remover)\s+cofrinho\s+(.+)$/i)
      ) {
        console.log("🧪 DEBUG - COMANDO DELETAR detectado!");

        const match = messageText.match(
          /^(?:deletar|excluir|remover)\s+cofrinho\s+(.+)$/i
        );
        const nomeCofrinho = match[1].trim();
        return await this.handleDeleteCofrinho(user, nomeCofrinho);
      }

      // ✅ 7. RELATÓRIO DETALHADO DO COFRINHO
      if (messageText.match(/^(?:relatorio|relatório)\s+cofrinho\s+(.+)$/i)) {
        console.log("🧪 DEBUG - COMANDO RELATÓRIO detectado!");

        const match = messageText.match(
          /^(?:relatorio|relatório)\s+cofrinho\s+(.+)$/i
        );
        const nomeCofrinho = match[1].trim();
        return await this.handleDetailedCofrinhoReport(user, nomeCofrinho);
      }

      // ✅ 8. HISTÓRICO DO COFRINHO
      if (messageText.match(/^(?:historico|histórico)\s+cofrinho\s+(.+)$/i)) {
        console.log("🧪 DEBUG - COMANDO HISTÓRICO detectado!");

        const match = messageText.match(
          /^(?:historico|histórico)\s+cofrinho\s+(.+)$/i
        );
        const nomeCofrinho = match[1].trim();
        return await this.handleCofrinhoHistory(user, nomeCofrinho);
      }

      // ✅ 9. PROGRESSO DE TODOS OS COFRINHOS
      if (messageText.match(/^(?:progresso|evolução|resumo)\s+cofrinhos?$/i)) {
        console.log("🧪 DEBUG - COMANDO PROGRESSO COFRINHOS detectado!");
        return await this.handleCofrinhoProgressReport(user);
      }

      // ✅ 10. COFRINHOS PRÓXIMOS DO VENCIMENTO
      if (messageText.match(/^cofrinhos?\s+(?:vencendo|prazo|urgente)$/i)) {
        console.log("🧪 DEBUG - COMANDO COFRINHOS VENCENDO detectado!");
        return await this.handleCofrinhosDueReport(user);
      }

      // ✅ 11. LISTAR COFRINHOS
      if (
        messageText.match(/^(meus\s+cofrinhos|cofrinhos|lista\s+cofrinhos)$/i)
      ) {
        console.log("🧪 DEBUG - COMANDO LISTAR COFRINHOS detectado!");
        return await this.handleListCofrinhos(user);
      }

      // ✅ 12. VER COFRINHO ESPECÍFICO (sem números) - POR ÚLTIMO!
      if (
        messageText.match(/^cofrinho\s+([a-záàâãçéêíóôõú\s]+)$/i) &&
        !messageText.match(/\d/)
      ) {
        console.log("🧪 DEBUG - COMANDO VER COFRINHO ESPECÍFICO detectado!");

        const match = messageText.match(/^cofrinho\s+([a-záàâãçéêíóôõú\s]+)$/i);
        const nomeCofrinho = match[1].trim();
        return await this.handleViewCofrinho(user, nomeCofrinho);
      }

      // ✅ COMANDOS DE METAS

      // Ver todas as metas: "minhas metas"
      if (messageText.match(/^(minhas\s+metas|metas|lista\s+metas)$/i)) {
        return await this.handleListGoals(user);
      }

      // ✅ COMANDOS FLEXÍVEIS INTELIGENTES (COLAR AQUI)
      const flexibleCommand = this.parseFlexibleFinancialCommand(messageText);
      if (flexibleCommand.found) {
        console.log("🧠 Comando flexível detectado:", flexibleCommand);

        switch (flexibleCommand.type) {
          case "meta":
            return await this.handleCreateGoalAndOffer(
              user,
              flexibleCommand.data
            );

          case "cofrinho":
            return await this.handleCreateCofrinhoAndOffer(
              user,
              flexibleCommand.data
            );

          case "guardar_cofrinho":
            return await this.handleAddToCofrinho(
              user,
              flexibleCommand.data.nomeCofrinho,
              flexibleCommand.data.valor
            );

          case "retirar_cofrinho":
            return await this.handleWithdrawFromCofrinho(
              user,
              flexibleCommand.data.nomeCofrinho,
              flexibleCommand.data.valor
            );
        }
      }

      // ✅ USAR NLP apenas se comando direto não funcionou
      const intent = this.nlp.processMessage(message);
      console.log("🧠 Intenção NLP:", intent);

      // Executar ação baseada na intenção
      switch (intent.intention) {
        case "income":
        case "expense":
          return await this.handleTransaction(user, intent.extracted);

        case "balance":
          return await this.handleBalanceQuery(user);

        case "report":
          return await this.handleReportQuery(user, intent.extracted.period);

        case "goal":
          return await this.handleGoalCreation(user, intent.extracted);

        case "savings":
          return await this.handleSavingsGoal(user, intent.extracted);

        case "split":
          return await this.handleSplitExpense(user, intent.extracted);

        case "export":
          return await this.handleExport(user, intent.extracted);

        case "help":
          return await this.sendHelpMessage(user.phoneNumber);

        case "silent":
          return await this.handleSilentMode(user, intent.extracted.days);

        default:
          return await this.handleUnknownCommand(user, message);
      }
    } catch (error) {
      console.error("❌ Erro ao processar texto:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ NOVO: Retirar valor do cofrinho
  async handleWithdrawFromCofrinho(user, nomeCofrinho, valor) {
    try {
      console.log(`💸 Retirando R$ ${valor} do cofrinho ${nomeCofrinho}`);

      const Cofrinho = require("../models/Cofrinho");

      if (valor <= 0 || valor > 100000) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Valor inválido**\n\n` +
            `O valor deve estar entre R$ 0,01 e R$ 100.000,00`
        );
        return;
      }

      const cofrinho = await Cofrinho.findByName(user.id, nomeCofrinho);
      if (!cofrinho) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Cofrinho não encontrado**\n\n` +
            `Não existe cofrinho chamado "${nomeCofrinho}".\n` +
            `Digite "meus cofrinhos" para ver os disponíveis.`
        );
        return;
      }

      // Verificar se tem saldo suficiente
      if (valor > cofrinho.valorAtual) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Saldo insuficiente**\n\n` +
            `💰 **Saldo no cofrinho:** ${this.formatarMoeda(
              cofrinho.valorAtual
            )}\n` +
            `💸 **Valor solicitado:** ${this.formatarMoeda(valor)}\n\n` +
            `Você só pode retirar até ${this.formatarMoeda(
              cofrinho.valorAtual
            )}.`
        );
        return;
      }

      // Retirar valor
      await cofrinho.retirarValor(valor, `Retirada via WhatsApp`);

      // Registrar como receita na conta principal
      const Transaction = require("../models/Transaction");
      await Transaction.create({
        userId: user.id,
        type: "income",
        amount: valor,
        category: "transferencia",
        description: `Retirada do cofrinho ${nomeCofrinho}`,
        date: new Date(),
      });

      const progresso = cofrinho.calcularProgresso();

      let message =
        `💸 **Valor retirado do cofrinho!**\n\n` +
        `🏦 **Cofrinho:** ${nomeCofrinho}\n` +
        `💰 **Valor retirado:** ${this.formatarMoeda(valor)}\n` +
        `📊 **Saldo restante:** ${this.formatarMoeda(progresso.valorAtual)}\n` +
        `🎯 **Meta:** ${this.formatarMoeda(progresso.meta)}\n` +
        `📈 **Progresso:** ${progresso.percentual}%\n\n`;

      if (progresso.valorAtual === 0) {
        message += `🗑️ **Cofrinho vazio!** Considere deletá-lo ou fazer novos depósitos.\n\n`;
      } else {
        message += `🎯 **Ainda faltam:** ${this.formatarMoeda(
          progresso.faltam
        )}\n\n`;
      }

      message += `💡 Para voltar a guardar: "guardar 50 no cofrinho ${nomeCofrinho}"`;

      await this.sendMessage(user.phoneNumber, message);
    } catch (error) {
      console.error("❌ Erro ao retirar do cofrinho:", error);

      if (error.message.includes("Valor insuficiente")) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Saldo insuficiente no cofrinho**\n\n` +
            `Verifique o saldo atual digitando "cofrinho ${nomeCofrinho}".`
        );
      } else {
        await this.sendErrorMessage(user.phoneNumber);
      }
    }
  }

  // ✅ NOVO: Deletar cofrinho
  async handleDeleteCofrinho(user, nomeCofrinho) {
    try {
      const Cofrinho = require("../models/Cofrinho");

      const cofrinho = await Cofrinho.findByName(user.id, nomeCofrinho);
      if (!cofrinho) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Cofrinho não encontrado**\n\n` +
            `Não existe cofrinho chamado "${nomeCofrinho}".\n` +
            `Digite "meus cofrinhos" para ver os disponíveis.`
        );
        return;
      }

      // Verificar se tem saldo
      if (cofrinho.valorAtual > 0) {
        await this.sendMessage(
          user.phoneNumber,
          `⚠️ **Cofrinho não está vazio!**\n\n` +
            `💰 **Saldo atual:** ${this.formatarMoeda(
              cofrinho.valorAtual
            )}\n\n` +
            `**Opções:**\n` +
            `• "retirar ${cofrinho.valorAtual} do cofrinho ${nomeCofrinho}" - Retirar tudo\n` +
            `• "desativar cofrinho ${nomeCofrinho}" - Apenas desativar\n\n` +
            `💡 Só é possível deletar cofrinhos vazios.`
        );
        return;
      }

      // Criar sessão para confirmação
      this.sessions.set(user.phoneNumber, {
        type: "delete_cofrinho_confirmation",
        data: { cofrinhoId: cofrinho.id, nome: nomeCofrinho },
        timestamp: Date.now(),
      });

      await this.sendMessage(
        user.phoneNumber,
        `⚠️ **Confirmar exclusão**\n\n` +
          `Tem certeza que deseja deletar o cofrinho "${nomeCofrinho}"?\n\n` +
          `⚡ **Esta ação não pode ser desfeita!**\n\n` +
          `• Digite "sim" para confirmar\n` +
          `• Digite "não" para cancelar`
      );
    } catch (error) {
      console.error("❌ Erro ao deletar cofrinho:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ NOVO: Editar meta do cofrinho
  async handleEditCofrinhoMeta(user, nomeCofrinho, novaMeta) {
    try {
      const Cofrinho = require("../models/Cofrinho");

      if (novaMeta <= 0 || novaMeta > 1000000) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Meta inválida**\n\n` +
            `A meta deve estar entre R$ 0,01 e R$ 1.000.000,00`
        );
        return;
      }

      const cofrinho = await Cofrinho.findByName(user.id, nomeCofrinho);
      if (!cofrinho) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Cofrinho não encontrado**\n\n` +
            `Não existe cofrinho chamado "${nomeCofrinho}".`
        );
        return;
      }

      // ✅ ADICIONAR no handleEditCofrinhoMeta, antes de atualizar:
      if (novaMeta === cofrinho.meta) {
        await this.sendMessage(
          user.phoneNumber,
          `⚠️ **Meta não alterada**\n\n` +
            `A meta do cofrinho "${nomeCofrinho}" já é ${this.formatarMoeda(
              novaMeta
            )}.\n\n` +
            `💡 Digite um valor diferente para alterar a meta.`
        );
        return;
      }

      const metaAnterior = cofrinho.meta;
      await cofrinho.update({ meta: novaMeta });

      const progresso = cofrinho.calcularProgresso();

      let message =
        `✅ **Meta atualizada!**\n\n` +
        `🏦 **Cofrinho:** ${nomeCofrinho}\n` +
        `📊 **Meta anterior:** ${this.formatarMoeda(metaAnterior)}\n` +
        `🎯 **Nova meta:** ${this.formatarMoeda(novaMeta)}\n` +
        `💰 **Valor atual:** ${this.formatarMoeda(progresso.valorAtual)}\n` +
        `📈 **Progresso:** ${progresso.percentual}%\n\n`;

      if (progresso.atingido) {
        message += `🎉 **Parabéns! Você já atingiu a nova meta!** 🎉\n\n`;
      } else {
        message += `🎯 **Faltam:** ${this.formatarMoeda(progresso.faltam)}\n\n`;
      }

      message += `💡 Continue guardando: "guardar 100 no cofrinho ${nomeCofrinho}"`;

      await this.sendMessage(user.phoneNumber, message);
    } catch (error) {
      console.error("❌ Erro ao editar meta do cofrinho:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ NOVO: Editar descrição do cofrinho
  async handleEditCofrinhoDescricao(user, nomeCofrinho, novaDescricao) {
    try {
      const Cofrinho = require("../models/Cofrinho");

      const cofrinho = await Cofrinho.findByName(user.id, nomeCofrinho);
      if (!cofrinho) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Cofrinho não encontrado**\n\n` +
            `Não existe cofrinho chamado "${nomeCofrinho}".`
        );
        return;
      }

      const descricaoAnterior = cofrinho.descricao || "Não informado";
      await cofrinho.update({ descricao: novaDescricao });

      await this.sendMessage(
        user.phoneNumber,
        `✅ **Descrição atualizada!**\n\n` +
          `🏦 **Cofrinho:** ${nomeCofrinho}\n` +
          `📝 **Descrição anterior:** ${descricaoAnterior}\n` +
          `📝 **Nova descrição:** ${novaDescricao}\n\n` +
          `💡 Digite "cofrinho ${nomeCofrinho}" para ver o relatório atualizado.`
      );
    } catch (error) {
      console.error("❌ Erro ao editar descrição do cofrinho:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ NOVO: Relatório detalhado do cofrinho
  async handleDetailedCofrinhoReport(user, nomeCofrinho) {
    try {
      const Cofrinho = require("../models/Cofrinho");

      const cofrinho = await Cofrinho.findByName(user.id, nomeCofrinho);
      if (!cofrinho) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Cofrinho não encontrado**\n\n` +
            `Não existe cofrinho chamado "${nomeCofrinho}".\n` +
            `Digite "meus cofrinhos" para ver os disponíveis.`
        );
        return;
      }

      const relatorioDetalhado = await cofrinho.gerarRelatorioDetalhado();

      let message = relatorioDetalhado + `\n\n**Ações disponíveis:**\n`;
      message += `• "guardar 100 no cofrinho ${nomeCofrinho}" - Guardar dinheiro\n`;
      message += `• "retirar 50 do cofrinho ${nomeCofrinho}" - Retirar dinheiro\n`;
      message += `• "histórico cofrinho ${nomeCofrinho}" - Ver movimentações\n`;
      message += `• "editar cofrinho ${nomeCofrinho} meta 8000" - Alterar meta`;

      await this.sendMessage(user.phoneNumber, message);
    } catch (error) {
      console.error("❌ Erro ao gerar relatório detalhado:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ NOVO: Relatório de progresso de todos os cofrinhos
  async handleCofrinhoProgressReport(user) {
    try {
      const Cofrinho = require("../models/Cofrinho");

      const resumo = await Cofrinho.obterResumoUsuario(user.id);

      if (!resumo || resumo.totalCofrinhos === 0) {
        await this.sendMessage(
          user.phoneNumber,
          `💰 **Você ainda não tem cofrinhos!**\n\n` +
            `**Como criar:**\n` +
            `• "cofrinho viagem 5000" - Para viagem\n` +
            `• "cofrinho casa 50000" - Para casa própria\n` +
            `• "cofrinho emergência 10000" - Para emergências`
        );
        return;
      }

      let message = `📊 **RESUMO GERAL DOS COFRINHOS**\n\n`;

      message += `📈 **Estatísticas:**\n`;
      message += `🏦 Total de cofrinhos: ${resumo.totalCofrinhos}\n`;
      message += `🎯 Metas atingidas: ${resumo.cofrinhosMeta}\n`;
      message += `💰 Total guardado: ${this.formatarMoeda(
        resumo.totalGuardado
      )}\n`;
      message += `🎯 Total das metas: ${this.formatarMoeda(
        resumo.totalMetas
      )}\n`;
      message += `📊 Progresso médio: ${resumo.progressoMedio}%\n\n`;

      if (resumo.maisPróximoMeta) {
        const progressoMaisProximo = resumo.maisPróximoMeta.calcularProgresso();
        message += `🥇 **Mais próximo da meta:**\n`;
        message += `   💰 ${resumo.maisPróximoMeta.nome} (${progressoMaisProximo.percentual}%)\n\n`;
      }

      if (resumo.maisDistanteMeta && resumo.totalCofrinhos > 1) {
        const progressoMaisDistante =
          resumo.maisDistanteMeta.calcularProgresso();
        message += `🎯 **Precisa de mais atenção:**\n`;
        message += `   💰 ${resumo.maisDistanteMeta.nome} (${progressoMaisDistante.percentual}%)\n\n`;
      }

      message += `**Comandos úteis:**\n`;
      message += `• "meus cofrinhos" - Lista detalhada\n`;
      message += `• "relatório cofrinho [nome]" - Detalhes específicos\n`;
      message += `• "cofrinhos vencendo" - Prazos urgentes`;

      await this.sendMessage(user.phoneNumber, message);
    } catch (error) {
      console.error("❌ Erro ao gerar relatório de progresso:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ NOVO: Histórico do cofrinho
  async handleCofrinhoHistory(user, nomeCofrinho) {
    try {
      const Cofrinho = require("../models/Cofrinho");

      const cofrinho = await Cofrinho.findByName(user.id, nomeCofrinho);
      if (!cofrinho) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Cofrinho não encontrado**\n\n` +
            `Não existe cofrinho chamado "${nomeCofrinho}".`
        );
        return;
      }

      const historico = await cofrinho.buscarHistorico(15); // Últimos 15 movimentos

      if (historico.length === 0) {
        await this.sendMessage(
          user.phoneNumber,
          `📋 **Histórico do cofrinho "${nomeCofrinho}"**\n\n` +
            `🔍 **Nenhuma movimentação encontrada.**\n\n` +
            `💡 Faça seu primeiro depósito: "guardar 100 no cofrinho ${nomeCofrinho}"`
        );
        return;
      }

      let message = `📋 **HISTÓRICO - ${nomeCofrinho.toUpperCase()}**\n\n`;

      historico.forEach((movimento, index) => {
        const data = moment(movimento.data).format("DD/MM/YY HH:mm");
        const emoji = movimento.tipo === "deposito" ? "📥" : "📤";
        const sinal = movimento.tipo === "deposito" ? "+" : "-";

        message += `${emoji} **${sinal}${this.formatarMoeda(
          movimento.valor
        )}** - ${data}\n`;

        if (
          movimento.descricao &&
          movimento.descricao !== "Depósito via WhatsApp" &&
          movimento.descricao !== "Retirada via WhatsApp"
        ) {
          message += `   📝 ${movimento.descricao}\n`;
        }

        message += `   💰 Saldo: ${this.formatarMoeda(
          movimento.valorAtual
        )}\n\n`;
      });

      if (historico.length === 15) {
        message += `📄 **Mostrando últimos 15 movimentos**\n`;
      }

      message += `**Comandos:**\n`;
      message += `• "cofrinho ${nomeCofrinho}" - Ver status atual\n`;
      message += `• "relatório cofrinho ${nomeCofrinho}" - Análise detalhada`;

      await this.sendMessage(user.phoneNumber, message);
    } catch (error) {
      console.error("❌ Erro ao buscar histórico:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ NOVO: Cofrinhos próximos do vencimento
  async handleCofrinhosDueReport(user) {
    try {
      const Cofrinho = require("../models/Cofrinho");

      const proximosDoVencimento = await Cofrinho.buscarProximosDoVencimento(
        user.id
      );

      if (proximosDoVencimento.length === 0) {
        await this.sendMessage(
          user.phoneNumber,
          `⏰ **Nenhum cofrinho próximo do vencimento**\n\n` +
            `✅ Todos os seus cofrinhos estão com prazos tranquilos!\n\n` +
            `💡 Digite "meus cofrinhos" para ver todos.`
        );
        return;
      }

      let message = `⏰ **COFRINHOS COM PRAZO URGENTE**\n\n`;

      proximosDoVencimento.forEach(({ cofrinho, prazo }) => {
        const progresso = cofrinho.calcularProgresso();

        if (prazo.vencido) {
          message += `🚨 **${cofrinho.nome}** - VENCIDO\n`;
          message += `   ⚠️ Venceu há ${Math.abs(prazo.diasRestantes)} dias\n`;
        } else {
          message += `⏰ **${cofrinho.nome}** - ${prazo.diasRestantes} dias\n`;
        }

        message += `   💰 ${this.formatarMoeda(
          progresso.valorAtual
        )} / ${this.formatarMoeda(progresso.meta)}\n`;
        message += `   📈 ${progresso.percentual}% concluído\n`;

        if (!progresso.atingido) {
          const valorPorDia =
            prazo.diasRestantes > 0
              ? progresso.faltam / prazo.diasRestantes
              : progresso.faltam;
          if (prazo.diasRestantes > 0) {
            message += `   🎯 Precisa guardar ${this.formatarMoeda(
              valorPorDia
            )}/dia\n`;
          }
        }

        message += `\n`;
      });

      message += `**Ações rápidas:**\n`;
      proximosDoVencimento.forEach(({ cofrinho }) => {
        message += `• "guardar 100 no cofrinho ${cofrinho.nome}"\n`;
      });

      await this.sendMessage(user.phoneNumber, message);
    } catch (error) {
      console.error(
        "❌ Erro ao buscar cofrinhos próximos do vencimento:",
        error
      );
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // 1. Atualizar processMediaMessage para incluir opções de edição
  async processMediaMessage(user, mediaUrl) {
    try {
      console.log("📷 Processando mídia...");

      // Baixar imagem
      const imageBuffer = await this.whatsapp.downloadMedia(mediaUrl);

      // Validar imagem
      const validation = this.imageOCR.validateReceiptImage(imageBuffer);
      if (!validation.valid) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Erro:** ${validation.reason}\n\n` +
            `Por favor, envie uma imagem mais clara do recibo.`
        );
        return;
      }

      // Processar OCR
      const ocrResult = await this.imageOCR.processImage(imageBuffer);

      if (!ocrResult.success) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Erro no processamento da imagem**\n\n` +
            `Não consegui ler o recibo. Por favor:\n` +
            `• Verifique se a imagem está clara\n` +
            `• Tente enviar novamente\n` +
            `• Ou digite o valor manualmente`
        );
        return;
      }

      // ✅ NOVA: Gerar mensagem de confirmação com opções de edição
      const confirmationMessage = this.generateEditableConfirmationMessage(
        ocrResult.extracted
      );
      await this.sendMessage(user.phoneNumber, confirmationMessage);

      // ✅ NOVA: Salvar dados com flag de edição
      this.sessions.set(user.phoneNumber, {
        type: "ocr_confirmation_editable",
        data: ocrResult.extracted,
        originalData: { ...ocrResult.extracted }, // Backup dos dados originais
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("❌ Erro ao processar mídia:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  async handleMediaMessage(user, mediaUrl) {
    if (this.isAudioMedia(mediaUrl)) {
      await this.processAudioMessage(user, mediaUrl);
    } else {
      await this.processMediaMessage(user, mediaUrl); // imagens ou outros tipos
    }
  }

  // ✅ ATUALIZAR o método generateEditableConfirmationMessage no BotController

  generateEditableConfirmationMessage(extracted) {
    const moment = require("moment");

    if (!extracted.amount) {
      return (
        `❌ **Não consegui extrair o valor do recibo.**\n\n` +
        `Por favor, digite o valor manualmente:\n` +
        `Exemplo: "gastei 50 no mercado"`
      );
    }

    let message = `📷 **DADOS EXTRAÍDOS DO RECIBO**\n\n`;

    // ✅ VERIFICAR SE TEM PARCELAS
    if (extracted.installments && extracted.installments.hasInstallments) {
      // 🆕 MOSTRAR DADOS DE PARCELAMENTO
      const totalFormatted = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(extracted.installments.totalAmount);

      const installmentFormatted = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(extracted.installments.installmentValue);

      message += `💰 **Valor total:** ${totalFormatted}\n`;
      message += `💳 **Valor da parcela:** ${installmentFormatted}\n`;
      message += `📊 **Parcelamento:** ${extracted.installments.totalInstallments}x de ${installmentFormatted}\n`;
    } else {
      // ✅ LÓGICA ORIGINAL para pagamento à vista
      const amountFormatted = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(extracted.amount);

      message += `💰 **Valor:** ${amountFormatted}\n`;
    }

    // ✅ DADOS COMUNS
    if (
      extracted.establishment &&
      extracted.establishment !== "Estabelecimento não identificado"
    ) {
      message += `🏪 **Estabelecimento:** ${extracted.establishment}\n`;
    }

    if (extracted.date) {
      message += `📅 **Data:** ${moment(extracted.date).format(
        "DD/MM/YYYY"
      )}\n`;
    }

    message += `📂 **Categoria:** ${extracted.category}\n\n`;

    // ✅ CONFIANÇA
    if (extracted.confidence === "low") {
      message += `⚠️ **Confiança baixa** - Verifique os dados acima.\n\n`;
    }

    // ✅ OPÇÕES DE CONFIRMAÇÃO
    if (extracted.installments && extracted.installments.hasInstallments) {
      message += `✅ **CONFIRMA ESTE PARCELAMENTO?**\n\n`;
      message += `• *"confirmar"* - Criar as ${extracted.installments.totalInstallments} parcelas\n`;
      message += `• *"editar valor"* - Corrigir valor\n`;
      message += `• *"editar categoria"* - Corrigir categoria\n`;
      message += `• *"cancelar"* - Não salvar\n\n`;
      message += `💡 A 1ª parcela será debitada hoje, as outras nos próximos meses!`;
    } else {
      message += `✅ **CONFIRMA ESTE GASTO?**\n\n`;
      message += `• *"confirmar"* - Salvar como está\n`;
      message += `• *"editar valor"* - Corrigir valor\n`;
      message += `• *"editar categoria"* - Corrigir categoria\n`;
      message += `• *"cancelar"* - Não salvar`;
    }

    return message;
  }

  // ✅ ATUALIZAR: handleTransaction para usar o novo sistema
  async handleTransaction(user, transactionData) {
    try {
      // ✅ VERIFICAR SE TEM PARCELAS
      if (
        transactionData.installments &&
        transactionData.installments.hasInstallments
      ) {
        return await this.handleTransactionWithInstallments(
          user,
          transactionData
        );
      }

      // ✅ LÓGICA ORIGINAL para pagamentos à vista
      const errors = Transaction.validate({
        userId: user.id,
        ...transactionData,
      });

      if (errors.length > 0) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Dados inválidos:**\n\n` +
            `${errors.join("\n")}\n\n` +
            `Exemplo: "gastei 50 no mercado"`
        );
        return;
      }

      // Criar transação única
      const transaction = await Transaction.create({
        userId: user.id,
        ...transactionData,
      });

      // Obter saldo atualizado
      const newBalance = await Transaction.getCurrentBalance(user.id);

      // Verificar metas
      const goal = await Goal.findByCategory(user.id, transactionData.category);
      let goalMessage = "";

      if (goal) {
        const progress = await goal.calculateProgress();
        if (progress.shouldAlert) {
          goalMessage = "\n\n" + (await goal.generateAlertMessage());
        }
      }

      // ✅ VERIFICAR METAS E CRIAR LEMBRETES
      if (transactionData.type === "expense") {
        await this.verificarMetasEAlertar(
          user,
          transactionData.category,
          transactionData.amount
        );
      }

      // Enviar confirmação
      const amountFormatted = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(transactionData.amount);

      const balanceFormatted = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(newBalance);

      const message =
        `${transactionData.type === "income" ? "💵" : "💸"} **${
          transactionData.type === "income" ? "Receita" : "Despesa"
        } registrada!**\n\n` +
        `💰 **Valor:** ${amountFormatted}\n` +
        `📂 **Categoria:** ${transactionData.category}\n` +
        `📝 **Descrição:** ${transactionData.description}\n` +
        `💳 **Saldo atual:** ${balanceFormatted}${goalMessage}`;

      await this.sendMessage(user.phoneNumber, message);
    } catch (error) {
      console.error("❌ Erro ao criar transação:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // 🆕 MÉTODO: Processar transação com parcelas
  async handleTransactionWithInstallments(user, extractedData) {
    try {
      if (
        !extractedData.installments ||
        !extractedData.installments.hasInstallments
      ) {
        // ✅ SEM PARCELAS: Usar lógica original
        return await this.handleTransaction(user, extractedData);
      }

      // ✅ COM PARCELAS: Criar primeira parcela + agendar futuras
      console.log("💳 Processando transação parcelada...");

      const { installments } = extractedData;

      // ✅ 1. CRIAR PRIMEIRA PARCELA (atual)
      const firstInstallment = await Transaction.create({
        userId: user.id,
        type: extractedData.type,
        amount: extractedData.amount,
        category: extractedData.category,
        description: extractedData.description,
        date: extractedData.date || new Date(),
        source: "image",
        metadata: {
          establishment: extractedData.establishment,
          ocrService: "Google Vision",
          confidence: extractedData.confidence || 95,
          extractedAt: new Date(),
          // 🆕 Metadados de parcelas
          isInstallment: true,
          installmentNumber: 1,
          totalInstallments: installments.totalInstallments,
          installmentValue: installments.installmentValue,
          totalAmount: installments.totalAmount,
          parentInstallmentId: null, // Primeira parcela não tem pai
        },
      });

      // ✅ 2. CRIAR PARCELAS FUTURAS
      const futureInstallments = await this.createFutureInstallments(
        user.id,
        extractedData,
        installments,
        firstInstallment.id
      );

      // ✅ 3. OBTER SALDO ATUALIZADO
      const newBalance = await Transaction.getCurrentBalance(user.id);

      // ✅ 4. VERIFICAR METAS
      const goal = await Goal.findByCategory(user.id, extractedData.category);
      let goalMessage = "";
      if (goal) {
        const progress = await goal.calculateProgress();
        if (progress.shouldAlert) {
          goalMessage = "\n\n" + (await goal.generateAlertMessage());
        }
      }

      // ✅ 5. GERAR MENSAGEM DE CONFIRMAÇÃO
      const confirmationMessage = this.generateInstallmentConfirmationMessage(
        extractedData,
        installments,
        newBalance,
        futureInstallments.length
      );

      await this.sendMessage(
        user.phoneNumber,
        confirmationMessage + goalMessage
      );

      console.log(
        `✅ Transação parcelada criada: ${installments.totalInstallments}x de R$ ${installments.installmentValue}`
      );
    } catch (error) {
      console.error("❌ Erro ao processar transação parcelada:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // 🆕 MÉTODO: Criar parcelas futuras
  async createFutureInstallments(
    userId,
    extractedData,
    installmentData,
    parentId
  ) {
    const futureInstallments = [];
    const moment = require("moment");

    try {
      const baseDate = moment(extractedData.date || new Date());

      // Criar parcelas de 2 até N
      for (let i = 2; i <= installmentData.totalInstallments; i++) {
        const installmentDate = baseDate
          .clone()
          .add(i - 1, "months")
          .toDate();

        const futureInstallment = await Transaction.create({
          userId: userId,
          type: extractedData.type,
          amount: installmentData.installmentValue,
          category: extractedData.category,
          description: `${extractedData.establishment || "Compra"} - ${i}/${
            installmentData.totalInstallments
          } de R$ ${installmentData.installmentValue.toFixed(2)}`,
          date: installmentDate,
          source: "installment_scheduled",
          metadata: {
            establishment: extractedData.establishment,
            ocrService: "Google Vision - Parcela Futura",
            confidence: extractedData.confidence || 95,
            extractedAt: new Date(),
            // 🆕 Metadados de parcelas futuras
            isInstallment: true,
            isFutureInstallment: true,
            installmentNumber: i,
            totalInstallments: installmentData.totalInstallments,
            installmentValue: installmentData.installmentValue,
            totalAmount: installmentData.totalAmount,
            parentInstallmentId: parentId,
          },
        });

        futureInstallments.push(futureInstallment);
        console.log(
          `📅 Parcela ${i}/${
            installmentData.totalInstallments
          } agendada para ${moment(installmentDate).format("DD/MM/YYYY")}`
        );
      }

      console.log(`✅ ${futureInstallments.length} parcelas futuras criadas`);
      return futureInstallments;
    } catch (error) {
      console.error("❌ Erro ao criar parcelas futuras:", error);
      return [];
    }
  }

  // 🆕 MÉTODO: Gerar mensagem de confirmação para parcelas
  generateInstallmentConfirmationMessage(
    extractedData,
    installments,
    newBalance,
    futureInstallmentsCount
  ) {
    const moment = require("moment");

    const installmentFormatted = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(installments.installmentValue);

    const totalFormatted = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(installments.totalAmount);

    const balanceFormatted = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(newBalance);

    let message = `💳 **COMPRA PARCELADA REGISTRADA!**\n\n`;

    message += `🏪 **Local:** ${
      extractedData.establishment || "Não identificado"
    }\n`;
    message += `📂 **Categoria:** ${extractedData.category}\n`;
    message += `📊 **Parcelamento:** ${installments.totalInstallments}x de ${installmentFormatted}\n`;
    message += `💵 **Valor total:** ${totalFormatted}\n`;
    message += `📅 **Data da compra:** ${moment(extractedData.date).format(
      "DD/MM/YYYY"
    )}\n\n`;

    message += `✅ **PARCELAS CRIADAS:**\n`;
    message += `• **1ª parcela:** Hoje (${installmentFormatted}) - ✅ Debitada\n`;

    // Mostrar próximas parcelas
    const baseDate = moment(extractedData.date || new Date());
    for (let i = 2; i <= installments.totalInstallments; i++) {
      const nextDate = baseDate.clone().add(i - 1, "months");
      message += `• **${i}ª parcela:** ${nextDate.format(
        "DD/MM/YYYY"
      )} (${installmentFormatted}) - ⏰ Agendada\n`;
    }

    message += `\n💳 **Saldo atual:** ${balanceFormatted}\n\n`;

    message += `📌 **RESUMO:**\n`;
    message += `• Total de parcelas: ${installments.totalInstallments}\n`;
    message += `• Valor de cada parcela: ${installmentFormatted}\n`;
    message += `• Última parcela: ${baseDate
      .clone()
      .add(installments.totalInstallments - 1, "months")
      .format("DD/MM/YYYY")}\n\n`;

    message += `💡 Digite **"relatório"** para ver todas suas transações!`;

    return message;
  }

  /// ✅ ATUALIZAR as funções no BotController
  async handleBalanceQuery(user) {
    try {
      const reportResult = await this.report.generateBalanceTextReport(user.id);

      if (reportResult.success) {
        await this.sendMessage(user.phoneNumber, reportResult.report);
      } else {
        await this.sendMessage(
          user.phoneNumber,
          "❌ **Erro ao consultar saldo**"
        );
      }
    } catch (error) {
      console.error("❌ Erro ao consultar saldo:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // Lidar com relatório
  async handleReportQuery(user, period = "month") {
    try {
      console.log(`📊 Gerando relatório de ${period} para:`, user.phoneNumber);

      const reportResult = await this.report.generatePeriodTextReport(
        user.id,
        period
      );

      if (reportResult.success) {
        await this.sendMessage(user.phoneNumber, reportResult.report);
      } else {
        await this.sendMessage(
          user.phoneNumber,
          "❌ **Erro ao gerar relatório**\n\nTente novamente em alguns instantes."
        );
      }
    } catch (error) {
      console.error("❌ Erro ao gerar relatório:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ ADICIONAR a função handleCategoryReport se não existir
  async handleCategoryReport(user, category) {
    try {
      console.log(
        `📊 Gerando relatório de categoria ${category} para:`,
        user.phoneNumber
      );

      const reportResult = await this.report.generateCategoryTextReport(
        user.id,
        category
      );

      if (reportResult.success) {
        await this.sendMessage(user.phoneNumber, reportResult.report);
      } else {
        await this.sendMessage(
          user.phoneNumber,
          "❌ **Erro ao gerar relatório**\n\nTente novamente em alguns instantes."
        );
      }
    } catch (error) {
      console.error("❌ Erro ao gerar relatório de categoria:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ CORRIGIR handleGoalCreation no BotController
  async handleGoalCreation(user, goalData) {
    try {
      // ✅ MAPEAR campos corretamente
      const mappedGoalData = {
        userId: user.id,
        category: goalData.category || goalData.categoria,
        monthlyLimit:
          goalData.monthlyLimit || goalData.limite || goalData.limit,
      };

      const errors = Goal.validate(mappedGoalData);

      if (errors.length > 0) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Erro ao criar meta:**\n\n` +
            `${errors.join("\n")}\n\n` +
            `Exemplo: "meta alimentação 600"`
        );
        return;
      }

      // ✅ USAR dados mapeados
      const existingGoal = await Goal.findByCategory(
        user.id,
        mappedGoalData.category
      );

      if (existingGoal) {
        await existingGoal.update({
          monthlyLimit: mappedGoalData.monthlyLimit,
        });
        await this.sendMessage(
          user.phoneNumber,
          `✅ **Meta atualizada!**\n\n` +
            `📂 **Categoria:** ${mappedGoalData.category}\n` +
            `💰 **Limite:** ${this.formatarMoeda(
              mappedGoalData.monthlyLimit
            )}\n\n` +
            `Receberá alertas quando atingir 80% do limite.`
        );
      } else {
        const goal = await Goal.create(mappedGoalData);
        await this.sendMessage(
          user.phoneNumber,
          `🎯 **Meta criada com sucesso!**\n\n` +
            `📂 **Categoria:** ${mappedGoalData.category}\n` +
            `💰 **Limite mensal:** ${this.formatarMoeda(
              mappedGoalData.monthlyLimit
            )}\n\n` +
            `Receberá alertas quando atingir 80% do limite.`
        );
      }
    } catch (error) {
      console.error("❌ Erro ao criar meta:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // Lidar com cofrinho
  async handleSavingsGoal(user, savingsData) {
    try {
      // Implementar criação de cofrinho
      await this.sendMessage(
        user.phoneNumber,
        `💰 **Cofrinho criado!**\n\n` +
          `🎯 **Objetivo:** ${savingsData.name}\n` +
          `💰 **Meta:** ${new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL",
          }).format(savingsData.target)}\n\n` +
          `Para adicionar dinheiro ao cofrinho, digite:\n` +
          `"adicionar 100 ao cofrinho ${savingsData.name}"`
      );
    } catch (error) {
      console.error("❌ Erro ao criar cofrinho:", error);
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
        type: "expense",
        amount: myShare,
        category: "outros",
        description: `${splitData.description} (dividido por ${splitData.people})`,
        date: new Date(),
      });

      await this.sendMessage(
        user.phoneNumber,
        `🧮 **Despesa dividida registrada!**\n\n` +
          `📝 **Descrição:** ${splitData.description}\n` +
          `💰 **Total:** ${new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL",
          }).format(splitData.totalAmount)}\n` +
          `👥 **Dividido por:** ${splitData.people} pessoas\n` +
          `💸 **Sua parte:** ${new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL",
          }).format(myShare)}`
      );
    } catch (error) {
      console.error("❌ Erro ao dividir despesa:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // Lidar com exportação
  async handleExport(user, exportData) {
    try {
      const format = exportData.format || "pdf";
      const period = exportData.period || "month";

      // Gerar relatório
      const reportBuffer = await this.report.generateReport(
        user.id,
        format,
        period
      );

      // Enviar arquivo
      await this.whatsapp.sendMedia(user.phoneNumber, reportBuffer, format);

      await this.sendMessage(
        user.phoneNumber,
        `📤 **Relatório enviado!**\n\n` +
          `📄 **Formato:** ${format.toUpperCase()}\n` +
          `📅 **Período:** ${period}\n\n` +
          `O arquivo foi enviado acima.`
      );
    } catch (error) {
      console.error("❌ Erro ao exportar:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // Lidar com modo silencioso
  async handleSilentMode(user, days) {
    try {
      await user.toggleSilentMode(days);

      const message = days
        ? `🔕 **Modo silencioso ativado!**\n\n` +
          `Notificações pausadas por ${days} dias.\n` +
          `Para reativar, envie "ativar notificações".`
        : `🔔 **Notificações reativadas!**\n\n` +
          `Você voltará a receber alertas e relatórios.`;

      await this.sendMessage(user.phoneNumber, message);
    } catch (error) {
      console.error("❌ Erro ao alterar modo silencioso:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // Lidar com comando desconhecido
  async handleUnknownCommand(user, message) {
    await this.sendMessage(
      user.phoneNumber,
      `❓ **Comando não reconhecido**\n\n` +
        `Não entendi: "${message}"\n\n` +
        `Digite "ajuda" para ver todos os comandos disponíveis.`
    );
  }

  // Enviar mensagem de boas-vindas
  async sendWelcomeMessage(phoneNumber) {
    await this.sendMessage(
      phoneNumber,
      `🤖 **BEM-VINDO AO BOT FINANCEIRO!**\n\n` +
        `💰 **Controle suas finanças via WhatsApp**\n\n` +
        `**Como usar:**\n` +
        `• "Gastei 50 no Uber" - Registra despesa\n` +
        `• "Recebi 2500 do salário" - Registra receita\n` +
        `• "Quanto tenho agora?" - Consulta saldo\n` +
        `• "Resumo da semana" - Relatório\n\n` +
        `📷 **Envie uma foto de recibo** para extração automática!\n\n` +
        `Digite "ajuda" para ver todos os comandos.`
    );
  }

  // ✅ NOVO: Método para responder saudações
  async sendGreetingMessage(phoneNumber, userName) {
    const now = new Date();
    const hour = now.getHours();

    let greeting;
    if (hour < 12) {
      greeting = "🌅 Bom dia";
    } else if (hour < 18) {
      greeting = "☀️ Boa tarde";
    } else {
      greeting = "🌙 Boa noite";
    }

    const name = userName ? `, ${userName}` : "";

    const message =
      `${greeting}${name}! 👋\n\n` +
      `💰 **Como posso ajudar com suas finanças hoje?**\n\n` +
      `📊 **Comandos rápidos:**\n` +
      `• "Saldo" - Ver saldo atual\n` +
      `• "Gastei 50 no mercado" - Registrar despesa\n` +
      `• "Recebi 2000 do salário" - Registrar receita\n` +
      `• "Resumo da semana" - Ver relatório\n\n` +
      `📷 **Ou envie uma foto do recibo!**\n\n` +
      `💡 Digite *menu* para ver todas as opções.`;

    await this.sendMessage(phoneNumber, message);
  }

  // Enviar mensagem de ajuda
  async sendHelpMessage(phoneNumber) {
    const helpMessage = this.nlp.generateHelpMessage();
    await this.sendMessage(phoneNumber, helpMessage);
  }

  // Enviar mensagem de erro
  async sendErrorMessage(phoneNumber) {
    await this.sendMessage(
      phoneNumber,
      `❌ **Erro interno**\n\n` +
        `Desculpe, ocorreu um erro. Tente novamente em alguns instantes.\n\n` +
        `Se o problema persistir, entre em contato com o suporte.`
    );
  }

  // Enviar mensagem
  async sendMessage(phoneNumber, message) {
    try {
      await this.whatsapp.sendMessage(phoneNumber, message);
    } catch (error) {
      console.error("❌ Erro ao enviar mensagem:", error);
    }
  }

  // ✅ ADICIONE ESTES MÉTODOS NO SEU BOTCONTROLLER.JS
  // Coloque depois do método processTextMessage e antes do processMediaMessage

  // 5. ✅ CORRIGIR também o parseDirectCommand (se estiver usando)
  parseDirectCommand(messageText) {
    console.log(`🔍 Analisando comando direto: "${messageText}"`);

    const text = messageText.toLowerCase().trim();

    const patterns = [
      {
        regex:
          /^(gastei|paguei|comprei|gasto)\s+(\d+(?:[.,]\d{2})?)\s+(?:no|na|de|em|para|pro|pra)\s+(.+)$/i,
        type: "expense",
        extract: (match) => ({
          type: "expense",
          amount: parseFloat(match[2].replace(",", ".")),
          description: match[3].trim(),
          category: this.safeCategorizeName(match[3]) || "outros", // ✅ CORRIGIR
          date: new Date(),
        }),
      },

      {
        regex:
          /^(recebi|ganhei|entrou)\s+(\d+(?:[.,]\d{2})?)\s+(?:do|da|de|em)?\s*(.*)$/i,
        type: "income",
        extract: (match) => ({
          type: "income",
          amount: parseFloat(match[2].replace(",", ".")),
          description: match[3].trim() || "Receita",
          category: "receita",
          date: new Date(),
        }),
      },

      {
        regex: /^(\d+(?:[.,]\d{2})?)\s*(?:reais?)?\s+(.+)$/i,
        type: "expense",
        extract: (match) => ({
          type: "expense",
          amount: parseFloat(match[1].replace(",", ".")),
          description: match[2].trim(),
          category: this.safeCategorizeName(match[2]) || "outros", // ✅ CORRIGIR
          date: new Date(),
        }),
      },
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern.regex);
      if (match) {
        console.log(`✅ Comando direto encontrado:`, pattern.type);
        return {
          found: true,
          type: pattern.type,
          data: pattern.extract(match),
        };
      }
    }

    console.log(`❌ Nenhum comando direto encontrado`);
    return { found: false };
  }

  // ✅ 2. MÉTODO handleDirectTransaction (se não existir)
  async handleDirectTransaction(user, commandData) {
    try {
      console.log(`⚡ Processando comando direto:`, commandData);

      // Validar dados básicos
      if (!commandData.data.amount || commandData.data.amount <= 0) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Valor inválido**\n\n` + `Exemplo correto: "gastei 50 no uber"`
        );
        return;
      }

      // Usar o método handleTransaction que já existe
      return await this.handleTransaction(user, commandData.data);
    } catch (error) {
      console.error("❌ Erro ao processar comando direto:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ 3. MÉTODO handleComparisonReport (se não existir)
  async handleComparisonReport(user) {
    try {
      console.log(`📊 Gerando relatório comparativo para:`, user.phoneNumber);

      // Verificar se o ReportService tem o método generateComparisonTextReport
      if (typeof this.report.generateComparisonTextReport !== "function") {
        console.log(
          "⚠️ Método generateComparisonTextReport não existe no ReportService"
        );

        // Fallback: usar relatório mensal normal
        const reportResult = await this.report.generatePeriodTextReport(
          user.id,
          "month"
        );

        if (reportResult.success) {
          const message =
            `📊 **Relatório do Mês Atual**\n\n` +
            `${reportResult.report}\n\n` +
            `💡 *Relatório comparativo em desenvolvimento*`;
          await this.sendMessage(user.phoneNumber, message);
        } else {
          await this.sendMessage(
            user.phoneNumber,
            "❌ **Erro ao gerar relatório**\n\n" +
              "Tente novamente em alguns instantes."
          );
        }
        return;
      }

      // Se o método existe, usar normalmente
      const reportResult = await this.report.generateComparisonTextReport(
        user.id
      );

      if (reportResult.success) {
        await this.sendMessage(user.phoneNumber, reportResult.report);
      } else {
        await this.sendMessage(
          user.phoneNumber,
          "❌ **Erro ao gerar relatório comparativo**\n\n" +
            "Não há dados suficientes para comparação."
        );
      }
    } catch (error) {
      console.error("❌ Erro ao gerar relatório comparativo:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ 4. MÉTODOS para gerenciar sessões (se não existirem)
  isConfirmationPending(session) {
    if (!session) return false;

    // Verificar se não expirou (5 minutos)
    const now = Date.now();
    const sessionAge = now - session.timestamp;
    const fiveMinutes = 5 * 60 * 1000;

    return sessionAge < fiveMinutes;
  }

  // ✅ ATUALIZAR handleConfirmationResponse para incluir confirmação de delete
  async handleConfirmationResponse(user, messageText, session) {
    try {
      console.log(`🔄 Processando resposta: ${session.type}`);

      // ✅ NOVA: Confirmação de delete do cofrinho
      if (session.type === "delete_cofrinho_confirmation") {
        this.sessions.delete(user.phoneNumber);

        if (messageText.match(/^(sim|s|yes|confirmar|confirmo)$/i)) {
          try {
            const Cofrinho = require("../models/Cofrinho");
            const cofrinho = await Cofrinho.findById(session.data.cofrinhoId);

            if (cofrinho) {
              await cofrinho.deletarPermanentemente();
              await this.sendMessage(
                user.phoneNumber,
                `✅ **Cofrinho deletado!**\n\n` +
                  `🗑️ O cofrinho "${session.data.nome}" foi removido permanentemente.\n\n` +
                  `💡 Digite "meus cofrinhos" para ver os restantes.`
              );
            } else {
              await this.sendMessage(
                user.phoneNumber,
                `❌ **Cofrinho não encontrado**\n\nO cofrinho pode já ter sido deletado.`
              );
            }
          } catch (error) {
            await this.sendMessage(
              user.phoneNumber,
              `❌ **Erro ao deletar cofrinho**\n\n${error.message}`
            );
          }
        } else if (messageText.match(/^(não|nao|n|no|cancelar)$/i)) {
          await this.sendMessage(
            user.phoneNumber,
            `❌ **Exclusão cancelada**\n\n` +
              `O cofrinho "${session.data.nome}" não foi deletado.`
          );
        } else {
          await this.sendMessage(
            user.phoneNumber,
            `❓ **Não entendi sua resposta**\n\n` +
              `Digite "sim" para confirmar a exclusão ou "não" para cancelar.`
          );
          // Manter a sessão ativa
          this.sessions.set(user.phoneNumber, session);
        }
        return;
      }

      // ✅ VERIFICAR SE ESTÁ EDITANDO ALGO ESPECÍFICO
      if (session.type.startsWith("editing_")) {
        return await this.handleEditInput(user, messageText, session);
      }

      // ✅ VERIFICAR SE É COMANDO DE EDIÇÃO
      if (session.type === "ocr_confirmation_editable") {
        const editCommand = this.parseEditCommand(messageText);

        if (editCommand.isEdit) {
          return await this.handleEditCommand(user, editCommand, session);
        }
      }

      // ✅ CONFIRMAR OU CANCELAR (comportamento original)
      this.sessions.delete(user.phoneNumber);

      if (messageText.match(/^(sim|s|yes|confirma|ok|confirmar)$/i)) {
        console.log(`✅ Confirmação aceita`);

        if (
          session.type === "ocr_confirmation" ||
          session.type === "ocr_confirmation_editable" ||
          session.type === "audio_confirmation"
        ) {
          return await this.handleTransaction(user, session.data);
        }
      } else if (messageText.match(/^(não|nao|n|no|cancelar|cancel)$/i)) {
        console.log(`❌ Confirmação rejeitada`);

        await this.sendMessage(
          user.phoneNumber,
          `❌ **Operação cancelada**\n\n` + `Os dados não foram salvos.`
        );
      } else {
        console.log(`⚠️ Resposta ambígua`);

        let helpMessage = `❓ **Não entendi sua resposta**\n\n`;

        if (session.type === "ocr_confirmation_editable") {
          helpMessage +=
            `Comandos disponíveis:\n` +
            `• *"confirmar"* - Salvar como está\n` +
            `• *"editar valor"* - Corrigir valor\n` +
            `• *"editar categoria"* - Corrigir categoria\n` +
            `• *"cancelar"* - Não salvar`;
        } else {
          helpMessage +=
            `• **"confirmar"** - Salvar\n` + `• **"cancelar"** - Não salvar`;
        }

        await this.sendMessage(user.phoneNumber, helpMessage);
        this.sessions.set(user.phoneNumber, session);
      }
    } catch (error) {
      console.error("❌ Erro ao processar confirmação:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ ATUALIZAR o handleEditInput para incluir data

  async handleEditInput(user, messageText, session) {
    try {
      const input = messageText.trim();
      const updatedData = { ...session.data };
      let editType = "";

      switch (session.type) {
        case "editing_amount":
          const amount = parseFloat(input.replace(",", "."));
          if (isNaN(amount) || amount <= 0 || amount >= 100000) {
            await this.sendMessage(
              user.phoneNumber,
              `❌ **Valor inválido**\n\n` +
                `Digite apenas números entre 0,01 e 99.999,99\n` +
                `Exemplo: "50" ou "25.90"`
            );
            return;
          }
          updatedData.amount = amount;
          editType = "amount";
          break;

        case "editing_category":
          updatedData.category = this.safeCategorizeName(input) || input;
          editType = "category";
          break;

        case "editing_establishment":
          updatedData.establishment = input;
          const newCategory = this.safeCategorizeName(input);
          if (newCategory) {
            updatedData.category = newCategory;
          }
          editType = "establishment";
          break;

        // ✅ NOVO: Processar edição de data
        case "editing_date":
          const parsedDate = this.parseDate(input);
          if (!parsedDate) {
            await this.sendMessage(
              user.phoneNumber,
              `❌ **Data inválida**\n\n` +
                `Use um destes formatos:\n` +
                `• "15/08/2025"\n` +
                `• "15/08" (ano atual)\n` +
                `• "15-08-2025"\n\n` +
                `Tente novamente!`
            );
            return;
          }
          updatedData.date = parsedDate;
          editType = "date";
          break;
      }

      const updatedMessage = this.generateUpdatedConfirmationMessage(
        updatedData,
        { type: editType }
      );
      await this.sendMessage(user.phoneNumber, updatedMessage);

      this.sessions.set(user.phoneNumber, {
        type: "ocr_confirmation_editable",
        data: updatedData,
        originalData: session.originalData,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("❌ Erro ao processar input de edição:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  safeCategorizeName(name) {
    try {
      console.log(`🔍 CATEGORIZANDO: "${name}"`);

      // ✅ USAR CATEGORIZAÇÃO PRÓPRIA PRIMEIRO (mais confiável)
      const manualCategory = this.manualCategorization(name);
      if (manualCategory !== "outros") {
        console.log(
          `✅ Categorização manual SUCESSO: "${name}" → "${manualCategory}"`
        );
        return manualCategory;
      }

      // ✅ TENTAR NLP como backup
      if (
        this.nlp &&
        typeof this.nlp.determineAdvancedCategory === "function"
      ) {
        console.log(`🧠 Tentando NLP.determineAdvancedCategory`);
        const category = this.nlp.determineAdvancedCategory(name, name);
        if (category && category !== "outros") {
          console.log(`✅ NLP SUCESSO: "${name}" → "${category}"`);
          return category;
        }
      }

      // ✅ TENTAR OCR como último recurso
      if (this.ocr && typeof this.ocr.determineCategory === "function") {
        console.log(`🔍 Tentando OCR.determineCategory`);
        const category = this.ocr.determineCategory(name, name);
        if (category && category !== "outros") {
          console.log(`✅ OCR SUCESSO: "${name}" → "${category}"`);
          return category;
        }
      }

      console.log(`📂 Usando categoria padrão "outros" para: "${name}"`);
      return "outros";
    } catch (error) {
      console.error("❌ Erro na categorização:", error);
      return "outros";
    }
  }

  // ✅ NOVO: Categorização manual robusta
  manualCategorization(text) {
    if (!text || typeof text !== "string") return "outros";

    const lowerText = text.toLowerCase().trim();
    console.log(`🧪 Categorização manual para: "${lowerText}"`);

    // ✅ MAPEAMENTO COMPLETO E ROBUSTO
    const categoryMap = {
      // VESTUÁRIO (com todas as variações)
      vestuário: [
        "vestuario",
        "vestuário",
        "roupa",
        "roupas",
        "sapato",
        "sapatos",
        "tenis",
        "tênis",
        "calçado",
        "calçados",
        "loja",
        "shopping",
        "renner",
        "cea",
        "c&a",
        "riachuelo",
        "zara",
        "hm",
        "h&m",
        "magazine luiza",
        "shein",
        "nike",
        "adidas",
        "puma",
        "hering",
        "farm",
        "polo",
        "lacoste",
        "osklen",
        "animale",
      ],

      // ALIMENTAÇÃO
      alimentação: [
        "alimentacao",
        "alimentação",
        "comida",
        "mercado",
        "supermercado",
        "super",
        "carrefour",
        "extra",
        "walmart",
        "pao de acucar",
        "mc",
        "mcdonald",
        "mcdonalds",
        "burger",
        "burguer",
        "burger king",
        "kfc",
        "subway",
        "pizza",
        "pizzaria",
        "restaurante",
        "lanchonete",
        "padaria",
        "bar",
        "cafeteria",
        "ifood",
        "uber eats",
        "delivery",
      ],

      // TRANSPORTE
      transporte: [
        "transporte",
        "uber",
        "taxi",
        "99",
        "posto",
        "gasolina",
        "combustivel",
        "combustível",
        "alcool",
        "álcool",
        "shell",
        "petrobras",
        "ipiranga",
        "ale",
        "onibus",
        "ônibus",
        "metro",
        "metrô",
        "estacionamento",
        "pedagio",
        "pedágio",
      ],

      // SAÚDE
      saúde: [
        "saude",
        "saúde",
        "farmacia",
        "farmácia",
        "drogaria",
        "drogasil",
        "pacheco",
        "raia",
        "ultrafarma",
        "medico",
        "médico",
        "hospital",
        "clinica",
        "clínica",
        "remedio",
        "remédio",
        "consulta",
        "exame",
        "dentista",
        "laboratorio",
        "laboratório",
      ],

      // CONTAS
      contas: [
        "conta",
        "contas",
        "luz",
        "energia",
        "cemig",
        "light",
        "agua",
        "água",
        "saneamento",
        "sabesp",
        "gas",
        "gás",
        "comgas",
        "telefone",
        "celular",
        "tim",
        "vivo",
        "claro",
        "oi",
        "internet",
        "netflix",
        "spotify",
        "amazon prime",
        "streaming",
      ],

      // LAZER
      lazer: [
        "lazer",
        "cinema",
        "teatro",
        "show",
        "festa",
        "viagem",
        "hotel",
        "pousada",
        "parque",
        "clube",
        "academia",
        "esporte",
        "jogo",
      ],

      // CASA
      casa: [
        "casa",
        "construcao",
        "construção",
        "tinta",
        "ferramenta",
        "moveis",
        "móveis",
        "decoracao",
        "decoração",
        "jardim",
        "limpeza",
        "manutencao",
        "manutenção",
      ],

      // EDUCAÇÃO
      educação: [
        "educacao",
        "educação",
        "escola",
        "curso",
        "livro",
        "material",
        "faculdade",
        "universidade",
        "aula",
        "professor",
      ],
    };

    // ✅ BUSCAR MATCH EXATO OU CONTIDO
    for (const [category, keywords] of Object.entries(categoryMap)) {
      console.log(`🔍 Testando categoria "${category}"...`);

      for (const keyword of keywords) {
        // Match exato ou contido
        if (lowerText === keyword || lowerText.includes(keyword)) {
          console.log(
            `🎯 MATCH! "${lowerText}" ${
              lowerText === keyword ? "igual a" : "contém"
            } "${keyword}" → "${category}"`
          );
          return category;
        }
      }
    }

    console.log(`❌ Nenhum match encontrado para "${lowerText}"`);
    return "outros";
  }

  // ✅ ATUALIZAR o parseEditCommand para incluir data

  parseEditCommand(messageText) {
    const text = messageText.toLowerCase().trim();

    console.log(`🔍 Analisando comando de edição: "${text}"`);

    const patterns = [
      // Apenas "editar data"
      {
        regex: /^editar\s+data$/i,
        type: "date_request",
      },

      // "editar data 15/08/2025" (direto)
      {
        regex: /^editar\s+data\s+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]?\d{0,4})$/i,
        type: "date",
        extract: (match) => this.parseDate(match[1]),
      },

      // ✅ MANTER os existentes
      {
        regex: /^editar\s+valor$/i,
        type: "amount_request",
      },

      {
        regex: /^editar\s+categoria$/i,
        type: "category_request",
      },

      {
        regex: /^editar\s+(?:estabelecimento|local)$/i,
        type: "establishment_request",
      },

      // Comandos diretos
      {
        regex: /^editar\s+valor\s+(\d+(?:[.,]\d{2})?)$/i,
        type: "amount",
        extract: (match) => parseFloat(match[1].replace(",", ".")),
      },

      {
        regex: /^editar\s+categoria\s+(.+)$/i,
        type: "category",
        extract: (match) => match[1].trim(),
      },

      {
        regex: /^editar\s+(?:estabelecimento|local)\s+(.+)$/i,
        type: "establishment",
        extract: (match) => match[1].trim(),
      },
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern.regex);
      if (match) {
        console.log(`✅ Comando de edição encontrado: ${pattern.type}`);

        if (pattern.extract) {
          return {
            isEdit: true,
            type: pattern.type,
            value: pattern.extract(match),
          };
        } else {
          return {
            isEdit: true,
            type: pattern.type,
            needsInput: true,
          };
        }
      }
    }

    console.log(`❌ Não é comando de edição`);
    return { isEdit: false };
  }

  // ✅ NOVO: Método para fazer parse de datas
  parseDate(dateStr) {
    const moment = require("moment");

    console.log(`📅 Fazendo parse da data: "${dateStr}"`);

    // Formatos aceitos: DD/MM/YYYY, DD/MM, DD-MM-YYYY, DD.MM.YYYY
    const formats = [
      "DD/MM/YYYY",
      "DD/MM/YY",
      "DD/MM",
      "DD-MM-YYYY",
      "DD-MM-YY",
      "DD-MM",
      "DD.MM.YYYY",
      "DD.MM.YY",
      "DD.MM",
    ];

    for (const format of formats) {
      const parsed = moment(dateStr, format, true);

      if (parsed.isValid()) {
        // Se não tem ano, usar ano atual
        if (!format.includes("Y")) {
          parsed.year(moment().year());
        }

        console.log(
          `✅ Data parseada: "${dateStr}" → ${parsed.format("DD/MM/YYYY")}`
        );
        return parsed.toDate();
      }
    }

    console.log(`❌ Formato de data inválido: "${dateStr}"`);
    return null;
  }

  // ✅ ATUALIZAR o handleEditCommand para incluir data

  async handleEditCommand(user, editCommand, session) {
    try {
      console.log(`✏️ Processando edição ${editCommand.type}:`, editCommand);

      if (editCommand.needsInput) {
        return await this.handleEditRequest(user, editCommand, session);
      }

      const updatedData = { ...session.data };

      switch (editCommand.type) {
        case "amount":
          if (editCommand.value > 0 && editCommand.value < 100000) {
            updatedData.amount = editCommand.value;
          } else {
            await this.sendMessage(
              user.phoneNumber,
              `❌ **Valor inválido**\n\n` +
                `O valor deve estar entre R$ 0,01 e R$ 99.999,99\n` +
                `Digite "editar valor" para tentar novamente.`
            );
            return;
          }
          break;

        case "category":
          updatedData.category =
            this.safeCategorizeName(editCommand.value) || editCommand.value;
          break;

        case "establishment":
          updatedData.establishment = editCommand.value;
          const newCategory = this.safeCategorizeName(editCommand.value);
          if (newCategory) {
            updatedData.category = newCategory;
          }
          break;

        // ✅ NOVO: Processar edição direta de data
        case "date":
          if (editCommand.value) {
            updatedData.date = editCommand.value;
          } else {
            await this.sendMessage(
              user.phoneNumber,
              `❌ **Data inválida**\n\n` +
                `Use formato DD/MM/YYYY ou digite "editar data" para tentar novamente.`
            );
            return;
          }
          break;
      }

      const updatedMessage = this.generateUpdatedConfirmationMessage(
        updatedData,
        editCommand
      );
      await this.sendMessage(user.phoneNumber, updatedMessage);

      this.sessions.set(user.phoneNumber, {
        ...session,
        data: updatedData,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("❌ Erro ao processar edição:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ SUBSTITUA o generateUpdatedConfirmationMessage no BotController

  generateUpdatedConfirmationMessage(updatedData, editCommand) {
    const moment = require("moment");

    const amountFormatted = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(updatedData.amount);

    let message = `✏️ **DADOS ATUALIZADOS**\n\n`;

    // Valor
    if (editCommand.type === "amount") {
      message += `💰 **Valor:** ${amountFormatted} ✏️\n`;
    } else {
      message += `💰 **Valor:** ${amountFormatted}\n`;
    }

    // Estabelecimento
    if (
      updatedData.establishment &&
      updatedData.establishment !== "Estabelecimento não identificado"
    ) {
      if (editCommand.type === "establishment") {
        message += `🏪 **Estabelecimento:** ${updatedData.establishment} ✏️\n`;
      } else {
        message += `🏪 **Estabelecimento:** ${updatedData.establishment}\n`;
      }
    }

    // Data
    if (updatedData.date) {
      if (editCommand.type === "date") {
        message += `📅 **Data:** ${moment(updatedData.date).format(
          "DD/MM/YYYY"
        )} ✏️\n`;
      } else {
        message += `📅 **Data:** ${moment(updatedData.date).format(
          "DD/MM/YYYY"
        )}\n`;
      }
    }

    // Categoria
    if (editCommand.type === "category") {
      message += `📂 **Categoria:** ${updatedData.category} ✏️\n\n`;
    } else {
      message += `📂 **Categoria:** ${updatedData.category}\n\n`;
    }

    message +=
      `✅ **Edição aplicada com sucesso!**\n\n` +
      `**Próximas opções:**\n` +
      `• *"confirmar"* - Salvar alterações\n` +
      `• *"editar valor/categoria/estabelecimento/data"* - Fazer mais alterações\n` + // ✅ CORRIGIDO
      `• *"cancelar"* - Descartar tudo`;

    return message;
  }

  // ✅ ATUALIZAR o handleEditRequest para incluir data

  async handleEditRequest(user, editCommand, session) {
    try {
      console.log(`🔧 DEBUG - handleEditRequest chamado:`, {
        editCommandType: editCommand.type,
        userPhone: user.phoneNumber,
        sessionType: session.type,
      });

      let promptMessage = "";
      let sessionType = "";

      switch (editCommand.type) {
        case "amount_request":
          promptMessage =
            `💰 **Digite o valor correto:**\n\n` +
            `Exemplos:\n` +
            `• "50" (R$ 50,00)\n` +
            `• "25.90" (R$ 25,90)\n` +
            `• "150" (R$ 150,00)\n\n` +
            `💡 Apenas números, por favor!`;
          sessionType = "editing_amount";
          break;

        case "category_request":
          promptMessage =
            `📂 **Digite a categoria correta:**\n\n` +
            `Exemplos:\n` +
            `• "alimentação"\n` +
            `• "transporte"\n` +
            `• "saúde"\n` +
            `• "vestuário"\n\n` +
            `💡 Eu vou categorizar automaticamente!`;
          sessionType = "editing_category";
          break;

        case "establishment_request":
          promptMessage =
            `🏪 **Digite o nome do estabelecimento:**\n\n` +
            `Exemplos:\n` +
            `• "Mercado Extra"\n` +
            `• "Posto Shell"\n` +
            `• "Farmácia Pacheco"\n\n` +
            `💡 Vou ajustar a categoria baseada no local!`;
          sessionType = "editing_establishment";
          break;

        // ✅ NOVO: Prompt para data
        case "date_request":
          promptMessage =
            `📅 **Digite a data correta:**\n\n` +
            `Formatos aceitos:\n` +
            `• "15/08/2025" (completa)\n` +
            `• "15/08" (ano atual)\n` +
            `• "15-08-2025" (com traços)\n` +
            `• "15.08.2025" (com pontos)\n\n` +
            `💡 Use o formato DD/MM/YYYY ou DD/MM!`;
          sessionType = "editing_date";
          break;

        default:
          console.error(
            `❌ Tipo de edição não reconhecido: ${editCommand.type}`
          );
          await this.sendMessage(
            user.phoneNumber,
            `❌ **Erro interno**\n\n` +
              `Tipo de edição não reconhecido. Digite "cancelar" para sair.`
          );
          return;
      }

      console.log(`📤 Enviando prompt para ${sessionType}`);
      await this.sendMessage(user.phoneNumber, promptMessage);

      this.sessions.set(user.phoneNumber, {
        ...session,
        type: sessionType,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("❌ Erro em handleEditRequest:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ 5. PROPRIEDADE para rastrear tipo de mensagem (se necessário)
  setLastMessageType(type) {
    this.lastMessageType = type;
  }

  // ✅ ADICIONE ESTE MÉTODO NO SEU BOTCONTROLLER.JS

  async handleWeeklyPDFRequest(user) {
    try {
      console.log("📄 Processando PDF semanal para:", user.phoneNumber);

      await this.sendMessage(
        user.phoneNumber,
        "📄 **Gerando PDF do resumo semanal...**\n\n" +
          "⏳ Aguarde alguns instantes, estou preparando seu relatório!"
      );

      // ✅ BUSCAR DADOS DA SEMANA
      const { startDate, endDate } = this.getWeekDates();

      const transactions = await Transaction.findByUser(user.id, {
        startDate,
        endDate,
      });

      const stats = this.calculateWeeklyStats(transactions);
      const balance = await Transaction.getCurrentBalance(user.id);

      // ✅ FORMATAR DADOS PARA O PDF
      const dadosResumo = PdfService.formatarDadosResumo(
        transactions,
        stats,
        balance,
        startDate,
        endDate
      );

      // ✅ GERAR PDF
      const pdfBuffer = await PdfService.gerarPDFResumoSemanal(dadosResumo);

      // ✅ ENVIAR PDF
      await this.whatsapp.sendMedia(
        user.phoneNumber,
        pdfBuffer,
        "pdf",
        "resumo_semanal.pdf"
      );

      // ✅ CONFIRMAR ENVIO
      await this.sendMessage(
        user.phoneNumber,
        "✅ **PDF enviado com sucesso!**\n\n" +
          "📊 Seu resumo semanal está anexado acima.\n\n" +
          '💡 Digite *"resumo mensal"* para ver o relatório do mês!'
      );
    } catch (error) {
      console.error("❌ Erro ao gerar PDF semanal:", error);
      await this.sendMessage(
        user.phoneNumber,
        "❌ **Erro ao gerar PDF**\n\n" +
          "Não consegui gerar o relatório. Tente novamente em alguns instantes."
      );
    }
  }

  // ✅ ADICIONE ESTES MÉTODOS AUXILIARES NO SEU BOTCONTROLLER

  // Obter datas da semana
  getWeekDates() {
    const moment = require("moment");
    const now = moment();
    const startDate = now.clone().startOf("week").toDate(); // Segunda-feira
    const endDate = now.clone().endOf("week").toDate(); // Domingo

    return { startDate, endDate };
  }

  // Calcular estatísticas da semana
  calculateWeeklyStats(transactions) {
    const moment = require("moment");

    const stats = {
      totalIncome: 0,
      totalExpenses: 0,
      transactionCount: transactions.length,
      categories: {},
      dailyData: {},
    };

    // Inicializar dados diários (Segunda a Domingo)
    for (let i = 0; i < 7; i++) {
      const day = moment().startOf("week").add(i, "days");
      stats.dailyData[day.format("YYYY-MM-DD")] = {
        date: day.format("DD/MM"),
        dayName: day.format("dddd"),
        income: 0,
        expenses: 0,
        transactions: [],
      };
    }

    // Processar transações
    transactions.forEach((t) => {
      const dayKey = moment(t.date).format("YYYY-MM-DD");

      if (t.type === "income") {
        stats.totalIncome += t.amount;
        if (stats.dailyData[dayKey]) {
          stats.dailyData[dayKey].income += t.amount;
        }
      } else {
        stats.totalExpenses += t.amount;
        if (stats.dailyData[dayKey]) {
          stats.dailyData[dayKey].expenses += t.amount;
        }

        // Agrupar por categoria
        if (!stats.categories[t.category]) {
          stats.categories[t.category] = { total: 0, count: 0 };
        }
        stats.categories[t.category].total += t.amount;
        stats.categories[t.category].count += 1;
      }

      // Adicionar à lista diária
      if (stats.dailyData[dayKey]) {
        stats.dailyData[dayKey].transactions.push(t);
      }
    });

    return stats;
  }

  // 1. Handler para PDF mensal
  async handleMonthlyPDFRequest(user) {
    try {
      console.log("📄 Processando PDF mensal para:", user.phoneNumber);

      await this.sendMessage(
        user.phoneNumber,
        "📄 **Gerando PDF do resumo mensal...**\n\n" +
          "⏳ Aguarde alguns instantes, este relatório é mais completo!"
      );

      // ✅ BUSCAR DADOS DO MÊS ATUAL
      const { startDate, endDate } = this.getMonthDates();

      const transactions = await Transaction.findByUser(user.id, {
        startDate,
        endDate,
      });

      const stats = this.calculateMonthlyStats(transactions);
      const balance = await Transaction.getCurrentBalance(user.id);

      // ✅ BUSCAR DADOS DO MÊS ANTERIOR PARA COMPARATIVO
      const { startDate: prevStartDate, endDate: prevEndDate } =
        this.getPreviousMonthDates();

      const prevTransactions = await Transaction.findByUser(user.id, {
        startDate: prevStartDate,
        endDate: prevEndDate,
      });

      const prevStats = this.calculateMonthlyStats(prevTransactions);

      // ✅ FORMATAR DADOS PARA O PDF
      const dadosResumo = PdfService.formatarDadosMensais(
        transactions,
        stats,
        balance,
        startDate,
        endDate,
        prevStats // Para comparativo
      );

      // ✅ GERAR PDF
      const pdfBuffer = await PdfService.gerarPDFResumoMensal(dadosResumo);

      // ✅ ENVIAR PDF
      await this.whatsapp.sendMedia(
        user.phoneNumber,
        pdfBuffer,
        "pdf",
        "resumo_mensal.pdf"
      );

      // ✅ CONFIRMAR ENVIO
      await this.sendMessage(
        user.phoneNumber,
        "✅ **PDF mensal enviado com sucesso!**\n\n" +
          "📊 Seu relatório completo do mês está anexado acima.\n\n" +
          "📈 Inclui comparativo com mês anterior e análise detalhada!\n\n" +
          '💡 Digite *"pdf anual"* para ver o relatório do ano (em breve)!'
      );
    } catch (error) {
      console.error("❌ Erro ao gerar PDF mensal:", error);
      await this.sendMessage(
        user.phoneNumber,
        "❌ **Erro ao gerar PDF mensal**\n\n" +
          "Não consegui gerar o relatório. Tente novamente em alguns instantes."
      );
    }
  }

  // 2. Obter datas do mês atual
  getMonthDates() {
    const moment = require("moment");
    const now = moment();
    const startDate = now.clone().startOf("month").toDate();
    const endDate = now.clone().endOf("month").toDate();

    return { startDate, endDate };
  }

  // 3. Obter datas do mês anterior
  getPreviousMonthDates() {
    const moment = require("moment");
    const now = moment().subtract(1, "month");
    const startDate = now.clone().startOf("month").toDate();
    const endDate = now.clone().endOf("month").toDate();

    return { startDate, endDate };
  }

  // 4. Calcular estatísticas mensais (mais completas que semanal)
  calculateMonthlyStats(transactions) {
    const moment = require("moment");

    const stats = {
      totalIncome: 0,
      totalExpenses: 0,
      transactionCount: transactions.length,
      categories: {},
      weeklyData: {},
      dailyData: {},
    };

    // Processar transações
    transactions.forEach((t) => {
      if (t.type === "income") {
        stats.totalIncome += t.amount;
      } else {
        stats.totalExpenses += t.amount;

        // Agrupar por categoria
        if (!stats.categories[t.category]) {
          stats.categories[t.category] = { total: 0, count: 0 };
        }
        stats.categories[t.category].total += t.amount;
        stats.categories[t.category].count += 1;
      }
    });

    return stats;
  }

  // ✅ ATUALIZAR handleCreateCofrinho com validações melhoradas
  async handleCreateCofrinho(user, data) {
    try {
      console.log(`💰 Criando cofrinho para ${user.phoneNumber}:`, data);

      const Cofrinho = require("../models/Cofrinho");

      // ✅ ADICIONAR ESTE LOG
      console.log(
        `🧪 DEBUG - Verificando se nome "${data.nome}" já existe para user ${user.id}`
      );

      // ✅ VALIDAÇÃO APRIMORADA
      const errors = Cofrinho.validate({
        ...data,
        userId: user.id,
      });

      if (errors.length > 0) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Erro ao criar cofrinho:**\n\n` +
            `${errors.join("\n")}\n\n` +
            `**Exemplo correto:**\n` +
            `"cofrinho viagem 5000" ou\n` +
            `"cofrinho casa 50000 para comprar casa própria"`
        );
        return;
      }

      // ✅ VERIFICAR SE NOME JÁ EXISTE
      const nomeJaExiste = await Cofrinho.nomeJaExiste(user.id, data.nome);
      if (nomeJaExiste) {
        await this.sendMessage(
          user.phoneNumber,
          `⚠️ **Cofrinho já existe!**\n\n` +
            `Você já tem um cofrinho chamado "${data.nome}".\n\n` +
            `**Opções:**\n` +
            `• "guardar 100 no cofrinho ${data.nome}" - Adicionar dinheiro\n` +
            `• "editar cofrinho ${data.nome} meta ${data.meta}" - Alterar meta\n` +
            `• "cofrinho ${data.nome}" - Ver status atual`
        );
        return;
      }

      // Criar cofrinho
      const cofrinho = await Cofrinho.create({
        userId: user.id,
        nome: data.nome,
        meta: data.meta,
        descricao: data.descricao,
      });

      const metaFormatted = this.formatarMoeda(data.meta);

      let message =
        `🎯 **Cofrinho criado com sucesso!**\n\n` +
        `💰 **Nome:** ${data.nome}\n` +
        `🎯 **Meta:** ${metaFormatted}\n`;

      if (data.descricao) {
        message += `📝 **Objetivo:** ${data.descricao}\n`;
      }

      message +=
        `\n**Como usar:**\n` +
        `• "guardar 100 no cofrinho ${data.nome}" - Guardar dinheiro\n` +
        `• "retirar 50 do cofrinho ${data.nome}" - Retirar dinheiro\n` +
        `• "cofrinho ${data.nome}" - Ver progresso\n` +
        `• "meus cofrinhos" - Ver todos\n\n` +
        `💡 **Dica:** Comece guardando um valor pequeno para criar o hábito!`;

      await this.sendMessage(user.phoneNumber, message);
      await this.ofereceAutorizacaoCalendar(user, "cofrinho");
    } catch (error) {
      console.error("❌ Erro ao criar cofrinho:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ ATUALIZAR handleAddToCofrinho com melhorias
  async handleAddToCofrinho(user, nomeCofrinho, valor) {
    try {
      console.log(`💰 Adicionando R$ ${valor} ao cofrinho ${nomeCofrinho}`);

      const Cofrinho = require("../models/Cofrinho");

      // ✅ VALIDAÇÃO MELHORADA
      if (
        typeof valor !== "number" ||
        isNaN(valor) ||
        valor <= 0 ||
        valor > 100000
      ) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Valor inválido**\n\n` +
            `O valor deve estar entre R$ 0,01 e R$ 100.000,00\n\n` +
            `**Exemplos corretos:**\n` +
            `• "guardar 50 no cofrinho viagem"\n` +
            `• "guardar 150.50 no cofrinho casa"`
        );
        return;
      }

      const cofrinho = await Cofrinho.findByName(user.id, nomeCofrinho);
      if (!cofrinho) {
        // ✅ SUGESTÃO INTELIGENTE
        const todosCofrinhos = await Cofrinho.findByUser(user.id);

        let message =
          `❌ **Cofrinho não encontrado**\n\n` +
          `Não existe cofrinho chamado "${nomeCofrinho}".\n\n`;

        if (todosCofrinhos.length > 0) {
          message += `**Seus cofrinhos:**\n`;
          todosCofrinhos.slice(0, 3).forEach((c) => {
            message += `• ${c.nome}\n`;
          });

          if (todosCofrinhos.length > 3) {
            message += `• ... e mais ${todosCofrinhos.length - 3}\n`;
          }

          message += `\n💡 Digite "meus cofrinhos" para ver todos.`;
        } else {
          message +=
            `**Como criar:**\n` +
            `• "cofrinho ${nomeCofrinho} ${valor * 10}" - Criar novo cofrinho`;
        }

        await this.sendMessage(user.phoneNumber, message);
        return;
      }

      // Adicionar valor (usa transação atômica)
      const sucesso = await cofrinho.adicionarValor(
        valor,
        `Depósito via WhatsApp`
      );

      if (!sucesso) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Erro ao guardar dinheiro**\n\n` +
            `Não foi possível adicionar o valor. Tente novamente em alguns instantes.`
        );
        return;
      }

      // ✅ REGISTRAR como transferência na conta principal com transação atômica
      try {
        const Transaction = require("../models/Transaction");
        await Transaction.create({
          userId: user.id,
          type: "expense",
          amount: valor,
          category: "transferencia",
          description: `Transferência para cofrinho ${nomeCofrinho}`,
          date: new Date(),
        });
      } catch (transactionError) {
        console.error(
          "⚠️ Erro ao registrar transação principal:",
          transactionError
        );
        // Não bloquear o fluxo, apenas logar o erro
      }

      const progresso = cofrinho.calcularProgresso();

      // ✅ VERIFICAR MARCOS E CRIAR LEMBRETES
      if (progresso.percentual >= 80 && progresso.percentual < 85) {
        try {
          // ✅ ADICIONAR ESTA VERIFICAÇÃO:
          if (await user.isCalendarAuthorized()) {
            const authSuccess = await this.calendar.setUserAuth(user.id);
            if (authSuccess) {
              await this.calendar.criarLembreteCofrinho80(user.id, cofrinho);
              console.log("✅ Lembrete 80% criado no Calendar");
            }
          } else {
            console.log(
              "⚠️ Usuário não autorizou Calendar - pulando lembrete 80%"
            );
          }
        } catch (calendarError) {
          console.error("⚠️ Erro Calendar 80%:", calendarError);
        }
      }

      if (progresso.atingido) {
        try {
          // ✅ ADICIONAR ESTA VERIFICAÇÃO:
          if (await user.isCalendarAuthorized()) {
            const authSuccess = await this.calendar.setUserAuth(user.id);
            if (authSuccess) {
              await this.calendar.criarLembreteCofrinhoMeta(user.id, cofrinho);
              console.log("✅ Lembrete meta atingida criado no Calendar");
            }
          } else {
            console.log(
              "⚠️ Usuário não autorizou Calendar - pulando lembrete meta"
            );
          }
        } catch (calendarError) {
          console.error("⚠️ Erro Calendar meta:", calendarError);
        }
      }

      let message =
        `💰 **Valor guardado no cofrinho!**\n\n` +
        `🏦 **Cofrinho:** ${nomeCofrinho}\n` +
        `💵 **Valor guardado:** ${this.formatarMoeda(valor)}\n` +
        `📊 **Total guardado:** ${this.formatarMoeda(progresso.valorAtual)}\n` +
        `🎯 **Meta:** ${this.formatarMoeda(progresso.meta)}\n` +
        `📈 **Progresso:** ${progresso.percentual}%\n\n`;

      if (progresso.atingido) {
        message +=
          `🎉 **PARABÉNS! META ATINGIDA!** 🎉\n\n` +
          `✨ Você conseguiu! Agora pode:\n` +
          `• Usar o dinheiro guardado\n` +
          `• Criar uma nova meta maior\n` +
          `• Criar outro cofrinho\n\n`;
      } else {
        message += `🎯 **Faltam:** ${this.formatarMoeda(progresso.faltam)}\n\n`;

        // ✅ SUGESTÕES INTELIGENTES
        const percentualAtual = parseFloat(progresso.percentual);
        if (percentualAtual >= 75) {
          message += `🏁 **Quase lá!** Continue firme, falta pouco!\n`;
        } else if (percentualAtual >= 50) {
          message += `💪 **Metade do caminho!** Você está indo bem!\n`;
        } else if (percentualAtual >= 25) {
          message += `🚀 **Bom progresso!** Continue assim!\n`;
        } else {
          message += `🌱 **Primeiro passo dado!** Todo grande objetivo começa assim!\n`;
        }
      }

      message +=
        `\n💡 **Próximos comandos:**\n` +
        `• "guardar [valor] no cofrinho ${nomeCofrinho}" - Guardar mais\n` +
        `• "relatório cofrinho ${nomeCofrinho}" - Ver análise detalhada`;

      await this.sendMessage(user.phoneNumber, message);

      // ✅ VERIFICAR SE ATINGIU MARCOS IMPORTANTES
      await this.checkMilestones(user, cofrinho, progresso);
    } catch (error) {
      console.error("❌ Erro ao adicionar ao cofrinho:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ NOVO: Verificar marcos importantes
  async checkMilestones(user, cofrinho, progresso) {
    try {
      const percentual = parseFloat(progresso.percentual);
      const marcos = [25, 50, 75, 90];

      // Verificar se atingiu algum marco importante
      for (const marco of marcos) {
        if (percentual >= marco && percentual < marco + 5) {
          // Janela de 5% para evitar spam
          await this.sendMessage(
            user.phoneNumber,
            `🎯 **MARCO ATINGIDO!**\n\n` +
              `🎉 Você completou ${marco}% do cofrinho "${cofrinho.nome}"!\n\n` +
              `💪 Continue assim que logo chegará na meta!`
          );
          break;
        }
      }
    } catch (error) {
      console.error("❌ Erro ao verificar marcos:", error);
      // Não bloquear o fluxo
    }
  }

  // ✅ ATUALIZAR handleViewCofrinho com opções de ação
  async handleViewCofrinho(user, nomeCofrinho) {
    try {
      const Cofrinho = require("../models/Cofrinho");

      const cofrinho = await Cofrinho.findByName(user.id, nomeCofrinho);
      if (!cofrinho) {
        await this.sendMessage(
          user.phoneNumber,
          `❌ **Cofrinho não encontrado**\n\n` +
            `Não existe cofrinho chamado "${nomeCofrinho}".\n` +
            `Digite "meus cofrinhos" para ver os disponíveis.`
        );
        return;
      }

      const relatorio = cofrinho.gerarRelatorio();
      const progresso = cofrinho.calcularProgresso();

      let message = relatorio + `\n\n`;

      // ✅ AÇÕES CONTEXTUAIS baseadas no status
      message += `**Ações disponíveis:**\n`;

      if (!progresso.atingido) {
        // Sugestões baseadas no progresso
        const valorSugerido = Math.min(Math.ceil(progresso.faltam / 10), 500);
        message += `• "guardar ${valorSugerido} no cofrinho ${nomeCofrinho}" - Depósito sugerido\n`;
        message += `• "guardar 100 no cofrinho ${nomeCofrinho}" - Guardar R$ 100\n`;
      }

      if (progresso.valorAtual > 0) {
        message += `• "retirar 50 do cofrinho ${nomeCofrinho}" - Retirar dinheiro\n`;
      }

      message += `• "relatório cofrinho ${nomeCofrinho}" - Análise detalhada\n`;
      message += `• "histórico cofrinho ${nomeCofrinho}" - Ver movimentações\n`;
      message += `• "editar cofrinho ${nomeCofrinho} meta [valor]" - Alterar meta`;

      await this.sendMessage(user.phoneNumber, message);
    } catch (error) {
      console.error("❌ Erro ao visualizar cofrinho:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ MÉTODO auxiliar para formatar moeda (se não existir)
  formatarMoeda(valor) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(valor);
  }

  // ✅ ATUALIZAR handleListCofrinhos com informações mais ricas
  async handleListCofrinhos(user) {
    try {
      console.log(`🧪 DEBUG - Listando cofrinhos para user:`, user.id);

      const Cofrinho = require("../models/Cofrinho");
      const cofrinhos = await Cofrinho.findByUser(user.id);

      console.log(`🧪 DEBUG - Cofrinhos encontrados:`, {
        quantidade: cofrinhos.length,
        cofrinhos: cofrinhos.map((c) => ({
          id: c.id,
          nome: c.nome,
          userId: c.userId,
        })),
      });

      if (cofrinhos.length === 0) {
        console.log(
          `🧪 DEBUG - Nenhum cofrinho encontrado, enviando mensagem de vazio`
        );
        await this.sendMessage(
          user.phoneNumber,
          `💰 **Você ainda não tem cofrinhos!**\n\n` +
            `**Exemplos para criar:**\n` +
            `• "cofrinho emergência 10000" - Fundo de emergência\n` +
            `• "cofrinho viagem 5000" - Para próxima viagem\n` +
            `• "cofrinho casa 100000" - Para casa própria\n` +
            `• "cofrinho carro 30000" - Para trocar de carro\n\n` +
            `💡 **Dica:** Comece com metas pequenas e vá aumentando!`
        );
        return;
      }

      let message = `💰 **SEUS COFRINHOS** (${cofrinhos.length})\n\n`;

      let totalGuardado = 0;
      let totalMetas = 0;
      let metasAtingidas = 0;

      cofrinhos.forEach((cofrinho, index) => {
        const progresso = cofrinho.calcularProgresso();
        const prazo = cofrinho.verificarPrazo();

        totalGuardado += progresso.valorAtual;
        totalMetas += progresso.meta;

        if (progresso.atingido) metasAtingidas++;

        // Status emoji
        let statusEmoji = "📊";
        if (progresso.atingido) statusEmoji = "✅";
        else if (prazo?.vencido) statusEmoji = "🚨";
        else if (prazo?.proximoVencimento) statusEmoji = "⏰";
        else if (parseFloat(progresso.percentual) >= 75) statusEmoji = "🔥";

        message += `${statusEmoji} **${cofrinho.nome}**\n`;
        message += `   💵 ${this.formatarMoeda(
          progresso.valorAtual
        )} / ${this.formatarMoeda(progresso.meta)}\n`;
        message += `   📈 ${progresso.percentual}%`;

        if (prazo?.diasRestantes && !progresso.atingido) {
          if (prazo.vencido) {
            message += ` | 🚨 Vencido há ${Math.abs(prazo.diasRestantes)}d`;
          } else if (prazo.proximoVencimento) {
            message += ` | ⏰ ${prazo.diasRestantes}d restantes`;
          }
        }

        message += `\n\n`;
      });

      // ✅ RESUMO ESTATÍSTICO
      const progressoGeral =
        totalMetas > 0 ? ((totalGuardado / totalMetas) * 100).toFixed(1) : 0;

      message += `📊 **RESUMO GERAL:**\n`;
      message += `💰 Total guardado: ${this.formatarMoeda(totalGuardado)}\n`;
      message += `🎯 Total das metas: ${this.formatarMoeda(totalMetas)}\n`;
      message += `📈 Progresso geral: ${progressoGeral}%\n`;
      message += `✅ Metas atingidas: ${metasAtingidas}/${cofrinhos.length}\n\n`;

      message += `**Comandos rápidos:**\n`;
      message += `• "cofrinho [nome]" - Ver detalhes específicos\n`;
      message += `• "progresso cofrinhos" - Análise completa\n`;
      message += `• "cofrinhos vencendo" - Ver prazos urgentes`;

      await this.sendMessage(user.phoneNumber, message);
    } catch (error) {
      console.error("❌ Erro ao listar cofrinhos:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ==========================================
  // ✅ HANDLERS DE METAS
  // ==========================================

  async handleCreateGoal(user, data) {
    try {
      console.log(`🎯 Criando meta para ${user.phoneNumber}:`, data);

      const Goal = require("../models/Goal");

      // Verificar se já existe meta para esta categoria
      const existingGoal = await Goal.findByCategory(user.id, data.categoria);
      if (existingGoal) {
        await existingGoal.update({ monthlyLimit: data.limite });

        await this.sendMessage(
          user.phoneNumber,
          `✅ **Meta atualizada!**\n\n` +
            `📂 **Categoria:** ${data.categoria}\n` +
            `💰 **Novo limite:** ${this.formatarMoeda(data.limite)}\n\n` +
            `Receberá alertas quando atingir 80% do limite.`
        );
      } else {
        const goal = await Goal.create({
          userId: user.id,
          category: data.categoria,
          monthlyLimit: data.limite,
        });

        await this.sendMessage(
          user.phoneNumber,
          `🎯 **Meta criada com sucesso!**\n\n` +
            `📂 **Categoria:** ${data.categoria}\n` +
            `💰 **Limite mensal:** ${this.formatarMoeda(data.limite)}\n\n` +
            `Receberá alertas quando atingir 80% do limite.\n\n` +
            `💡 Para ver todas: "minhas metas"`
        );

        // ✅ ADICIONAR AQUI:
        await this.ofereceAutorizacaoCalendar(user, "meta");
      }
    } catch (error) {
      console.error("❌ Erro ao criar meta:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  async handleListGoals(user) {
    try {
      const Goal = require("../models/Goal");

      const goals = await Goal.findByUser(user.id);

      if (goals.length === 0) {
        await this.sendMessage(
          user.phoneNumber,
          `🎯 **Você ainda não tem metas!**\n\n` +
            `**Como criar:**\n` +
            `• "meta alimentação 600" - Limitar gastos com comida\n` +
            `• "meta transporte 300" - Limitar gastos com Uber\n` +
            `• "meta lazer 200" - Limitar gastos com diversão\n\n` +
            `💡 As metas ajudam a controlar seus gastos mensais!`
        );
        return;
      }

      let message = `🎯 **SUAS METAS**\n\n`;

      for (const goal of goals) {
        const display = await goal.toDisplayFormat();
        const statusEmoji = display.isOverLimit
          ? "🚨"
          : display.shouldAlert
          ? "⚠️"
          : "✅";

        message += `${statusEmoji} **${display.category}**\n`;
        message += `   💰 ${display.totalSpent} / ${display.monthlyLimit}\n`;
        message += `   📊 ${display.percentage}% usado\n`;
        if (!display.isOverLimit) {
          message += `   🎯 Restam: ${display.remaining}\n`;
        }
        message += `\n`;
      }

      message +=
        `**Comandos:**\n` +
        `• "meta alimentação 800" - Atualizar meta\n` +
        `• "gastos de alimentação" - Ver gastos da categoria`;

      await this.sendMessage(user.phoneNumber, message);
    } catch (error) {
      console.error("❌ Erro ao listar metas:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ 3. SE NÃO EXISTIR, adicione este método auxiliar também no final
  formatarMoeda(valor) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(valor);
  }

  async verificarMetasEAlertar(user, categoria, valorGasto) {
    try {
      const Goal = require("../models/Goal");
      const goal = await Goal.findByCategory(user.id, categoria);

      if (!goal) return;

      const moment = require("moment");
      const inicioMes = moment().startOf("month").toDate();
      const fimMes = moment().endOf("month").toDate();

      const Transaction = require("../models/Transaction");
      const gastosDoMes = await Transaction.getTotalByCategory(
        user.id,
        categoria,
        inicioMes,
        fimMes
      );

      const percentualGasto = (gastosDoMes / goal.monthlyLimit) * 100;

      // Alertar aos 80%
      if (percentualGasto >= 80 && percentualGasto < 100) {
        try {
          await this.calendar.criarLembreteMeta80(user.id, goal);
          console.log("✅ Alerta 80% meta criado no Calendar");
        } catch (calendarError) {
          console.error("⚠️ Erro ao criar alerta Calendar:", calendarError);
        }
      }

      // Alertar quando estourar
      if (percentualGasto >= 100) {
        try {
          await this.calendar.criarLembreteMetaEstourada(
            user.id,
            goal,
            gastosDoMes
          );
          console.log("✅ Alerta estouro criado no Calendar");
        } catch (calendarError) {
          console.error("⚠️ Erro ao criar alerta estouro:", calendarError);
        }
      }
    } catch (error) {
      console.error("❌ Erro ao verificar metas:", error);
    }
  }

  // ✅ ADICIONAR no final da classe:

  async handleCalendarAuth(user) {
    try {
      if (await user.isCalendarAuthorized()) {
        await this.sendMessage(
          user.phoneNumber,
          `✅ **Google Calendar já autorizado!**\n\n` +
            `Você já recebe lembretes no seu calendário pessoal.`
        );
        return;
      }

      const authUrl = this.calendar.getAuthUrl(user.id);

      await this.sendMessage(
        user.phoneNumber,
        `📅 **Conectar Google Calendar**\n\n` +
          `Para receber lembretes no seu calendário:\n\n` +
          `1. Clique no link abaixo\n` +
          `2. Faça login na sua conta Google\n` +
          `3. Autorize o acesso\n\n` +
          `🔗 ${authUrl}\n\n` +
          `💡 Após autorizar, você receberá lembretes de metas e cofrinhos!`
      );
    } catch (error) {
      console.error("❌ Erro ao gerar link de autorização:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  // ✅ ATUALIZAR o método verificarMetasEAlertar (adicionar verificação):
  async verificarMetasEAlertar(user, categoria, valorGasto) {
    try {
      // ✅ ADICIONAR estas linhas no início:
      if (!(await user.isCalendarAuthorized())) {
        console.log(`⚠️ Usuário ${user.id} não autorizou Calendar`);
        return;
      }

      const authSuccess = await this.calendar.setUserAuth(user.id);
      if (!authSuccess) {
        console.log(`⚠️ Falha ao configurar auth para usuário ${user.id}`);
        return;
      }

      // ... resto do código igual (Goal.findByCategory, etc.)
    } catch (error) {
      console.error("❌ Erro ao verificar metas:", error);
    }
  }

  // ✅ ADICIONAR no final da classe BotController:

  async ofereceAutorizacaoCalendar(user, tipo) {
    try {
      // Verificar se já autorizou
      if (await user.isCalendarAuthorized()) {
        return; // Já tem autorização, não oferece novamente
      }

      const authUrl = this.calendar.getAuthUrl(user.id);

      let mensagem = "";

      if (tipo === "meta") {
        mensagem =
          `📅 **Quer receber lembretes no Google Calendar?**\n\n` +
          `✨ **Você receberá:**\n` +
          `• 🔔 Alerta quando atingir 80% do limite\n` +
          `• 🚨 Aviso quando estourar o limite\n` +
          `• 📧 Emails e notificações no celular\n\n` +
          `**Para ativar:**\n` +
          `1. Clique no link abaixo\n` +
          `2. Faça login na sua conta Google\n` +
          `3. Autorize o acesso\n\n` +
          `🔗 ${authUrl}\n\n` +
          `💡 *Opcional - suas metas funcionam normalmente sem isso!*`;
      } else if (tipo === "cofrinho") {
        mensagem =
          `📅 **Quer receber lembretes no Google Calendar?**\n\n` +
          `✨ **Você receberá:**\n` +
          `• 🎯 Comemoração aos 80% da meta\n` +
          `• 🎉 Parabéns quando atingir 100%\n` +
          `• 📧 Emails e notificações no celular\n\n` +
          `**Para ativar:**\n` +
          `1. Clique no link abaixo\n` +
          `2. Faça login na sua conta Google\n` +
          `3. Autorize o acesso\n\n` +
          `🔗 ${authUrl}\n\n` +
          `💡 *Opcional - seu cofrinho funciona normalmente sem isso!*`;
      }

      await this.sendMessage(user.phoneNumber, mensagem);
    } catch (error) {
      console.error("❌ Erro ao oferecer autorização Calendar:", error);
      // Não bloquear o fluxo se Calendar falhar
    }
  }

  // ✅ MÉTODOS FLEXÍVEIS - COLAR NO FINAL DA CLASSE

  parseFlexibleFinancialCommand(messageText) {
    const text = messageText.toLowerCase().trim();
    console.log(`🧠 Analisando comando flexível: "${text}"`);

    // Extrair números e palavras
    const numbers = text.match(/\d+(?:[.,]\d{2})?/g) || [];
    const words = text
      .split(/\s+/)
      .filter((word) => !/^\d+[.,]?\d*$/.test(word));

    console.log(`🔍 Números encontrados:`, numbers);
    console.log(`🔍 Palavras encontradas:`, words);

    // DETECTAR METAS
    if (words.includes("meta") || words.includes("limite")) {
      if (numbers.length > 0) {
        const valor = parseFloat(numbers[0].replace(",", "."));

        let categoria = "outros";
        const categorias = [
          "alimentação",
          "alimentacao",
          "comida",
          "mercado",
          "transporte",
          "uber",
          "taxi",
          "saude",
          "saúde",
          "farmacia",
          "vestuario",
          "vestuário",
          "roupa",
          "lazer",
          "diversao",
          "diversão",
          "casa",
          "construcao",
          "construção",
          "educacao",
          "educação",
          "curso",
        ];

        for (const cat of categorias) {
          if (text.includes(cat)) {
            categoria = this.normalizarCategoria(cat);
            break;
          }
        }

        if (categoria === "outros") {
          const palavrasIgnorar = [
            "meta",
            "limite",
            "de",
            "do",
            "da",
            "para",
            "pro",
            "pra",
            "no",
            "na",
            "em",
          ];
          const palavraSignificativa = words.find(
            (word) =>
              !palavrasIgnorar.includes(word) &&
              word.length > 2 &&
              !numbers.includes(word)
          );

          if (palavraSignificativa) {
            categoria =
              this.safeCategorizeName(palavraSignificativa) ||
              palavraSignificativa;
          }
        }

        console.log(`🎯 META detectada: ${categoria} = R$ ${valor}`);
        return {
          found: true,
          type: "meta",
          data: { categoria, limite: valor },
        };
      }
    }

    // GUARDAR NO COFRINHO
    if (
      (words.includes("guardar") ||
        words.includes("adicionar") ||
        words.includes("depositar")) &&
      words.includes("cofrinho") &&
      numbers.length > 0
    ) {
      const valor = parseFloat(numbers[0].replace(",", "."));
      const nomeCofrinho = this.extrairNomeCofrinho(text);

      console.log(
        `💵 GUARDAR detectado: R$ ${valor} no cofrinho ${nomeCofrinho}`
      );
      return {
        found: true,
        type: "guardar_cofrinho",
        data: { valor, nomeCofrinho },
      };
    }

    // RETIRAR DO COFRINHO
    if (
      (words.includes("retirar") || words.includes("sacar")) &&
      words.includes("cofrinho") &&
      numbers.length > 0
    ) {
      const valor = parseFloat(numbers[0].replace(",", "."));
      const nomeCofrinho = this.extrairNomeCofrinho(text);

      console.log(
        `💸 RETIRAR detectado: R$ ${valor} do cofrinho ${nomeCofrinho}`
      );
      return {
        found: true,
        type: "retirar_cofrinho",
        data: { valor, nomeCofrinho },
      };
    }

    // DETECTAR COFRINHOS
    if (words.includes("cofrinho")) {
      if (numbers.length > 0) {
        const valor = parseFloat(numbers[0].replace(",", "."));

        let nome = "poupanca";
        const nomes = [
          "viagem",
          "casa",
          "carro",
          "moto",
          "emergencia",
          "emergência",
          "ferias",
          "férias",
          "casamento",
          "curso",
          "faculdade",
        ];

        for (const nomeComum of nomes) {
          if (text.includes(nomeComum)) {
            nome = nomeComum;
            break;
          }
        }

        if (nome === "poupanca") {
          const palavrasIgnorar = [
            "cofrinho",
            "de",
            "do",
            "da",
            "para",
            "pro",
            "pra",
            "no",
            "na",
            "em",
          ];
          const palavraSignificativa = words.find(
            (word) =>
              !palavrasIgnorar.includes(word) &&
              word.length > 2 &&
              !numbers.includes(word)
          );

          if (palavraSignificativa) {
            nome = palavraSignificativa;
          }
        }

        console.log(`💰 COFRINHO detectado: ${nome} = R$ ${valor}`);
        return {
          found: true,
          type: "cofrinho",
          data: { nome, meta: valor, descricao: "" },
        };
      }
    }

    console.log(`❌ Nenhum comando financeiro flexível detectado`);
    return { found: false };
  }

  extrairNomeCofrinho(text) {
    const words = text.toLowerCase().split(/\s+/);
    const palavrasIgnorar = [
      "guardar",
      "retirar",
      "sacar",
      "adicionar",
      "depositar",
      "no",
      "do",
      "da",
      "cofrinho",
      "de",
      "para",
      "pro",
      "pra",
    ];

    const nomeWords = words.filter(
      (word) =>
        !palavrasIgnorar.includes(word) &&
        !/^\d+[.,]?\d*$/.test(word) &&
        word.length > 1
    );

    return nomeWords.join(" ") || "principal";
  }

  normalizarCategoria(categoria) {
    const mapa = {
      alimentacao: "alimentação",
      comida: "alimentação",
      mercado: "alimentação",
      uber: "transporte",
      taxi: "transporte",
      saude: "saúde",
      farmacia: "saúde",
      vestuario: "vestuário",
      roupa: "vestuário",
      diversao: "lazer",
      construcao: "casa",
      educacao: "educação",
      curso: "educação",
    };

    return mapa[categoria] || categoria;
  }

  async handleCreateGoalAndOffer(user, data) {
    try {
      console.log(`🎯 Criando meta inteligente:`, data);

      const Goal = require("../models/Goal");
      const existingGoal = await Goal.findByCategory(user.id, data.categoria);

      let isNewGoal = !existingGoal;

      if (existingGoal) {
        await existingGoal.update({ monthlyLimit: data.limite });
        await this.sendMessage(
          user.phoneNumber,
          `✅ **Meta atualizada!**\n\n` +
            `📂 **Categoria:** ${data.categoria}\n` +
            `💰 **Novo limite:** ${this.formatarMoeda(data.limite)}\n\n` +
            `Receberá alertas quando atingir 80% do limite.`
        );
      } else {
        const goal = await Goal.create({
          userId: user.id,
          category: data.categoria,
          monthlyLimit: data.limite,
        });

        await this.sendMessage(
          user.phoneNumber,
          `🎯 **Meta criada com sucesso!**\n\n` +
            `📂 **Categoria:** ${data.categoria}\n` +
            `💰 **Limite mensal:** ${this.formatarMoeda(data.limite)}\n\n` +
            `Receberá alertas quando atingir 80% do limite.\n\n` +
            `💡 Para ver todas: "minhas metas"`
        );
      }

      if (isNewGoal) {
        await this.ofereceAutorizacaoCalendar(user, "meta");
      }
    } catch (error) {
      console.error("❌ Erro ao criar meta inteligente:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }

  async handleCreateCofrinhoAndOffer(user, data) {
    try {
      console.log(`💰 Criando cofrinho inteligente:`, data);

      const Cofrinho = require("../models/Cofrinho");
      const nomeJaExiste = await Cofrinho.nomeJaExiste(user.id, data.nome);

      if (nomeJaExiste) {
        await this.sendMessage(
          user.phoneNumber,
          `⚠️ **Cofrinho já existe!**\n\n` +
            `Você já tem um cofrinho chamado "${data.nome}".\n\n` +
            `**Opções:**\n` +
            `• "guardar 100 ${data.nome}" - Adicionar dinheiro\n` +
            `• "cofrinho ${data.nome}" - Ver status atual`
        );
        return;
      }

      const cofrinho = await Cofrinho.create({
        userId: user.id,
        nome: data.nome,
        meta: data.meta,
        descricao: data.descricao,
      });

      const metaFormatted = this.formatarMoeda(data.meta);

      let message =
        `🎯 **Cofrinho criado com sucesso!**\n\n` +
        `💰 **Nome:** ${data.nome}\n` +
        `🎯 **Meta:** ${metaFormatted}\n\n` +
        `**Como usar:**\n` +
        `• "guardar 100 ${data.nome}" - Guardar dinheiro\n` +
        `• "retirar 50 ${data.nome}" - Retirar dinheiro\n` +
        `• "cofrinho ${data.nome}" - Ver progresso\n\n` +
        `💡 **Dica:** Comece guardando um valor pequeno para criar o hábito!`;

      await this.sendMessage(user.phoneNumber, message);
      await this.ofereceAutorizacaoCalendar(user, "cofrinho");
    } catch (error) {
      console.error("❌ Erro ao criar cofrinho inteligente:", error);
      await this.sendErrorMessage(user.phoneNumber);
    }
  }
}

module.exports = BotController;
