// ✅ ARQUIVO MELHORADO: src/models/Cofrinho.js

const { db } = require("../config/database");
const { v4: uuidv4 } = require("uuid");
const moment = require("moment");

class Cofrinho {
  constructor(data) {
    this.id = data.id || uuidv4();
    this.userId = data.userId;
    this.nome = data.nome;
    this.meta = data.meta;
    this.valorAtual = data.valorAtual || 0;
    this.prazo = data.prazo || null;
    this.categoria = data.categoria || "economia";
    this.descricao = data.descricao || "";
    this.ativo = data.ativo !== false;
    this.criadoEm = data.criadoEm || new Date();
    this.atualizadoEm = data.atualizadoEm || new Date();
  }

  // ✅ CRIAR novo cofrinho com normalização de nome
  static async create(data) {
    try {
      // ✅ NORMALIZAR nome
      const nomeNormalizado = this.normalizeNome(data.nome);

      const cofrinho = new Cofrinho({
        ...data,
        nome: nomeNormalizado,
      });

      await db.collection("cofrinhos").doc(cofrinho.id).set({
        userId: cofrinho.userId,
        nome: cofrinho.nome,
        meta: cofrinho.meta,
        valorAtual: 0, // ✅ SEMPRE iniciar com zero
        prazo: cofrinho.prazo,
        categoria: cofrinho.categoria,
        descricao: cofrinho.descricao,
        ativo: true,
        criadoEm: cofrinho.criadoEm,
        atualizadoEm: cofrinho.atualizadoEm,
      });

      console.log(`✅ Cofrinho criado: ${cofrinho.id}`);
      return cofrinho;
    } catch (error) {
      console.error("❌ Erro ao criar cofrinho:", error);
      throw new Error(`Erro ao criar cofrinho: ${error.message}`);
    }
  }

  // ✅ BUSCAR cofrinhos do usuário com paginação
  static async findByUser(userId, options = {}) {
    try {
      const { activeOnly = true, limit = 50, offset = 0 } = options;

      let query = db.collection("cofrinhos").where("userId", "==", userId);

      if (activeOnly) {
        query = query.where("ativo", "==", true);
      }

      query = query.orderBy("criadoEm", "desc");

      if (limit) {
        query = query.limit(limit);
      }

      const snapshot = await query.get();

      return snapshot.docs.map(
        (doc) => new Cofrinho({ id: doc.id, ...doc.data() })
      );
    } catch (error) {
      console.error("❌ Erro ao buscar cofrinhos:", error);
      return [];
    }
  }

  // ✅ BUSCAR cofrinho por nome com normalização
  static async findByName(userId, nome) {
    try {
      const nomeNormalizado = this.normalizeNome(nome);

      const snapshot = await db
        .collection("cofrinhos")
        .where("userId", "==", userId)
        .where("nome", "==", nomeNormalizado)
        .where("ativo", "==", true)
        .limit(1)
        .get();

      if (snapshot.empty) return null;

      const doc = snapshot.docs[0];
      return new Cofrinho({ id: doc.id, ...doc.data() });
    } catch (error) {
      console.error("❌ Erro ao buscar cofrinho:", error);
      return null;
    }
  }

  // ✅ BUSCAR cofrinho por ID
  static async findById(cofrinhoId) {
    try {
      const doc = await db.collection("cofrinhos").doc(cofrinhoId).get();

      if (!doc.exists) return null;

      return new Cofrinho({ id: doc.id, ...doc.data() });
    } catch (error) {
      console.error("❌ Erro ao buscar cofrinho por ID:", error);
      return null;
    }
  }

