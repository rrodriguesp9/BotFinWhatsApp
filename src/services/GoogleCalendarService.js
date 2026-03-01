// =====================================================
// 1. CRIAR: services/GoogleCalendarService.js
// =====================================================
const { google } = require("googleapis");
require("dotenv").config();

class GoogleCalendarService {
  constructor() {
    this.auth = null;
    this.calendar = null;
    this.initializeAuth();
  }

  // Inicializar autenticação
  initializeAuth() {
    try {
      // ✅ Usar OAuth2 para múltiplos usuários
      this.oAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      console.log("✅ Google Calendar OAuth inicializado");
    } catch (error) {
      console.error("❌ Erro ao inicializar Google Calendar:", error);
    }
  }

  getAuthUrl(userId) {
    const scopes = ["https://www.googleapis.com/auth/calendar"];

    return this.oAuth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      state: userId,
      prompt: "consent",
    });
  }

  async processAuthCode(code, userId) {
    try {
      console.log(
        `🧪 DEBUG - processAuthCode chamado: code=${code}, userId=${userId}`
      );
      const { tokens } = await this.oAuth2Client.getToken(code);
      console.log(`🧪 DEBUG - Tokens recebidos:`, tokens);

      const User = require("../models/User");
      await User.updateGoogleTokens(userId, tokens);
      console.log(`🧪 DEBUG - Tokens salvos no Firebase para user ${userId}`);

      console.log(`✅ Usuário ${userId} autorizou Google Calendar`);
      return true;
    } catch (error) {
      console.error("❌ Erro ao processar autorização:", error);
      return false;
    }
  }

  async setUserAuth(userId) {
    try {
      const User = require("../models/User");
      const user = await User.findById(userId);

      if (!user.googleTokens) {
        throw new Error("Usuário não autorizou Google Calendar");
      }

      this.oAuth2Client.setCredentials(user.googleTokens);
      this.calendar = google.calendar({
        version: "v3",
        auth: this.oAuth2Client,
      });

      return true;
    } catch (error) {
      console.error(
        `❌ Erro ao configurar auth para usuário ${userId}:`,
        error
      );
      return false;
    }
  }

  // =====================================================
  // 2. CRIAR LEMBRETES PARA METAS
  // =====================================================
  async criarLembreteMeta80(userId, goal) {
    try {
      console.log(`📅 Criando lembrete 80% meta: ${goal.category}`);

      const agora = new Date();
      const proximoMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 1);

      const evento = {
        summary: `⚠️ Meta ${goal.category} - 80% atingida!`,
        description: `
          ⚠️ Atenção! Você já gastou 80% da sua meta mensal!
          
          📊 Detalhes:
          • Categoria: ${goal.category}
          • Limite mensal: R$ ${goal.monthlyLimit.toFixed(2)}
          • Já gasto: R$ ${(goal.monthlyLimit * 0.8).toFixed(2)}
          • Restam: R$ ${(goal.monthlyLimit * 0.2).toFixed(2)}
          
          💡 Considere reduzir os gastos nesta categoria este mês.
        `,
        start: {
          dateTime: agora.toISOString(),
          timeZone: "America/Sao_Paulo",
        },
        end: {
          dateTime: new Date(agora.getTime() + 30 * 60 * 1000).toISOString(),
          timeZone: "America/Sao_Paulo",
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 0 },
            { method: "email", minutes: 0 },
          ],
        },
        colorId: "11", // Vermelho para avisos
      };

      const response = await this.calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
        resource: evento,
      });

      console.log(`✅ Lembrete meta criado: ${response.data.id}`);
      return response.data;
    } catch (error) {
      console.error("❌ Erro ao criar lembrete de meta:", error);
      throw error;
    }
  }

  async criarLembreteMetaEstourada(userId, goal, totalGasto) {
    try {
      console.log(`🚨 Criando lembrete meta estourada: ${goal.category}`);

      const agora = new Date();

      const evento = {
        summary: `🚨 Meta ${goal.category} - ESTOURADA!`,
        description: `
          🚨 ATENÇÃO! Você estourou sua meta mensal!
          
          📊 Detalhes:
          • Categoria: ${goal.category}
          • Limite mensal: R$ ${goal.monthlyLimit.toFixed(2)}
          • Total gasto: R$ ${totalGasto.toFixed(2)}
          • Excesso: R$ ${(totalGasto - goal.monthlyLimit).toFixed(2)}
          
          🛑 Recomendamos parar os gastos nesta categoria até o próximo mês.
        `,
        start: {
          dateTime: agora.toISOString(),
          timeZone: "America/Sao_Paulo",
        },
        end: {
          dateTime: new Date(agora.getTime() + 30 * 60 * 1000).toISOString(),
          timeZone: "America/Sao_Paulo",
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 0 },
            { method: "email", minutes: 0 },
          ],
        },
        colorId: "11", // Vermelho para alertas críticos
      };

      const response = await this.calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
        resource: evento,
      });

      console.log(`✅ Lembrete estouro criado: ${response.data.id}`);
      return response.data;
    } catch (error) {
      console.error("❌ Erro ao criar lembrete de estouro:", error);
      throw error;
    }
  }

  // =====================================================
  // 3. CRIAR LEMBRETES PARA COFRINHOS
  // =====================================================
  async criarLembreteCofrinho80(userId, cofrinho) {
    try {
      console.log(`💰 Criando lembrete 80% cofrinho: ${cofrinho.nome}`);

      const agora = new Date();
      const progresso = cofrinho.calcularProgresso();

      const evento = {
        summary: `🎯 Cofrinho "${cofrinho.nome}" - 80% atingido!`,
        description: `
          🎉 Parabéns! Você atingiu 80% do seu cofrinho!
          
          📊 Detalhes:
          • Cofrinho: ${cofrinho.nome}
          • Meta: R$ ${cofrinho.meta.toFixed(2)}
          • Valor atual: R$ ${progresso.valorAtual.toFixed(2)}
          • Restam apenas: R$ ${progresso.faltam.toFixed(2)}
          
          💪 Continue assim, você está quase lá!
        `,
        start: {
          dateTime: agora.toISOString(),
          timeZone: "America/Sao_Paulo",
        },
        end: {
          dateTime: new Date(agora.getTime() + 60 * 60 * 1000).toISOString(),
          timeZone: "America/Sao_Paulo",
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 0 },
            { method: "email", minutes: 30 },
          ],
        },
        colorId: "10", // Verde para metas
      };

      const response = await this.calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
        resource: evento,
      });

      console.log(`✅ Lembrete cofrinho criado: ${response.data.id}`);
      return response.data;
    } catch (error) {
      console.error("❌ Erro ao criar lembrete de cofrinho:", error);
      throw error;
    }
  }

  async criarLembreteCofrinhoMeta(userId, cofrinho) {
    try {
      console.log(`🎯 Criando lembrete meta atingida: ${cofrinho.nome}`);

      const agora = new Date();

      const evento = {
        summary: `🎉 PARABÉNS! Meta do cofrinho "${cofrinho.nome}" atingida!`,
        description: `
          🎉 EXCELENTE! Você atingiu sua meta!
          
          📊 Detalhes:
          • Cofrinho: ${cofrinho.nome}
          • Meta: R$ ${cofrinho.meta.toFixed(2)}
          • Valor final: R$ ${cofrinho.valorAtual.toFixed(2)}
          
          ✨ Agora você pode:
          • Usar o dinheiro guardado
          • Criar uma nova meta maior
          • Criar outro cofrinho
          
          🎖️ Parabéns pela disciplina e foco!
        `,
        start: {
          dateTime: agora.toISOString(),
          timeZone: "America/Sao_Paulo",
        },
        end: {
          dateTime: new Date(
            agora.getTime() + 2 * 60 * 60 * 1000
          ).toISOString(),
          timeZone: "America/Sao_Paulo",
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 0 },
            { method: "email", minutes: 0 },
          ],
        },
        colorId: "10", // Verde para conquistas
      };

      const response = await this.calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
        resource: evento,
      });

      console.log(`✅ Lembrete meta atingida criado: ${response.data.id}`);
      return response.data;
    } catch (error) {
      console.error("❌ Erro ao criar lembrete de meta atingida:", error);
      throw error;
    }
  }

  // =====================================================
  // 4. LEMBRETES PARA VENCIMENTOS
  // =====================================================
  async criarLembretePrazoCofrinho(userId, cofrinho, dataPrazo) {
    try {
      console.log(`⏰ Criando lembrete prazo: ${cofrinho.nome}`);

      const progresso = cofrinho.calcularProgresso();

      const evento = {
        summary: `📅 Prazo do Cofrinho: ${cofrinho.nome}`,
        description: `
          ⏰ Hoje é o prazo do seu cofrinho!
          
          📊 Detalhes:
          • Cofrinho: ${cofrinho.nome}
          • Meta: R$ ${cofrinho.meta.toFixed(2)}
          • Valor atual: R$ ${progresso.valorAtual.toFixed(2)}
          • Progresso: ${progresso.percentual}%
          
          ${
            progresso.atingido
              ? "🎉 PARABÉNS! Você atingiu sua meta!"
              : "💪 Continue focado nos seus objetivos!"
          }
        `,
        start: {
          dateTime: dataPrazo.toISOString(),
          timeZone: "America/Sao_Paulo",
        },
        end: {
          dateTime: new Date(
            dataPrazo.getTime() + 2 * 60 * 60 * 1000
          ).toISOString(),
          timeZone: "America/Sao_Paulo",
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 0 },
            { method: "email", minutes: 60 },
            { method: "popup", minutes: 1440 }, // 1 dia antes
          ],
        },
        colorId: "9", // Azul para prazos
      };

      const response = await this.calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
        resource: evento,
      });

      console.log(`✅ Lembrete prazo criado: ${response.data.id}`);
      return response.data;
    } catch (error) {
      console.error("❌ Erro ao criar lembrete de prazo:", error);
      throw error;
    }
  }

  // =====================================================
  // 5. LEMBRETES MENSAIS AUTOMÁTICOS
  // =====================================================
  async criarLembreteResumoMensal(userId) {
    try {
      console.log(`📊 Criando lembrete resumo mensal para user: ${userId}`);

      const agora = new Date();
      const proximoMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 1);

      const evento = {
        summary: `📊 Resumo Financeiro Mensal`,
        description: `
          📊 Hora de revisar suas finanças!
          
          📋 Tarefas sugeridas:
          • Verificar saldo atual
          • Analisar gastos do mês
          • Revisar metas de gastos
          • Verificar progresso dos cofrinhos
          • Planejar gastos do próximo mês
          
          💡 Digite "resumo do mês" no bot para ver relatório completo!
        `,
        start: {
          dateTime: proximoMes.toISOString(),
          timeZone: "America/Sao_Paulo",
        },
        end: {
          dateTime: new Date(
            proximoMes.getTime() + 60 * 60 * 1000
          ).toISOString(),
          timeZone: "America/Sao_Paulo",
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 0 },
            { method: "email", minutes: 60 },
          ],
        },
        colorId: "9", // Azul para lembretes mensais
      };

      const response = await this.calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
        resource: evento,
      });

      console.log(`✅ Lembrete mensal criado: ${response.data.id}`);
      return response.data;
    } catch (error) {
      console.error("❌ Erro ao criar lembrete mensal:", error);
      throw error;
    }
  }

  // =====================================================
  // 6. FUNÇÕES AUXILIARES
  // =====================================================

  // Deletar evento
  async deletarEvento(eventId) {
    try {
      await this.calendar.events.delete({
        calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
        eventId: eventId,
      });
      console.log(`✅ Evento deletado: ${eventId}`);
    } catch (error) {
      console.error("❌ Erro ao deletar evento:", error);
      throw error;
    }
  }

  // Listar eventos
  async listarEventos(dataInicio, dataFim) {
    try {
      const response = await this.calendar.events.list({
        calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
        timeMin: dataInicio.toISOString(),
        timeMax: dataFim.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      });

      return response.data.items;
    } catch (error) {
      console.error("❌ Erro ao listar eventos:", error);
      throw error;
    }
  }

  // Verificar se serviço está funcionando
  async testarConexao() {
    try {
      const agora = new Date();
      const amanha = new Date(agora.getTime() + 24 * 60 * 60 * 1000);

      const eventos = await this.listarEventos(agora, amanha);
      console.log(
        `✅ Google Calendar conectado - ${eventos.length} eventos encontrados`
      );
      return true;
    } catch (error) {
      console.error("❌ Erro ao testar conexão:", error);
      return false;
    }
  }
}

module.exports = GoogleCalendarService;
