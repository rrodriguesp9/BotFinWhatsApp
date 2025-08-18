const { db } = require("../config/database");
const { v4: uuidv4 } = require("uuid");
const moment = require("moment");

class Transaction {
  constructor(data) {
    this.id = data.id || uuidv4();
    this.userId = data.userId;
    this.type = data.type; // 'income' | 'expense'
    this.amount = data.amount;
    this.category = data.category || "outros";
    this.description = data.description || "";
    this.date = data.date || new Date();
    this.recurrenceId = data.recurrenceId || null;
    this.source = data.source || "text"; // 'text' | 'image' | 'audio'
    this.createdAt = data.createdAt || new Date();
    this.isConfirmed = data.isConfirmed !== false;
    this.tags = data.tags || [];
  }

  // Criar nova transação
  static async create(transactionData) {
    try {
      console.log("💾 Iniciando Transaction.create:", transactionData);

      const transaction = new Transaction(transactionData);
      console.log("✅ Transaction object criado:", {
        id: transaction.id,
        userId: transaction.userId,
        type: transaction.type,
        amount: transaction.amount,
      });

      console.log("💾 Salvando no Firestore...");
      await db.collection("transactions").doc(transaction.id).set({
        userId: transaction.userId,
        type: transaction.type,
        amount: transaction.amount,
        category: transaction.category,
        description: transaction.description,
        date: transaction.date,
        recurrenceId: transaction.recurrenceId,
        source: transaction.source,
        createdAt: transaction.createdAt,
        isConfirmed: transaction.isConfirmed,
        tags: transaction.tags,
      });
      console.log("✅ Transação salva no Firestore");

      // Atualizar saldo do usuário
      console.log("💰 Atualizando saldo do usuário...");
      try {
        const newBalance = await this.updateUserBalance(
          transaction.userId,
          transaction.type,
          transaction.amount
        );
        console.log("✅ Saldo atualizado para:", newBalance);
      } catch (balanceError) {
        console.error("❌ ERRO ao atualizar saldo:", balanceError);
        // Não falhar a transação por causa do saldo
        console.log("⚠️ Continuando sem atualizar saldo...");
      }

      console.log("✅ Transaction.create concluído com sucesso");
      return transaction;
    } catch (error) {
      console.error("❌ ERRO COMPLETO em Transaction.create:", error);
      console.error("Stack trace:", error.stack);
      throw new Error(`Erro ao criar transação: ${error.message}`);
    }
  }
  /// ✅ TAMBÉM SUBSTITUIR esta função (updateUserBalance)
  static async updateUserBalance(userId, type, amount) {
    try {
      console.log(
        `💰 updateUserBalance: userId=${userId}, type=${type}, amount=${amount}`
      );

      const balanceRef = db.collection("balances").doc(userId);
      console.log("🔍 Buscando saldo atual...");

      const balanceDoc = await balanceRef.get();

      let currentBalance = 0;
      if (balanceDoc.exists) {
        currentBalance = balanceDoc.data().currentBalance || 0;
        console.log("✅ Saldo atual encontrado:", currentBalance);
      } else {
        console.log("⚠️ Saldo não existe, criando com 0");
      }

      // Calcular novo saldo
      const newBalance =
        type === "income" ? currentBalance + amount : currentBalance - amount;

      console.log(
        `💰 Calculando: ${currentBalance} ${
          type === "income" ? "+" : "-"
        } ${amount} = ${newBalance}`
      );

      console.log("💾 Salvando novo saldo...");
      await balanceRef.set(
        {
          currentBalance: newBalance,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      console.log("✅ Saldo atualizado com sucesso:", newBalance);
      return newBalance;
    } catch (error) {
      console.error("❌ ERRO DETALHADO em updateUserBalance:", error);
      console.error("Stack trace:", error.stack);
      throw new Error(`Erro ao atualizar saldo: ${error.message}`);
    }
  }

  // ✅ E TAMBÉM SUBSTITUIR validate (melhorada)
  static validate(transactionData) {
    console.log("🔍 Validando transação:", transactionData);

    const errors = [];

    if (!transactionData.userId) {
      errors.push("ID do usuário é obrigatório");
    }

    if (
      !transactionData.type ||
      !["income", "expense"].includes(transactionData.type)
    ) {
      errors.push('Tipo deve ser "income" ou "expense"');
    }

    if (!transactionData.amount || transactionData.amount <= 0) {
      errors.push("Valor deve ser maior que zero");
    }

    if (transactionData.amount > 1000000) {
      errors.push("Valor muito alto (máximo R$ 1.000.000)");
    }

    if (!transactionData.category) {
      errors.push("Categoria é obrigatória");
    }

    console.log("✅ Validação concluída, erros:", errors);
    return errors;
  }

  // Buscar transações do usuário
  static async findByUser(userId, filters = {}) {
    try {
      let query = db.collection("transactions").where("userId", "==", userId);

      // Aplicar filtros
      if (filters.type) {
        query = query.where("type", "==", filters.type);
      }
      if (filters.category) {
        query = query.where("category", "==", filters.category);
      }
      if (filters.startDate) {
        query = query.where("date", ">=", filters.startDate);
      }
      if (filters.endDate) {
        query = query.where("date", "<=", filters.endDate);
      }

      // Ordenar por data (mais recente primeiro)
      query = query.orderBy("date", "desc");

      const snapshot = await query.get();

      return snapshot.docs.map(
        (doc) => new Transaction({ id: doc.id, ...doc.data() })
      );
    } catch (error) {
      throw new Error(`Erro ao buscar transações: ${error.message}`);
    }
  }

  // Obter saldo atual do usuário
  static async getCurrentBalance(userId) {
    try {
      const balanceDoc = await db.collection("balances").doc(userId).get();

      if (!balanceDoc.exists) {
        return 0;
      }

      return balanceDoc.data().currentBalance || 0;
    } catch (error) {
      throw new Error(`Erro ao obter saldo: ${error.message}`);
    }
  }

  // Calcular estatísticas por categoria
  static async getCategoryStats(userId, period = "month") {
    try {
      const startDate = this.getPeriodStartDate(period);
      const transactions = await this.findByUser(userId, { startDate });

      const stats = {};

      transactions.forEach((transaction) => {
        if (!stats[transaction.category]) {
          stats[transaction.category] = {
            total: 0,
            count: 0,
            type: transaction.type,
          };
        }

        stats[transaction.category].total += transaction.amount;
        stats[transaction.category].count += 1;
      });

      return stats;
    } catch (error) {
      throw new Error(`Erro ao calcular estatísticas: ${error.message}`);
    }
  }

  // Obter data de início do período
  static getPeriodStartDate(period) {
    const now = moment();

    switch (period) {
      case "week":
        return now.startOf("week").toDate();
      case "month":
        return now.startOf("month").toDate();
      case "quarter":
        return now.startOf("quarter").toDate();
      case "year":
        return now.startOf("year").toDate();
      default:
        return now.startOf("month").toDate();
    }
  }

  // Confirmar transação
  async confirm() {
    try {
      this.isConfirmed = true;
      await db.collection("transactions").doc(this.id).update({
        isConfirmed: true,
        updatedAt: new Date(),
      });
      return true;
    } catch (error) {
      throw new Error(`Erro ao confirmar transação: ${error.message}`);
    }
  }

  // Excluir transação
  async delete() {
    try {
      // Reverter saldo
      const reverseAmount = this.type === "income" ? -this.amount : this.amount;
      await Transaction.updateUserBalance(this.userId, "income", reverseAmount);

      // Excluir transação
      await db.collection("transactions").doc(this.id).delete();
      return true;
    } catch (error) {
      throw new Error(`Erro ao excluir transação: ${error.message}`);
    }
  }

  // Formatar para exibição
  toDisplayFormat() {
    const formattedAmount = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(this.amount);

    const formattedDate = moment(this.date).format("DD/MM/YYYY");

    return {
      id: this.id,
      type: this.type,
      amount: formattedAmount,
      category: this.category,
      description: this.description,
      date: formattedDate,
      source: this.source,
      isConfirmed: this.isConfirmed,
      tags: this.tags,
    };
  }
}

module.exports = Transaction;