  // ✅ ADICIONAR dinheiro ao cofrinho com transação atômica
  async adicionarValor(valor, descricao = "") {
    try {
      // ✅ USAR TRANSAÇÃO ATÔMICA para evitar problemas de concorrência
      await db.runTransaction(async (transaction) => {
        const cofrinhoRef = db.collection("cofrinhos").doc(this.id);
        const doc = await transaction.get(cofrinhoRef);

        if (!doc.exists) {
          throw new Error("Cofrinho não encontrado");
        }

        const dadosAtuais = doc.data();
        const novoValor = dadosAtuais.valorAtual + valor;

        transaction.update(cofrinhoRef, {
          valorAtual: novoValor,
          atualizadoEm: new Date(),
        });

        // Atualizar valor local
        this.valorAtual = novoValor;
        this.atualizadoEm = new Date();
      });

      // Registrar movimento após transação bem-sucedida
      await this.registrarMovimento("deposito", valor, descricao);

      console.log(`💰 Valor adicionado ao cofrinho ${this.nome}: +R$ ${valor}`);
      return true;
    } catch (error) {
      console.error("❌ Erro ao adicionar valor:", error);
      return false;
    }
  }

  // ✅ RETIRAR dinheiro do cofrinho com transação atômica
  async retirarValor(valor, descricao = "") {
    try {
      // ✅ USAR TRANSAÇÃO ATÔMICA
      await db.runTransaction(async (transaction) => {
        const cofrinhoRef = db.collection("cofrinhos").doc(this.id);
        const doc = await transaction.get(cofrinhoRef);

        if (!doc.exists) {
          throw new Error("Cofrinho não encontrado");
        }

        const dadosAtuais = doc.data();

        if (valor > dadosAtuais.valorAtual) {
          throw new Error("Valor insuficiente no cofrinho");
        }

        const novoValor = dadosAtuais.valorAtual - valor;

        transaction.update(cofrinhoRef, {
          valorAtual: novoValor,
          atualizadoEm: new Date(),
        });

        // Atualizar valor local
        this.valorAtual = novoValor;
        this.atualizadoEm = new Date();
      });

      // Registrar movimento após transação bem-sucedida
      await this.registrarMovimento("retirada", valor, descricao);

      console.log(`💸 Valor retirado do cofrinho ${this.nome}: -R$ ${valor}`);
      return true;
    } catch (error) {
      console.error("❌ Erro ao retirar valor:", error);
      throw new Error(`Erro ao retirar valor: ${error.message}`);
    }
  }

  // ✅ REGISTRAR movimento do cofrinho
  async registrarMovimento(tipo, valor, descricao) {
    try {
      await db.collection("movimentos_cofrinho").add({
        cofrinhoId: this.id,
        userId: this.userId,
        tipo: tipo, // 'deposito' ou 'retirada'
        valor: valor,
        descricao: descricao,
        valorAnterior:
          tipo === "deposito"
            ? this.valorAtual - valor
            : this.valorAtual + valor,
        valorAtual: this.valorAtual,
        data: new Date(),
      });
    } catch (error) {
      console.error("❌ Erro ao registrar movimento:", error);
    }
  }

  // ✅ CALCULAR progresso
  calcularProgresso() {
    const percentual = Math.min((this.valorAtual / this.meta) * 100, 100);
    const faltam = Math.max(this.meta - this.valorAtual, 0);
    const atingido = this.valorAtual >= this.meta;

    return {
      percentual: percentual.toFixed(1),
      valorAtual: this.valorAtual,
      meta: this.meta,
      faltam: faltam,
      atingido: atingido,
    };
  }

  // ✅ VERIFICAR se prazo está próximo
  verificarPrazo() {
    if (!this.prazo) return null;

    const agora = new Date();
    const prazoDate = new Date(this.prazo);
    const diasRestantes = Math.ceil(
      (prazoDate - agora) / (1000 * 60 * 60 * 24)
    );

    return {
      diasRestantes: diasRestantes,
      vencido: diasRestantes < 0,
      proximoVencimento: diasRestantes <= 7 && diasRestantes > 0,
    };
  }

