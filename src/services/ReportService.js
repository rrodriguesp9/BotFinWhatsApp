const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const Transaction = require("../models/Transaction");
const Goal = require("../models/Goal");
const moment = require("moment");

class ReportService {
  constructor() {
    this.moment = moment;
  }

  // Gerar relatório no formato especificado
  async generateReport(userId, format = "pdf", period = "month") {
    try {
      const transactions = await Transaction.findByUser(userId, {
        startDate: Transaction.getPeriodStartDate(period),
      });

      const stats = await Transaction.getCategoryStats(userId, period);
      const goals = await Goal.findByUser(userId);
      const balance = await Transaction.getCurrentBalance(userId);

      switch (format.toLowerCase()) {
        case "pdf":
          return await this.generatePDFReport(
            userId,
            transactions,
            stats,
            goals,
            balance,
            period
          );
        case "csv":
          return await this.generateCSVReport(transactions, stats, period);
        case "excel":
          return await this.generateExcelReport(
            transactions,
            stats,
            goals,
            balance,
            period
          );
        default:
          throw new Error(`Formato não suportado: ${format}`);
      }
    } catch (error) {
      console.error("❌ Erro ao gerar relatório:", error);
      throw error;
    }
  }

  // Gerar relatório PDF
  async generatePDFReport(userId, transactions, stats, goals, balance, period) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "A4",
          margin: 50,
        });

        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));

        // Cabeçalho
        doc
          .fontSize(24)
          .font("Helvetica-Bold")
          .text("📊 RELATÓRIO FINANCEIRO", { align: "center" });

        doc.moveDown();
        doc
          .fontSize(12)
          .font("Helvetica")
          .text(`Período: ${this.getPeriodText(period)}`, { align: "center" })
          .text(`Gerado em: ${moment().format("DD/MM/YYYY HH:mm")}`, {
            align: "center",
          });

        doc.moveDown(2);

        // Saldo atual
        doc.fontSize(16).font("Helvetica-Bold").text("💳 SALDO ATUAL");

        doc
          .fontSize(12)
          .font("Helvetica")
          .text(`R$ ${balance.toFixed(2)}`);

        doc.moveDown(2);

        // Resumo por categoria
        doc.fontSize(16).font("Helvetica-Bold").text("📂 GASTOS POR CATEGORIA");

        Object.entries(stats).forEach(([category, data]) => {
          if (data.total > 0) {
            doc
              .fontSize(10)
              .font("Helvetica")
              .text(
                `${category}: R$ ${data.total.toFixed(2)} (${
                  data.count
                } transações)`
              );
          }
        });

        doc.moveDown(2);

        // Metas
        if (goals.length > 0) {
          doc.fontSize(16).font("Helvetica-Bold").text("🎯 METAS");

          goals.forEach(async (goal) => {
            const progress = await goal.calculateProgress();
            doc
              .fontSize(10)
              .font("Helvetica")
              .text(
                `${goal.category}: ${
                  progress.percentage
                }% (R$ ${progress.totalSpent.toFixed(
                  2
                )} / R$ ${goal.monthlyLimit.toFixed(2)})`
              );
          });

          doc.moveDown(2);
        }

        // Transações recentes
        doc.fontSize(16).font("Helvetica-Bold").text("📝 ÚLTIMAS TRANSAÇÕES");

        transactions.slice(0, 20).forEach((transaction) => {
          const formattedAmount = new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL",
          }).format(transaction.amount);

          const formattedDate = moment(transaction.date).format("DD/MM/YYYY");

          doc
            .fontSize(8)
            .font("Helvetica")
            .text(
              `${formattedDate} - ${
                transaction.type === "income" ? "💵" : "💸"
              } ${formattedAmount} - ${transaction.category} - ${
                transaction.description
              }`
            );
        });

        // Rodapé
        doc.moveDown(2);
        doc
          .fontSize(10)
          .font("Helvetica-Oblique")
          .text("Relatório gerado pelo Bot Financeiro WhatsApp", {
            align: "center",
          });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Gerar relatório CSV
  async generateCSVReport(transactions, stats, period) {
    let csv = "Data,Tipo,Valor,Categoria,Descrição\n";

    // Adicionar transações
    transactions.forEach((transaction) => {
      const date = moment(transaction.date).format("DD/MM/YYYY");
      const amount = transaction.amount.toFixed(2);
      const type = transaction.type === "income" ? "Receita" : "Despesa";

      csv += `${date},${type},${amount},${transaction.category},"${transaction.description}"\n`;
    });

    // Adicionar resumo por categoria
    csv += "\n\nResumo por Categoria\n";
    csv += "Categoria,Total,Quantidade\n";

    Object.entries(stats).forEach(([category, data]) => {
      if (data.total > 0) {
        csv += `${category},${data.total.toFixed(2)},${data.count}\n`;
      }
    });

    return Buffer.from(csv, "utf-8");
  }

  // Gerar relatório Excel
  async generateExcelReport(transactions, stats, goals, balance, period) {
    const workbook = new ExcelJS.Workbook();

    // Planilha de transações
    const transactionsSheet = workbook.addWorksheet("Transações");

    // Cabeçalhos
    transactionsSheet.columns = [
      { header: "Data", key: "date", width: 12 },
      { header: "Tipo", key: "type", width: 10 },
      { header: "Valor", key: "amount", width: 15 },
      { header: "Categoria", key: "category", width: 15 },
      { header: "Descrição", key: "description", width: 30 },
    ];

    // Adicionar dados
    transactions.forEach((transaction) => {
      transactionsSheet.addRow({
        date: moment(transaction.date).format("DD/MM/YYYY"),
        type: transaction.type === "income" ? "Receita" : "Despesa",
        amount: transaction.amount,
        category: transaction.category,
        description: transaction.description,
      });
    });

    // Formatar valores monetários
    transactionsSheet.getColumn("amount").numFmt = "R$ #,##0.00";

    // Planilha de resumo
    const summarySheet = workbook.addWorksheet("Resumo");

    // Saldo atual
    summarySheet.addRow(["Saldo Atual", balance]);
    summarySheet.addRow([]);

    // Estatísticas por categoria
    summarySheet.addRow(["Categoria", "Total", "Quantidade"]);

    Object.entries(stats).forEach(([category, data]) => {
      if (data.total > 0) {
        summarySheet.addRow([category, data.total, data.count]);
      }
    });

    // Formatar valores monetários
    summarySheet.getColumn(2).numFmt = "R$ #,##0.00";

    // Planilha de metas
    if (goals.length > 0) {
      const goalsSheet = workbook.addWorksheet("Metas");

      goalsSheet.columns = [
        { header: "Categoria", key: "category", width: 15 },
        { header: "Limite Mensal", key: "limit", width: 15 },
        { header: "Gasto Atual", key: "spent", width: 15 },
        { header: "Restante", key: "remaining", width: 15 },
        { header: "Progresso (%)", key: "progress", width: 15 },
      ];

      for (const goal of goals) {
        const progress = await goal.calculateProgress();
        goalsSheet.addRow({
          category: goal.category,
          limit: goal.monthlyLimit,
          spent: progress.totalSpent,
          remaining: progress.remaining,
          progress: progress.percentage,
        });
      }

      // Formatar valores monetários
      goalsSheet.getColumn("limit").numFmt = "R$ #,##0.00";
      goalsSheet.getColumn("spent").numFmt = "R$ #,##0.00";
      goalsSheet.getColumn("remaining").numFmt = "R$ #,##0.00";
      goalsSheet.getColumn("progress").numFmt = "0%";
    }

    return await workbook.xlsx.writeBuffer();
  }

  // Gerar gráfico de pizza (simulado)
  async generatePieChart(data) {
    // Implementação básica - em produção, usar biblioteca de gráficos
    const chartData = Object.entries(data).map(([category, value]) => ({
      category,
      value: value.total,
      percentage:
        (value.total /
          Object.values(data).reduce((sum, item) => sum + item.total, 0)) *
        100,
    }));

    return chartData;
  }

  // Gerar gráfico de barras (simulado)
  async generateBarChart(data) {
    // Implementação básica - em produção, usar biblioteca de gráficos
    const chartData = Object.entries(data).map(([category, value]) => ({
      category,
      value: value.total,
      count: value.count,
    }));

    return chartData;
  }

  // Obter texto do período
  getPeriodText(period) {
    const periodTexts = {
      week: "Esta semana",
      month: "Este mês",
      quarter: "Este trimestre",
      year: "Este ano",
    };

    return periodTexts[period] || "Este mês";
  }

  // Gerar relatório de alertas
  async generateAlertsReport(userId) {
    try {
      const goals = await Goal.findByUser(userId);
      const alerts = [];

      for (const goal of goals) {
        const progress = await goal.calculateProgress();
        if (progress.shouldAlert) {
          alerts.push({
            category: goal.category,
            limit: goal.monthlyLimit,
            spent: progress.totalSpent,
            percentage: progress.percentage,
            isOverLimit: progress.isOverLimit,
          });
        }
      }

      return alerts;
    } catch (error) {
      console.error("❌ Erro ao gerar relatório de alertas:", error);
      throw error;
    }
  }

  // Gerar relatório de tendências
  async generateTrendsReport(userId, months = 6) {
    try {
      const trends = [];

      for (let i = 0; i < months; i++) {
        const startDate = moment()
          .subtract(i, "months")
          .startOf("month")
          .toDate();
        const endDate = moment().subtract(i, "months").endOf("month").toDate();

        const transactions = await Transaction.findByUser(userId, {
          startDate,
          endDate,
        });

        const totalIncome = transactions
          .filter((t) => t.type === "income")
          .reduce((sum, t) => sum + t.amount, 0);

        const totalExpense = transactions
          .filter((t) => t.type === "expense")
          .reduce((sum, t) => sum + t.amount, 0);

        trends.push({
          month: moment(startDate).format("MMM/YYYY"),
          income: totalIncome,
          expense: totalExpense,
          balance: totalIncome - totalExpense,
        });
      }

      return trends.reverse();
    } catch (error) {
      console.error("❌ Erro ao gerar relatório de tendências:", error);
      throw error;
    }
  }

  // ✅ ADICIONAR estes métodos no seu ReportService.js existente

  // ✅ RELATÓRIO DE SALDO EM TEXTO (para WhatsApp)
  async generateBalanceTextReport(userId) {
    try {
      console.log("📊 Gerando relatório de saldo texto para:", userId);

      const currentBalance = await Transaction.getCurrentBalance(userId);

      // Buscar últimas transações (últimos 7 dias)
      const weekStart = moment().subtract(7, "days").startOf("day").toDate();
      const recentTransactions = await Transaction.findByUser(userId, {
        startDate: weekStart,
      });

      // Calcular totais da semana
      const weekExpenses = recentTransactions
        .filter((t) => t.type === "expense")
        .reduce((sum, t) => sum + t.amount, 0);

      const weekIncome = recentTransactions
        .filter((t) => t.type === "income")
        .reduce((sum, t) => sum + t.amount, 0);

      const balanceFormatted = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(currentBalance);

      const expensesFormatted = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(weekExpenses);

      const incomeFormatted = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(weekIncome);

      let statusEmoji = "💚";
      let statusMessage = "Situação boa";

      if (currentBalance < 0) {
        statusEmoji = "🔴";
        statusMessage = "Saldo negativo";
      } else if (currentBalance < 100) {
        statusEmoji = "🟡";
        statusMessage = "Saldo baixo";
      }

      const report =
        `💰 **SEU SALDO ATUAL**\n\n` +
        `${statusEmoji} **Disponível:** ${balanceFormatted}\n` +
        `📊 **Status:** ${statusMessage}\n\n` +
        `📅 **Últimos 7 dias:**\n` +
        `💸 Gastos: ${expensesFormatted}\n` +
        `💵 Receitas: ${incomeFormatted}\n` +
        `📈 Resultado: ${new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(weekIncome - weekExpenses)}\n\n` +
        `💡 Digite *"gastos da semana"* para ver detalhes`;

      return {
        success: true,
        report,
        data: {
          currentBalance,
          weekExpenses,
          weekIncome,
          recentTransactions: recentTransactions.length,
        },
      };
    } catch (error) {
      console.error("❌ Erro ao gerar relatório de saldo texto:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ✅ RELATÓRIO POR PERÍODO EM TEXTO
  async generatePeriodTextReport(userId, period) {
    try {
      console.log(`📊 Gerando relatório texto de ${period} para:`, userId);

      const { startDate, endDate, periodName } =
        this.getPeriodDatesForText(period);

      const transactions = await Transaction.findByUser(userId, {
        startDate,
        endDate,
      });

      if (transactions.length === 0) {
        return {
          success: true,
          report:
            `📊 **RELATÓRIO - ${periodName.toUpperCase()}**\n\n` +
            `📭 Nenhuma transação encontrada neste período.\n\n` +
            `💡 Comece registrando: *"gastei 50 no mercado"*`,
        };
      }

      // Separar por tipo
      const expenses = transactions.filter((t) => t.type === "expense");
      const income = transactions.filter((t) => t.type === "income");

      // Calcular totais
      const totalExpenses = expenses.reduce((sum, t) => sum + t.amount, 0);
      const totalIncome = income.reduce((sum, t) => sum + t.amount, 0);
      const balance = totalIncome - totalExpenses;

      // Agrupar por categoria
      const categoriesData = this.groupByCategoryForText(expenses);

      // Gerar relatório
      let report = `📊 **RELATÓRIO - ${periodName.toUpperCase()}**\n\n`;

      // Resumo geral
      if (totalIncome > 0) {
        report += `💵 **Receitas:** ${this.formatCurrencyBR(totalIncome)}\n`;
      }

      if (totalExpenses > 0) {
        report += `💸 **Despesas:** ${this.formatCurrencyBR(totalExpenses)}\n`;
      }

      report += `📊 **Resultado:** ${this.formatCurrencyBR(balance)} `;
      report += balance >= 0 ? "✅\n\n" : "⚠️\n\n";

      // Top categorias
      if (categoriesData.length > 0) {
        report += `📂 **Gastos por Categoria:**\n`;

        categoriesData.slice(0, 5).forEach((cat, index) => {
          const emoji = this.getCategoryEmojiForText(cat.category);
          const percentage = ((cat.total / totalExpenses) * 100).toFixed(0);
          report += `${emoji} ${cat.category}: ${this.formatCurrencyBR(
            cat.total
          )} (${percentage}%)\n`;
        });

        if (categoriesData.length > 5) {
          report += `📋 +${categoriesData.length - 5} outras categorias\n`;
        }
      }

      // Últimas transações
      report += `\n💳 **Últimas Transações:**\n`;
      const lastTransactions = transactions.slice(0, 3);

      lastTransactions.forEach((t) => {
        const emoji = t.type === "expense" ? "💸" : "💵";
        const date = moment(t.date).format("DD/MM");
        report += `${emoji} ${this.formatCurrencyBR(t.amount)} - ${
          t.establishment || t.category
        } (${date})\n`;
      });

      if (transactions.length > 3) {
        report += `📋 +${transactions.length - 3} outras transações\n`;
      }

      report += `\n💡 Digite *"gastos de [categoria]"* para detalhes`;

      return {
        success: true,
        report,
        data: {
          totalExpenses,
          totalIncome,
          balance,
          transactionCount: transactions.length,
          categories: categoriesData,
        },
      };
    } catch (error) {
      console.error("❌ Erro ao gerar relatório texto de período:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ✅ RELATÓRIO POR CATEGORIA EM TEXTO
  async generateCategoryTextReport(userId, category) {
    try {
      console.log(
        `📊 Gerando relatório texto de categoria ${category} para:`,
        userId
      );

      // Últimos 30 dias
      const startDate = moment().subtract(30, "days").startOf("day").toDate();

      const transactions = await Transaction.findByUser(userId, {
        category: category.toLowerCase(),
        startDate,
      });

      if (transactions.length === 0) {
        return {
          success: true,
          report:
            `📊 **GASTOS EM ${category.toUpperCase()}**\n\n` +
            `📭 Nenhum gasto encontrado nesta categoria nos últimos 30 dias.\n\n` +
            `💡 Registre um gasto: *"gastei 50 em ${category}"*`,
        };
      }

      const total = transactions.reduce((sum, t) => sum + t.amount, 0);
      const average = total / transactions.length;

      // Agrupar por estabelecimento
      const establishments = {};
      transactions.forEach((t) => {
        const name = t.establishment || "Outros";
        if (!establishments[name]) {
          establishments[name] = { total: 0, count: 0 };
        }
        establishments[name].total += t.amount;
        establishments[name].count += 1;
      });

      const topEstablishments = Object.entries(establishments)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      const emoji = this.getCategoryEmojiForText(category);

      let report = `📊 **GASTOS EM ${category.toUpperCase()}**\n\n`;
      report += `${emoji} **Total (30 dias):** ${this.formatCurrencyBR(
        total
      )}\n`;
      report += `📊 **Média por gasto:** ${this.formatCurrencyBR(average)}\n`;
      report += `📈 **Quantidade:** ${transactions.length} transações\n\n`;

      // Top estabelecimentos
      report += `🏪 **Principais Locais:**\n`;
      topEstablishments.forEach((est, index) => {
        const percentage = ((est.total / total) * 100).toFixed(0);
        report += `${index + 1}. ${est.name}: ${this.formatCurrencyBR(
          est.total
        )} (${percentage}%)\n`;
      });

      // Últimas transações
      report += `\n💳 **Últimas Transações:**\n`;
      transactions.slice(0, 5).forEach((t) => {
        const date = moment(t.date).format("DD/MM");
        report += `• ${this.formatCurrencyBR(t.amount)} - ${
          t.establishment || "Outros"
        } (${date})\n`;
      });

      return {
        success: true,
        report,
        data: {
          total,
          average,
          transactionCount: transactions.length,
          topEstablishments,
        },
      };
    } catch (error) {
      console.error("❌ Erro ao gerar relatório texto de categoria:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ✅ UTILITÁRIOS PARA RELATÓRIOS DE TEXTO
  getPeriodDatesForText(period) {
    const now = moment();

    switch (period.toLowerCase()) {
      case "hoje":
      case "today":
        return {
          startDate: now.startOf("day").toDate(),
          endDate: now.endOf("day").toDate(),
          periodName: "Hoje",
        };

      case "ontem":
      case "yesterday":
        const yesterday = moment().subtract(1, "day");
        return {
          startDate: yesterday.startOf("day").toDate(),
          endDate: yesterday.endOf("day").toDate(),
          periodName: "Ontem",
        };

      case "semana":
      case "week":
        return {
          startDate: now.startOf("week").toDate(),
          endDate: now.endOf("week").toDate(),
          periodName: "Esta Semana",
        };

      case "mes":
      case "mês":
      case "month":
        return {
          startDate: now.startOf("month").toDate(),
          endDate: now.endOf("month").toDate(),
          periodName: "Este Mês",
        };

      default:
        return {
          startDate: now.startOf("month").toDate(),
          endDate: now.endOf("month").toDate(),
          periodName: "Este Mês",
        };
    }
  }

  groupByCategoryForText(transactions) {
    const categories = {};

    transactions.forEach((t) => {
      if (!categories[t.category]) {
        categories[t.category] = { total: 0, count: 0 };
      }
      categories[t.category].total += t.amount;
      categories[t.category].count += 1;
    });

    return Object.entries(categories)
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => b.total - a.total);
  }

  formatCurrencyBR(amount) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(amount);
  }

  getCategoryEmojiForText(category) {
    const emojis = {
      alimentação: "🍔",
      transporte: "🚗",
      saúde: "🏥",
      contas: "💡",
      vestuário: "👕",
      lazer: "🎭",
      casa: "🏠",
      educação: "📚",
      outros: "📦",
    };

    return emojis[category.toLowerCase()] || "📦";
  }

  // ✅ ADICIONE APENAS ESTE MÉTODO NO SEU REPORTSERVICE.JS
  // Coloque após o método generateCategoryTextReport

  // ✅ RELATÓRIO COMPARATIVO EM TEXTO
  async generateComparisonTextReport(userId) {
    try {
      console.log(`📊 Gerando relatório comparativo para:`, userId);

      // Mês atual
      const currentMonth = moment();
      const currentStart = currentMonth.clone().startOf("month").toDate();
      const currentEnd = currentMonth.clone().endOf("month").toDate();

      // Mês anterior
      const previousMonth = moment().subtract(1, "month");
      const previousStart = previousMonth.clone().startOf("month").toDate();
      const previousEnd = previousMonth.clone().endOf("month").toDate();

      // Buscar transações
      const currentTransactions = await Transaction.findByUser(userId, {
        startDate: currentStart,
        endDate: currentEnd,
      });

      const previousTransactions = await Transaction.findByUser(userId, {
        startDate: previousStart,
        endDate: previousEnd,
      });

      // Calcular totais atuais
      const currentExpenses = currentTransactions
        .filter((t) => t.type === "expense")
        .reduce((sum, t) => sum + t.amount, 0);

      const currentIncome = currentTransactions
        .filter((t) => t.type === "income")
        .reduce((sum, t) => sum + t.amount, 0);

      // Calcular totais anteriores
      const previousExpenses = previousTransactions
        .filter((t) => t.type === "expense")
        .reduce((sum, t) => sum + t.amount, 0);

      const previousIncome = previousTransactions
        .filter((t) => t.type === "income")
        .reduce((sum, t) => sum + t.amount, 0);

      // Se não há dados suficientes
      if (
        previousTransactions.length === 0 &&
        currentTransactions.length === 0
      ) {
        return {
          success: true,
          report:
            `📊 **RELATÓRIO COMPARATIVO**\n\n` +
            `📭 Não há dados suficientes para comparação.\n\n` +
            `💡 Comece registrando suas transações!`,
        };
      }

      // Calcular variações
      const expenseChange =
        previousExpenses > 0
          ? ((currentExpenses - previousExpenses) / previousExpenses) * 100
          : currentExpenses > 0
          ? 100
          : 0;

      const incomeChange =
        previousIncome > 0
          ? ((currentIncome - previousIncome) / previousIncome) * 100
          : currentIncome > 0
          ? 100
          : 0;

      // Comparar categorias
      const currentCategories = this.groupByCategoryForText(
        currentTransactions.filter((t) => t.type === "expense")
      );

      const previousCategories = this.groupByCategoryForText(
        previousTransactions.filter((t) => t.type === "expense")
      );

      let report = `📊 **RELATÓRIO COMPARATIVO**\n\n`;

      // Mês atual vs anterior
      report += `📅 **${currentMonth.format(
        "MMM/YYYY"
      )} vs ${previousMonth.format("MMM/YYYY")}**\n\n`;

      // Receitas
      if (currentIncome > 0 || previousIncome > 0) {
        report += `💵 **Receitas:**\n`;
        report += `• Atual: ${this.formatCurrencyBR(currentIncome)}\n`;
        report += `• Anterior: ${this.formatCurrencyBR(previousIncome)}\n`;
        report += `• Variação: ${this.formatVariation(incomeChange)}\n\n`;
      }

      // Despesas
      if (currentExpenses > 0 || previousExpenses > 0) {
        report += `💸 **Despesas:**\n`;
        report += `• Atual: ${this.formatCurrencyBR(currentExpenses)}\n`;
        report += `• Anterior: ${this.formatCurrencyBR(previousExpenses)}\n`;
        report += `• Variação: ${this.formatVariation(expenseChange)}\n\n`;
      }

      // Saldo
      const currentBalance = currentIncome - currentExpenses;
      const previousBalance = previousIncome - previousExpenses;

      report += `📊 **Resultado:**\n`;
      report += `• Atual: ${this.formatCurrencyBR(currentBalance)}\n`;
      report += `• Anterior: ${this.formatCurrencyBR(previousBalance)}\n`;

      const improvement = currentBalance - previousBalance;
      if (improvement > 0) {
        report += `• Melhoria: +${this.formatCurrencyBR(improvement)} ✅\n\n`;
      } else if (improvement < 0) {
        report += `• Piora: ${this.formatCurrencyBR(improvement)} ⚠️\n\n`;
      } else {
        report += `• Sem mudança\n\n`;
      }

      // Top categorias com maior mudança
      if (currentCategories.length > 0 && previousCategories.length > 0) {
        report += `📈 **Maiores Mudanças por Categoria:**\n`;

        const categoryChanges = this.calculateCategoryChanges(
          currentCategories,
          previousCategories
        );
        categoryChanges.slice(0, 3).forEach((change) => {
          const emoji = this.getCategoryEmojiForText(change.category);
          report += `${emoji} ${change.category}: ${this.formatVariation(
            change.percentChange
          )}\n`;
        });
      }

      report += `\n💡 Digite *"gastos do mês"* para ver detalhes atuais`;

      return {
        success: true,
        report,
        data: {
          currentExpenses,
          previousExpenses,
          currentIncome,
          previousIncome,
          expenseChange,
          incomeChange,
        },
      };
    } catch (error) {
      console.error("❌ Erro ao gerar relatório comparativo:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ✅ UTILITÁRIOS PARA O RELATÓRIO COMPARATIVO
  calculateCategoryChanges(currentCategories, previousCategories) {
    const changes = [];

    // Criar mapa de categorias anteriores
    const previousMap = {};
    previousCategories.forEach((cat) => {
      previousMap[cat.category] = cat.total;
    });

    // Calcular mudanças
    currentCategories.forEach((current) => {
      const previous = previousMap[current.category] || 0;

      if (previous > 0) {
        const percentChange = ((current.total - previous) / previous) * 100;
        changes.push({
          category: current.category,
          current: current.total,
          previous: previous,
          change: current.total - previous,
          percentChange: percentChange,
        });
      } else if (current.total > 0) {
        // Nova categoria
        changes.push({
          category: current.category,
          current: current.total,
          previous: 0,
          change: current.total,
          percentChange: 100,
        });
      }
    });

    // Ordenar por mudança absoluta (maior impacto)
    return changes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  }

  formatVariation(percentage) {
    if (percentage > 0) {
      return `+${percentage.toFixed(1)}% 📈`;
    } else if (percentage < 0) {
      return `${percentage.toFixed(1)}% 📉`;
    } else {
      return `0% ➡️`;
    }
  }

  // 1. Método principal para gerar PDF semanal
  async generateWeeklyPDFReport(userId) {
    try {
      console.log("📄 Gerando PDF de resumo semanal para:", userId);

      // Buscar dados da semana
      const { startDate, endDate } = this.getWeekDates();

      const transactions = await Transaction.findByUser(userId, {
        startDate,
        endDate,
      });

      // Calcular estatísticas
      const stats = this.calculateWeeklyStats(transactions);
      const balance = await Transaction.getCurrentBalance(userId);

      // Gerar PDF
      return await this.generateWeeklyPDF(
        userId,
        transactions,
        stats,
        balance,
        startDate,
        endDate
      );
    } catch (error) {
      console.error("❌ Erro ao gerar PDF semanal:", error);
      throw error;
    }
  }

  // 2. Calcular datas da semana
  getWeekDates() {
    const now = moment();
    const startDate = now.clone().startOf("week").toDate(); // Segunda-feira
    const endDate = now.clone().endOf("week").toDate(); // Domingo

    return { startDate, endDate };
  }

  // 3. Calcular estatísticas da semana
  calculateWeeklyStats(transactions) {
    const stats = {
      totalIncome: 0,
      totalExpenses: 0,
      transactionCount: transactions.length,
      categories: {},
      dailyData: {},
    };

    // Inicializar dados diários
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

  // 4. Gerar o PDF propriamente dito
  async generateWeeklyPDF(
    userId,
    transactions,
    stats,
    balance,
    startDate,
    endDate
  ) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "A4",
          margin: 40,
        });

        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));

        // CABEÇALHO
        doc
          .fontSize(20)
          .font("Helvetica-Bold")
          .fillColor("#2E86AB")
          .text("📊 RESUMO SEMANAL", { align: "center" });

        doc.moveDown(0.5);

        const weekText = `${moment(startDate).format("DD/MM/YYYY")} - ${moment(
          endDate
        ).format("DD/MM/YYYY")}`;
        doc
          .fontSize(12)
          .font("Helvetica")
          .fillColor("#666666")
          .text(weekText, { align: "center" })
          .text(`Gerado em: ${moment().format("DD/MM/YYYY HH:mm")}`, {
            align: "center",
          });

        doc.moveDown(1);

        // RESUMO GERAL
        this.addSectionTitle(doc, "💰 RESUMO GERAL");

        const netResult = stats.totalIncome - stats.totalExpenses;

        doc
          .fontSize(11)
          .font("Helvetica")
          .fillColor("#000000")
          .text(`💵 Receitas: ${this.formatCurrencyBR(stats.totalIncome)}`)
          .text(`💸 Despesas: ${this.formatCurrencyBR(stats.totalExpenses)}`)
          .text(
            `📊 Resultado: ${this.formatCurrencyBR(netResult)} ${
              netResult >= 0 ? "✅" : "⚠️"
            }`
          )
          .text(`💳 Saldo atual: ${this.formatCurrencyBR(balance)}`)
          .text(`📈 Total de transações: ${stats.transactionCount}`);

        doc.moveDown(1);

        // GASTOS POR CATEGORIA
        if (Object.keys(stats.categories).length > 0) {
          this.addSectionTitle(doc, "📂 GASTOS POR CATEGORIA");

          const sortedCategories = Object.entries(stats.categories)
            .sort(([, a], [, b]) => b.total - a.total)
            .slice(0, 8); // Top 8 categorias

          let yPosition = doc.y;

          sortedCategories.forEach(([category, data], index) => {
            const percentage = (
              (data.total / stats.totalExpenses) *
              100
            ).toFixed(1);
            const emoji = this.getCategoryEmojiForText(category);

            doc
              .fontSize(10)
              .font("Helvetica")
              .text(`${emoji} ${category}:`, 50, yPosition)
              .text(
                `${this.formatCurrencyBR(data.total)} (${percentage}%)`,
                250,
                yPosition
              )
              .text(`${data.count} transações`, 400, yPosition);

            yPosition += 20;
          });

          doc.y = yPosition + 10;
        }

        // RESUMO DIÁRIO
        this.addSectionTitle(doc, "📅 RESUMO DIÁRIO");

        const dailyEntries = Object.values(stats.dailyData);

        // Cabeçalho da tabela
        let tableY = doc.y;
        doc
          .fontSize(10)
          .font("Helvetica-Bold")
          .text("Dia", 50, tableY)
          .text("Receitas", 150, tableY)
          .text("Despesas", 250, tableY)
          .text("Saldo", 350, tableY)
          .text("Transações", 450, tableY);

        tableY += 20;

        // Linha separadora
        doc
          .strokeColor("#CCCCCC")
          .lineWidth(1)
          .moveTo(50, tableY - 5)
          .lineTo(550, tableY - 5)
          .stroke();

        dailyEntries.forEach((day, index) => {
          const dayBalance = day.income - day.expenses;
          const hasTransactions = day.transactions.length > 0;

          doc
            .fontSize(9)
            .font("Helvetica")
            .fillColor(hasTransactions ? "#000000" : "#CCCCCC")
            .text(`${day.dayName.substring(0, 3)} ${day.date}`, 50, tableY)
            .text(
              day.income > 0 ? this.formatCurrencyBR(day.income) : "-",
              150,
              tableY
            )
            .text(
              day.expenses > 0 ? this.formatCurrencyBR(day.expenses) : "-",
              250,
              tableY
            )
            .text(
              dayBalance !== 0 ? this.formatCurrencyBR(dayBalance) : "-",
              350,
              tableY
            )
            .text(day.transactions.length.toString(), 450, tableY);

          tableY += 18;

          // Quebra de página se necessário
          if (tableY > 700) {
            doc.addPage();
            tableY = 50;
          }
        });

        doc.moveDown(2);

        // ÚLTIMAS TRANSAÇÕES
        if (transactions.length > 0) {
          if (doc.y > 600) {
            doc.addPage();
          }

          this.addSectionTitle(doc, "💳 ÚLTIMAS TRANSAÇÕES");

          const recentTransactions = transactions
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 15);

          recentTransactions.forEach((t, index) => {
            if (doc.y > 750) {
              doc.addPage();
              doc.y = 50;
            }

            const emoji = t.type === "income" ? "💵" : "💸";
            const date = moment(t.date).format("DD/MM");

            doc
              .fontSize(9)
              .font("Helvetica")
              .text(`${emoji} ${this.formatCurrencyBR(t.amount)}`, 50, doc.y)
              .text(`${t.category}`, 150, doc.y)
              .text(`${t.establishment || t.description}`, 250, doc.y, {
                width: 200,
              })
              .text(date, 500, doc.y);

            doc.moveDown(0.3);
          });
        }

        // RODAPÉ
        doc
          .fontSize(8)
          .font("Helvetica-Oblique")
          .fillColor("#666666")
          .text("Relatório gerado pelo Bot Financeiro WhatsApp", 50, 750, {
            align: "center",
          });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // 5. Método auxiliar para títulos de seção
  addSectionTitle(doc, title) {
    doc.fontSize(14).font("Helvetica-Bold").fillColor("#2E86AB").text(title);
    doc.moveDown(0.5);
  }
}

module.exports = ReportService;