  // ✅ GERAR relatório do cofrinho
  gerarRelatorio() {
    const progresso = this.calcularProgresso();
    const prazo = this.verificarPrazo();

    let relatorio = `💰 **COFRINHO: ${this.nome.toUpperCase()}**\n\n`;

    // Progresso
    relatorio += `📊 **Progresso:**\n`;
    relatorio += `💵 Valor atual: ${this.formatarMoeda(
      progresso.valorAtual
    )}\n`;
    relatorio += `🎯 Meta: ${this.formatarMoeda(progresso.meta)}\n`;
    relatorio += `📈 Progresso: ${progresso.percentual}%\n`;

    if (!progresso.atingido) {
      relatorio += `🎯 Faltam: ${this.formatarMoeda(progresso.faltam)}\n`;
    } else {
      relatorio += `✅ Meta atingida! 🎉\n`;
    }

    // Prazo
    if (prazo) {
      relatorio += `\n📅 **Prazo:**\n`;
      if (prazo.vencido) {
        relatorio += `⚠️ Prazo vencido há ${Math.abs(
          prazo.diasRestantes
        )} dias\n`;
      } else if (prazo.proximoVencimento) {
        relatorio += `⏰ Restam ${prazo.diasRestantes} dias!\n`;
      } else {
        relatorio += `📆 Restam ${prazo.diasRestantes} dias\n`;
      }
    }

    // Descrição
    if (this.descricao) {
      relatorio += `\n📝 **Objetivo:** ${this.descricao}\n`;
    }

    return relatorio;
  }

  // ✅ FORMATAR moeda
  formatarMoeda(valor) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(valor);
  }

  // ✅ VALIDAR dados com melhorias
  static validate(data) {
    const errors = [];

    if (!data.userId) {
      errors.push("ID do usuário é obrigatório");
    }

    if (!data.nome || data.nome.trim().length < 2) {
      errors.push("Nome deve ter pelo menos 2 caracteres");
    }

    // ✅ VALIDAR caracteres especiais no nome
    if (data.nome && !/^[a-záàâãçéêíóôõú\s]+$/i.test(data.nome.trim())) {
      errors.push("Nome deve conter apenas letras e espaços");
    }

    // ✅ VALIDAR tipo de meta
    if (!data.meta || typeof data.meta !== "number" || isNaN(data.meta)) {
      errors.push("Meta deve ser um número válido");
    }

    if (data.meta && data.meta <= 0) {
      errors.push("Meta deve ser maior que zero");
    }

    if (data.meta && data.meta > 1000000) {
      errors.push("Meta muito alta (máximo R$ 1.000.000)");
    }

    if (data.prazo && new Date(data.prazo) <= new Date()) {
      errors.push("Prazo deve ser no futuro");
    }

    return errors;
  }

  // ✅ DESATIVAR cofrinho (soft delete)
  async desativar() {
    try {
      this.ativo = false;
      this.atualizadoEm = new Date();

      await db.collection("cofrinhos").doc(this.id).update({
        ativo: false,
        atualizadoEm: this.atualizadoEm,
      });

      console.log(`🗑️ Cofrinho ${this.nome} desativado`);
      return true;
    } catch (error) {
      console.error("❌ Erro ao desativar cofrinho:", error);
      return false;
    }
  }

  // ✅ DELETAR cofrinho permanentemente (só se vazio)
  async deletarPermanentemente() {
    try {
      if (this.valorAtual > 0) {
        throw new Error("Não é possível deletar cofrinho com saldo");
      }

      // Deletar movimentos relacionados
      const movimentosSnapshot = await db
        .collection("movimentos_cofrinho")
        .where("cofrinhoId", "==", this.id)
        .get();

      const batch = db.batch();

      movimentosSnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      // Deletar o cofrinho
      batch.delete(db.collection("cofrinhos").doc(this.id));

      await batch.commit();

      console.log(`🗑️ Cofrinho ${this.nome} deletado permanentemente`);
      return true;
    } catch (error) {
      console.error("❌ Erro ao deletar cofrinho:", error);
      throw new Error(`Erro ao deletar cofrinho: ${error.message}`);
    }
  }

  // ✅ ATUALIZAR cofrinho com validações
  async update(updateData) {
    try {
      const allowedFields = ["nome", "meta", "prazo", "descricao", "ativo"];
      const updates = {};

      allowedFields.forEach((field) => {
        if (updateData[field] !== undefined) {
          // ✅ NORMALIZAR nome se estiver sendo atualizado
          if (field === "nome" && updateData[field]) {
            updates[field] = this.constructor.normalizeNome(updateData[field]);
          } else {
            updates[field] = updateData[field];
          }
        }
      });

      updates.atualizadoEm = new Date();

      await db.collection("cofrinhos").doc(this.id).update(updates);

      // Atualizar propriedades locais
      Object.assign(this, updates);

      console.log(`✅ Cofrinho ${this.nome} atualizado`);
      return true;
    } catch (error) {
      console.error("❌ Erro ao atualizar cofrinho:", error);
      return false;
    }
  }

  // ✅ BUSCAR histórico de movimentos com paginação
  async buscarHistorico(limite = 10, offset = 0) {
    try {
      let query = db
        .collection("movimentos_cofrinho")
        .where("cofrinhoId", "==", this.id)
        .orderBy("data", "desc");

      if (limite) {
        query = query.limit(limite);
      }

      const snapshot = await query.get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        data: doc.data().data.toDate(),
      }));
    } catch (error) {
      console.error("❌ Erro ao buscar histórico:", error);
      return [];
    }
  }

  // ✅ PARA formato de exibição
  async toDisplayFormat() {
    const progresso = this.calcularProgresso();
    const prazo = this.verificarPrazo();

    return {
      id: this.id,
      nome: this.nome,
      meta: this.formatarMoeda(this.meta),
      valorAtual: this.formatarMoeda(progresso.valorAtual),
      faltam: this.formatarMoeda(progresso.faltam),
      percentual: progresso.percentual,
      atingido: progresso.atingido,
      prazo: prazo,
      descricao: this.descricao,
      ativo: this.ativo,
    };
  }

  // ✅ NOVO: Normalizar nome do cofrinho
  static normalizeNome(nome) {
    if (!nome || typeof nome !== "string") {
      return "";
    }

    return nome
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ") // Remove espaços duplos
      .replace(/[^\w\sáàâãçéêíóôõú]/gi, ""); // Remove caracteres especiais exceto acentos
  }

  // ✅ NOVO: Verificar se nome já existe para o usuário
  static async nomeJaExiste(userId, nome) {
    try {
      const nomeNormalizado = this.normalizeNome(nome);
      const cofrinho = await this.findByName(userId, nomeNormalizado);
      return cofrinho !== null;
    } catch (error) {
      console.error("❌ Erro ao verificar nome:", error);
      return false;
    }
  }

  // ✅ NOVO: Obter estatísticas do cofrinho
  async obterEstatisticas() {
    try {
      const movimentos = await this.buscarHistorico(100); // Últimos 100 movimentos

      const stats = {
        totalDepositos: 0,
        totalRetiradas: 0,
        numeroDepositos: 0,
        numeroRetiradas: 0,
        mediaDeposito: 0,
        mediaRetirada: 0,
        ultimoMovimento: null,
        periodicidadeMedia: 0,
      };

      let somaDepositos = 0;
      let somaRetiradas = 0;

      movimentos.forEach((mov, index) => {
        if (mov.tipo === "deposito") {
          stats.numeroDepositos++;
          somaDepositos += mov.valor;
        } else {
          stats.numeroRetiradas++;
          somaRetiradas += mov.valor;
        }

        if (index === 0) {
          stats.ultimoMovimento = mov;
        }
      });

      stats.totalDepositos = somaDepositos;
      stats.totalRetiradas = somaRetiradas;
      stats.mediaDeposito =
        stats.numeroDepositos > 0 ? somaDepositos / stats.numeroDepositos : 0;
      stats.mediaRetirada =
        stats.numeroRetiradas > 0 ? somaRetiradas / stats.numeroRetiradas : 0;

      return stats;
    } catch (error) {
      console.error("❌ Erro ao obter estatísticas:", error);
      return null;
    }
  }

  // ✅ NOVO: Gerar relatório de progresso detalhado
  async gerarRelatorioDetalhado() {
    try {
      const progresso = this.calcularProgresso();
      const prazo = this.verificarPrazo();
      const stats = await this.obterEstatisticas();

      let relatorio = `📊 **RELATÓRIO DETALHADO - ${this.nome.toUpperCase()}**\n\n`;

      // Progresso básico
      relatorio += `💰 **Status Atual:**\n`;
      relatorio += `💵 Valor guardado: ${this.formatarMoeda(
        progresso.valorAtual
      )}\n`;
      relatorio += `🎯 Meta: ${this.formatarMoeda(progresso.meta)}\n`;
      relatorio += `📈 Progresso: ${progresso.percentual}%\n`;

      if (!progresso.atingido) {
        relatorio += `🎯 Faltam: ${this.formatarMoeda(progresso.faltam)}\n\n`;
      } else {
        relatorio += `✅ Meta atingida! 🎉\n\n`;
      }

      // Estatísticas de movimentação
      if (stats) {
        relatorio += `📋 **Histórico de Movimentação:**\n`;
        relatorio += `📥 Total depositado: ${this.formatarMoeda(
          stats.totalDepositos
        )} (${stats.numeroDepositos}x)\n`;

        if (stats.numeroRetiradas > 0) {
          relatorio += `📤 Total retirado: ${this.formatarMoeda(
            stats.totalRetiradas
          )} (${stats.numeroRetiradas}x)\n`;
        }

        if (stats.numeroDepositos > 0) {
          relatorio += `📊 Depósito médio: ${this.formatarMoeda(
            stats.mediaDeposito
          )}\n`;
        }

        if (stats.ultimoMovimento) {
          const dataUltimo = moment(stats.ultimoMovimento.data).format(
            "DD/MM/YYYY HH:mm"
          );
          relatorio += `⏰ Último movimento: ${dataUltimo}\n\n`;
        }
      }

      // Prazo
      if (prazo) {
        relatorio += `📅 **Prazo:**\n`;
        if (prazo.vencido) {
          relatorio += `⚠️ Prazo vencido há ${Math.abs(
            prazo.diasRestantes
          )} dias\n\n`;
        } else if (prazo.proximoVencimento) {
          relatorio += `⏰ Atenção! Restam apenas ${prazo.diasRestantes} dias!\n\n`;
        } else {
          relatorio += `📆 Restam ${prazo.diasRestantes} dias para atingir a meta\n\n`;
        }
      }

      // Objetivo
      if (this.descricao) {
        relatorio += `📝 **Objetivo:** ${this.descricao}\n\n`;
      }

      // Sugestões baseadas no progresso
      relatorio += this.gerarSugestoes(progresso, prazo, stats);

      return relatorio;
    } catch (error) {
      console.error("❌ Erro ao gerar relatório detalhado:", error);
      return this.gerarRelatorio(); // Fallback para relatório simples
    }
  }

  // ✅ NOVO: Gerar sugestões baseadas no progresso
  gerarSugestoes(progresso, prazo, stats) {
    let sugestoes = `💡 **Sugestões:**\n`;

    if (progresso.atingido) {
      sugestoes += `🎉 Parabéns! Você atingiu sua meta!\n`;
      sugestoes += `💭 Considere criar um novo cofrinho ou aumentar esta meta.\n`;
    } else {
      // Sugestões baseadas no prazo
      if (prazo && prazo.diasRestantes > 0) {
        const valorPorDia = progresso.faltam / prazo.diasRestantes;
        sugestoes += `📈 Para atingir a meta, você precisa guardar ${this.formatarMoeda(
          valorPorDia
        )} por dia.\n`;

        if (stats && stats.mediaDeposito > 0) {
          const depositosNecessarios = Math.ceil(
            progresso.faltam / stats.mediaDeposito
          );
          sugestoes += `💰 Com sua média de ${this.formatarMoeda(
            stats.mediaDeposito
          )} por depósito, você precisa de mais ${depositosNecessarios} depósitos.\n`;
        }
      } else {
        // Sem prazo definido
        if (stats && stats.mediaDeposito > 0) {
          const depositosNecessarios = Math.ceil(
            progresso.faltam / stats.mediaDeposito
          );
          sugestoes += `💰 Mantendo sua média atual, você precisa de mais ${depositosNecessarios} depósitos para atingir a meta.\n`;
        }
      }

      // Sugestão de frequência
      if (progresso.percentual < 25) {
        sugestoes += `🚀 Dica: Tente guardar uma quantia fixa toda semana para criar o hábito!\n`;
      } else if (progresso.percentual < 75) {
        sugestoes += `⚡ Você está no caminho certo! Continue com a disciplina.\n`;
      } else {
        sugestoes += `🏁 Falta pouco! Mantenha o foco para atingir sua meta!\n`;
      }
    }

    return sugestoes;
  }

  // ✅ NOVO: Método para buscar cofrinhos próximos do prazo
  static async buscarProximosDoVencimento(userId, dias = 7) {
    try {
      const cofrinhos = await this.findByUser(userId);
      const proximosDoVencimento = [];

      cofrinhos.forEach((cofrinho) => {
        const prazo = cofrinho.verificarPrazo();
        if (prazo && (prazo.proximoVencimento || prazo.vencido)) {
          proximosDoVencimento.push({
            cofrinho,
            prazo,
          });
        }
      });

      return proximosDoVencimento;
    } catch (error) {
      console.error(
        "❌ Erro ao buscar cofrinhos próximos do vencimento:",
        error
      );
      return [];
    }
  }

  // ✅ NOVO: Método para obter resumo de todos os cofrinhos do usuário
  static async obterResumoUsuario(userId) {
    try {
      const cofrinhos = await this.findByUser(userId);

      const resumo = {
        totalCofrinhos: cofrinhos.length,
        cofrinhosMeta: 0,
        totalGuardado: 0,
        totalMetas: 0,
        progressoMedio: 0,
        maisPróximoMeta: null,
        maisDistanteMeta: null,
      };

      if (cofrinhos.length === 0) {
        return resumo;
      }

      let somaProgressos = 0;
      let menorProgresso = 100;
      let maiorProgresso = 0;

      cofrinhos.forEach((cofrinho) => {
        const progresso = cofrinho.calcularProgresso();

        resumo.totalGuardado += progresso.valorAtual;
        resumo.totalMetas += progresso.meta;
        somaProgressos += parseFloat(progresso.percentual);

        if (progresso.atingido) {
          resumo.cofrinhosMeta++;
        }

        // Encontrar mais próximo e mais distante da meta
        const progressoNum = parseFloat(progresso.percentual);
        if (progressoNum > maiorProgresso) {
          maiorProgresso = progressoNum;
          resumo.maisPróximoMeta = cofrinho;
        }
        if (progressoNum < menorProgresso) {
          menorProgresso = progressoNum;
          resumo.maisDistanteMeta = cofrinho;
        }
      });

      resumo.progressoMedio = (somaProgressos / cofrinhos.length).toFixed(1);

      return resumo;
    } catch (error) {
      console.error("❌ Erro ao obter resumo do usuário:", error);
      return null;
    }
  }
}

module.exports = Cofrinho;
