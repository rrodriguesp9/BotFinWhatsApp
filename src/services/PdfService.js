const PDFDocument = require("pdfkit");
const moment = require("moment");

class PdfService {
  static async gerarPDFResumoSemanal(dadosResumo) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "A4",
          margin: 40,
          info: {
            Title: "Resumo Semanal",
            Author: "Bot Financeiro",
            Subject: "Relatório Financeiro",
          },
        });

        const buffers = [];
        doc.on("data", (buffer) => buffers.push(buffer));
        doc.on("end", () => {
          const pdfBuffer = Buffer.concat(buffers);
          resolve(pdfBuffer);
        });

        // ✅ CABEÇALHO SEM EMOJIS PROBLEMÁTICOS
        doc.rect(0, 0, doc.page.width, 80).fill("#2E86AB");

        doc
          .fontSize(24)
          .fillColor("white")
          .font("Helvetica-Bold")
          .text("RESUMO SEMANAL", 40, 25, { align: "center" });

        doc
          .fontSize(12)
          .fillColor("white")
          .font("Helvetica")
          .text(`Período: ${dadosResumo.periodo}`, 40, 50, { align: "center" })
          .text(`Gerado em: ${moment().format("DD/MM/YYYY HH:mm")}`, 40, 65, {
            align: "center",
          });

        // Reset para conteúdo
        doc.y = 100;
        doc.fillColor("black");

        // ✅ RESUMO GERAL COM SÍMBOLOS SIMPLES
        this.adicionarSecaoCard(doc, "RESUMO GERAL", "#F8F9FA");

        dadosResumo.resumoGeral.forEach((item) => {
          const cor = this.obterCorItem(item.tipo);
          const simbolo = this.obterSimboloItem(item.tipo);

          doc
            .fontSize(11)
            .fillColor(cor)
            .font("Helvetica-Bold")
            .text(`${simbolo} ${item.titulo}:`, 60, doc.y, { continued: true })
            .fillColor("black")
            .font("Helvetica")
            .text(` ${item.valor}`, { align: "left" });
          doc.moveDown(0.3);
        });

        doc.moveDown(1);

        // ✅ GASTOS POR CATEGORIA SEM EMOJIS
        if (dadosResumo.categorias && dadosResumo.categorias.length > 0) {
          this.adicionarSecaoCard(doc, "GASTOS POR CATEGORIA", "#FFF3CD");

          dadosResumo.categorias.slice(0, 8).forEach((cat, index) => {
            const simbolo = this.obterSimboloCategoria(cat.categoria);
            const percentual = cat.percentual ? ` (${cat.percentual}%)` : "";

            doc
              .fontSize(10)
              .fillColor("#495057")
              .text(`${simbolo} ${cat.categoria}:`, 60, doc.y, {
                continued: true,
              })
              .fillColor("#DC3545")
              .font("Helvetica-Bold")
              .text(` ${cat.valor}${percentual}`, { align: "left" })
              .fillColor("black")
              .font("Helvetica");
            doc.moveDown(0.4);
          });

          doc.moveDown(1);
        }

        // ✅ RESUMO DIÁRIO
        if (dadosResumo.resumoDiario && dadosResumo.resumoDiario.length > 0) {
          this.adicionarSecaoCard(doc, "RESUMO DIARIO", "#D1ECF1");

          // Cabeçalho da tabela
          this.adicionarCabecalhoTabela(doc);

          dadosResumo.resumoDiario.forEach((dia, index) => {
            const corFundo = index % 2 === 0 ? "#F8F9FA" : "white";
            this.adicionarLinhaTabelaDiaria(doc, dia, corFundo);
          });

          doc.moveDown(1);
        }

        // ✅ TRANSAÇÕES RECENTES
        if (
          dadosResumo.transacoesRecentes &&
          dadosResumo.transacoesRecentes.length > 0
        ) {
          this.adicionarSecaoCard(doc, "ULTIMAS TRANSACOES", "#E2E3E5");

          dadosResumo.transacoesRecentes.slice(0, 10).forEach((transacao) => {
            const simbolo = transacao.tipo === "income" ? "[+]" : "[-]";
            const cor = transacao.tipo === "income" ? "#28A745" : "#DC3545";

            doc
              .fontSize(9)
              .fillColor(cor)
              .text(`${simbolo} ${transacao.valor}`, 60, doc.y, {
                continued: true,
              })
              .fillColor("black")
              .text(` - ${transacao.categoria}`, { continued: true })
              .fillColor("#6C757D")
              .text(` (${transacao.data})`, { align: "left" });

            if (transacao.estabelecimento) {
              doc
                .fontSize(8)
                .fillColor("#6C757D")
                .text(`   ${transacao.estabelecimento}`, 60, doc.y);
            }

            doc.moveDown(0.5);
          });
        }

        // ✅ RODAPÉ
        this.adicionarRodape(doc);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // ✅ MÉTODOS AUXILIARES SEM EMOJIS

  static adicionarSecaoCard(doc, titulo, corFundo) {
    // Card com fundo colorido
    const yInicial = doc.y;
    doc.rect(40, yInicial - 5, doc.page.width - 80, 25).fill(corFundo);

    // Título da seção
    doc
      .fontSize(14)
      .fillColor("#2E86AB")
      .font("Helvetica-Bold")
      .text(titulo, 50, yInicial + 3);

    doc.y = yInicial + 30;
    doc.fillColor("black").font("Helvetica");
  }

  static adicionarCabecalhoTabela(doc) {
    const yTabela = doc.y;

    // Fundo do cabeçalho
    doc.rect(50, yTabela - 2, 500, 20).fill("#E9ECEF");

    // Textos do cabeçalho
    doc
      .fontSize(10)
      .fillColor("#495057")
      .font("Helvetica-Bold")
      .text("Dia", 60, yTabela + 5)
      .text("Receitas", 150, yTabela + 5)
      .text("Despesas", 250, yTabela + 5)
      .text("Saldo", 350, yTabela + 5)
      .text("Transacoes", 450, yTabela + 5);

    doc.y = yTabela + 25;
    doc.fillColor("black").font("Helvetica");
  }

  static adicionarLinhaTabelaDiaria(doc, dia, corFundo) {
    const yLinha = doc.y;

    // Fundo da linha
    doc.rect(50, yLinha - 2, 500, 18).fill(corFundo);

    // Converter nome do dia para português
    const diaNome = this.traduzirDiaSemana(dia.diaNome);

    // Dados da linha
    doc
      .fontSize(9)
      .fillColor("black")
      .text(diaNome, 60, yLinha + 3)
      .text(dia.receitas || "-", 150, yLinha + 3)
      .text(dia.despesas || "-", 250, yLinha + 3);

    // Saldo com cor
    const corSaldo = dia.saldoDia >= 0 ? "#28A745" : "#DC3545";
    doc.fillColor(corSaldo).text(dia.saldoDia || "-", 350, yLinha + 3);

    doc.fillColor("black").text(dia.numTransacoes || "0", 450, yLinha + 3);

    doc.y = yLinha + 20;
  }

  static adicionarRodape(doc) {
    // Linha separadora
    doc
      .strokeColor("#DEE2E6")
      .lineWidth(1)
      .moveTo(40, doc.page.height - 60)
      .lineTo(doc.page.width - 40, doc.page.height - 60)
      .stroke();

    // Texto do rodapé
    doc
      .fontSize(8)
      .fillColor("#6C757D")
      .font("Helvetica-Oblique")
      .text(
        "Relatorio gerado pelo Bot Financeiro WhatsApp",
        40,
        doc.page.height - 45,
        { align: "center", width: doc.page.width - 80 }
      );
  }

  // ✅ MÉTODOS UTILITÁRIOS SEM EMOJIS

  static obterCorItem(tipo) {
    const cores = {
      receita: "#28A745",
      despesa: "#DC3545",
      saldo: "#17A2B8",
      total: "#6F42C1",
    };
    return cores[tipo] || "#495057";
  }

  static obterSimboloItem(tipo) {
    const simbolos = {
      receita: "[+]",
      despesa: "[-]",
      saldo: "[=]",
      total: "[T]",
    };
    return simbolos[tipo] || "[-]";
  }

  static obterSimboloCategoria(categoria) {
    const simbolos = {
      alimentacao: "[A]",
      transporte: "[T]",
      saude: "[S]",
      contas: "[C]",
      vestuario: "[V]",
      lazer: "[L]",
      casa: "[H]",
      educacao: "[E]",
      outros: "[O]",
    };
    return simbolos[categoria.toLowerCase()] || "[O]";
  }

  static traduzirDiaSemana(diaNome) {
    // Extrair apenas a parte da data se vier em formato "Monday 11/08"
    if (diaNome.includes(" ")) {
      const partes = diaNome.split(" ");
      const diaIngles = partes[0];
      const data = partes[1];

      const traducoes = {
        Sunday: "Dom",
        Monday: "Seg",
        Tuesday: "Ter",
        Wednesday: "Qua",
        Thursday: "Qui",
        Friday: "Sex",
        Saturday: "Sab",
      };

      return `${traducoes[diaIngles] || diaIngles} ${data}`;
    }

    return diaNome;
  }

  // ✅ MÉTODO PARA FORMATAR DADOS (mesmo de antes)
  static formatarDadosResumo(transactions, stats, balance, startDate, endDate) {
    const dadosResumo = {
      periodo: `${moment(startDate).format("DD/MM/YYYY")} - ${moment(
        endDate
      ).format("DD/MM/YYYY")}`,

      resumoGeral: [
        {
          titulo: "Receitas",
          valor: this.formatarMoeda(stats.totalIncome),
          tipo: "receita",
        },
        {
          titulo: "Despesas",
          valor: this.formatarMoeda(stats.totalExpenses),
          tipo: "despesa",
        },
        {
          titulo: "Resultado",
          valor: this.formatarMoeda(stats.totalIncome - stats.totalExpenses),
          tipo: "saldo",
        },
        {
          titulo: "Saldo Atual",
          valor: this.formatarMoeda(balance),
          tipo: "total",
        },
      ],

      categorias: Object.entries(stats.categories || {})
        .map(([cat, data]) => ({
          categoria: cat,
          valor: this.formatarMoeda(data.total),
          percentual:
            stats.totalExpenses > 0
              ? ((data.total / stats.totalExpenses) * 100).toFixed(1)
              : "0",
        }))
        .sort((a, b) => parseFloat(b.percentual) - parseFloat(a.percentual)),

      resumoDiario: Object.values(stats.dailyData || {}).map((day) => ({
        diaNome: `${day.dayName} ${day.date}`,
        receitas: day.income > 0 ? this.formatarMoeda(day.income) : null,
        despesas: day.expenses > 0 ? this.formatarMoeda(day.expenses) : null,
        saldoDia: this.formatarMoeda(day.income - day.expenses),
        numTransacoes: day.transactions.length,
      })),

      transacoesRecentes: transactions
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 15)
        .map((t) => ({
          tipo: t.type,
          valor: this.formatarMoeda(t.amount),
          categoria: t.category,
          estabelecimento: t.establishment,
          data: moment(t.date).format("DD/MM"),
        })),
    };

    return dadosResumo;
  }

  static formatarMoeda(valor) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(valor || 0);
  }

  // ✅ ADICIONE ESTES MÉTODOS NO SEU PDFSERVICE.JS

  // 1. Método principal para PDF mensal
  static async gerarPDFResumoMensal(dadosResumo) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "A4",
          margin: 40,
          info: {
            Title: "Resumo Mensal",
            Author: "Bot Financeiro",
            Subject: "Relatório Financeiro Mensal",
          },
        });

        const buffers = [];
        doc.on("data", (buffer) => buffers.push(buffer));
        doc.on("end", () => {
          const pdfBuffer = Buffer.concat(buffers);
          resolve(pdfBuffer);
        });

        // ✅ CABEÇALHO MENSAL
        doc.rect(0, 0, doc.page.width, 80).fill("#1B5E20"); // Verde mais escuro

        doc
          .fontSize(24)
          .fillColor("white")
          .font("Helvetica-Bold")
          .text("RESUMO MENSAL", 40, 25, { align: "center" });

        doc
          .fontSize(12)
          .fillColor("white")
          .font("Helvetica")
          .text(`Período: ${dadosResumo.periodo}`, 40, 50, { align: "center" })
          .text(`Gerado em: ${moment().format("DD/MM/YYYY HH:mm")}`, 40, 65, {
            align: "center",
          });

        // Reset para conteúdo
        doc.y = 100;
        doc.fillColor("black");

        // ✅ RESUMO GERAL EXPANDIDO
        this.adicionarSecaoCard(doc, "RESUMO GERAL", "#E8F5E8");

        dadosResumo.resumoGeral.forEach((item) => {
          const cor = this.obterCorItem(item.tipo);
          const simbolo = this.obterSimboloItem(item.tipo);

          doc
            .fontSize(12)
            .fillColor(cor)
            .font("Helvetica-Bold")
            .text(`${simbolo} ${item.titulo}:`, 60, doc.y, { continued: true })
            .fillColor("black")
            .font("Helvetica")
            .text(` ${item.valor}`, { align: "left" });
          doc.moveDown(0.4);
        });

        // ✅ ESTATÍSTICAS EXTRAS (só no mensal)
        if (dadosResumo.estatisticasExtras) {
          doc.moveDown(0.5);
          doc
            .fontSize(10)
            .fillColor("#666666")
            .text(
              `[M] Média diária de gastos: ${dadosResumo.estatisticasExtras.mediaDiariaGastos}`
            )
            .text(
              `[M] Maior gasto do mês: ${dadosResumo.estatisticasExtras.maiorGasto}`
            )
            .text(
              `[M] Dias com transações: ${dadosResumo.estatisticasExtras.diasComTransacoes}/${dadosResumo.estatisticasExtras.totalDiasMes}`
            );
        }

        doc.moveDown(1);

        // ✅ GASTOS POR CATEGORIA (expandido)
        if (dadosResumo.categorias && dadosResumo.categorias.length > 0) {
          this.adicionarSecaoCard(doc, "ANALISE POR CATEGORIA", "#FFF8E1");

          dadosResumo.categorias.slice(0, 10).forEach((cat, index) => {
            const simbolo = this.obterSimboloCategoria(cat.categoria);
            const percentual = cat.percentual ? ` (${cat.percentual}%)` : "";

            doc
              .fontSize(10)
              .fillColor("#495057")
              .text(`${simbolo} ${cat.categoria}:`, 60, doc.y, {
                continued: true,
              })
              .fillColor("#D32F2F")
              .font("Helvetica-Bold")
              .text(` ${cat.valor}${percentual}`, { continued: true })
              .fillColor("#666666")
              .font("Helvetica")
              .text(` | ${cat.transacoes} transações`);
            doc.moveDown(0.4);
          });

          doc.moveDown(1);
        }

        // ✅ COMPARATIVO COM MÊS ANTERIOR (novo!)
        if (dadosResumo.comparativo) {
          this.adicionarSecaoCard(
            doc,
            "COMPARATIVO COM MES ANTERIOR",
            "#E3F2FD"
          );

          doc
            .fontSize(10)
            .fillColor("#1976D2")
            .text(
              `[<] Gastos mês anterior: ${dadosResumo.comparativo.gastosAnterior}`
            )
            .fillColor("#388E3C")
            .text(
              `[=] Variação de gastos: ${dadosResumo.comparativo.variacaoGastos}`
            )
            .fillColor("#F57C00")
            .text(`[T] Tendência: ${dadosResumo.comparativo.tendencia}`);

          doc.moveDown(1);
        }

        // ✅ RESUMO SEMANAL DO MÊS
        if (dadosResumo.resumoSemanal && dadosResumo.resumoSemanal.length > 0) {
          this.adicionarSecaoCard(doc, "RESUMO POR SEMANA", "#F3E5F5");

          // Cabeçalho da tabela semanal
          this.adicionarCabecalhoTabelaSemanal(doc);

          dadosResumo.resumoSemanal.forEach((semana, index) => {
            const corFundo = index % 2 === 0 ? "#FAFAFA" : "white";
            this.adicionarLinhaTabelaSemanal(doc, semana, corFundo);
          });

          doc.moveDown(1);
        }

        // ✅ TOP ESTABELECIMENTOS (novo!)
        if (
          dadosResumo.topEstabelecimentos &&
          dadosResumo.topEstabelecimentos.length > 0
        ) {
          this.adicionarSecaoCard(doc, "TOP ESTABELECIMENTOS", "#FFEBEE");

          dadosResumo.topEstabelecimentos.slice(0, 8).forEach((est, index) => {
            doc
              .fontSize(9)
              .fillColor("#424242")
              .text(`${index + 1}. ${est.nome}:`, 60, doc.y, {
                continued: true,
              })
              .fillColor("#D32F2F")
              .font("Helvetica-Bold")
              .text(` ${est.valor}`, { continued: true })
              .fillColor("#757575")
              .font("Helvetica")
              .text(` (${est.transacoes}x)`);
            doc.moveDown(0.3);
          });

          doc.moveDown(1);
        }

        // ✅ TRANSAÇÕES MAIS RELEVANTES
        if (
          dadosResumo.transacoesMaisRelevantes &&
          dadosResumo.transacoesMaisRelevantes.length > 0
        ) {
          if (doc.y > 600) {
            doc.addPage();
          }

          this.adicionarSecaoCard(doc, "TRANSACOES MAIS RELEVANTES", "#EFEBE9");

          dadosResumo.transacoesMaisRelevantes
            .slice(0, 15)
            .forEach((transacao) => {
              if (doc.y > 750) {
                doc.addPage();
                doc.y = 50;
              }

              const simbolo = transacao.tipo === "income" ? "[+]" : "[-]";
              const cor = transacao.tipo === "income" ? "#2E7D32" : "#D32F2F";

              doc
                .fontSize(9)
                .fillColor(cor)
                .font("Helvetica-Bold")
                .text(`${simbolo} ${transacao.valor}`, 60, doc.y, {
                  continued: true,
                })
                .fillColor("black")
                .font("Helvetica")
                .text(` - ${transacao.categoria}`, { continued: true })
                .fillColor("#757575")
                .text(` (${transacao.data})`);

              if (transacao.estabelecimento) {
                doc
                  .fontSize(8)
                  .fillColor("#757575")
                  .text(`   ${transacao.estabelecimento}`, 60, doc.y);
              }

              doc.moveDown(0.4);
            });
        }

        // ✅ RODAPÉ
        this.adicionarRodape(doc);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // ✅ MÉTODOS AUXILIARES PARA TABELA SEMANAL

  static adicionarCabecalhoTabelaSemanal(doc) {
    const yTabela = doc.y;

    // Fundo do cabeçalho
    doc.rect(50, yTabela - 2, 500, 20).fill("#E1BEE7");

    // Textos do cabeçalho
    doc
      .fontSize(10)
      .fillColor("#4A148C")
      .font("Helvetica-Bold")
      .text("Semana", 60, yTabela + 5)
      .text("Receitas", 150, yTabela + 5)
      .text("Despesas", 250, yTabela + 5)
      .text("Saldo", 350, yTabela + 5)
      .text("Transacoes", 450, yTabela + 5);

    doc.y = yTabela + 25;
    doc.fillColor("black").font("Helvetica");
  }

  static adicionarLinhaTabelaSemanal(doc, semana, corFundo) {
    const yLinha = doc.y;

    // Fundo da linha
    doc.rect(50, yLinha - 2, 500, 18).fill(corFundo);

    // Dados da linha
    doc
      .fontSize(9)
      .fillColor("black")
      .text(semana.periodo, 60, yLinha + 3)
      .text(semana.receitas || "-", 150, yLinha + 3)
      .text(semana.despesas || "-", 250, yLinha + 3);

    // Saldo com cor
    const corSaldo = semana.saldoSemana >= 0 ? "#2E7D32" : "#D32F2F";
    doc.fillColor(corSaldo).text(semana.saldoSemana || "-", 350, yLinha + 3);

    doc.fillColor("black").text(semana.numTransacoes || "0", 450, yLinha + 3);

    doc.y = yLinha + 20;
  }

  // ✅ MÉTODO PARA FORMATAR DADOS MENSAIS
  static formatarDadosMensais(
    transactions,
    stats,
    balance,
    startDate,
    endDate,
    statsComparativo = null
  ) {
    const totalDiasMes = moment(endDate).date();
    const diasComTransacoes = [
      ...new Set(transactions.map((t) => moment(t.date).format("YYYY-MM-DD"))),
    ].length;

    const dadosResumo = {
      periodo: `${moment(startDate).format("MMMM/YYYY")}`,

      resumoGeral: [
        {
          titulo: "Receitas",
          valor: this.formatarMoeda(stats.totalIncome),
          tipo: "receita",
        },
        {
          titulo: "Despesas",
          valor: this.formatarMoeda(stats.totalExpenses),
          tipo: "despesa",
        },
        {
          titulo: "Resultado",
          valor: this.formatarMoeda(stats.totalIncome - stats.totalExpenses),
          tipo: "saldo",
        },
        {
          titulo: "Saldo Atual",
          valor: this.formatarMoeda(balance),
          tipo: "total",
        },
        {
          titulo: "Total de Transacoes",
          valor: transactions.length.toString(),
          tipo: "total",
        },
      ],

      // ✅ ESTATÍSTICAS EXTRAS
      estatisticasExtras: {
        mediaDiariaGastos: this.formatarMoeda(
          stats.totalExpenses / totalDiasMes
        ),
        maiorGasto: this.formatarMoeda(
          Math.max(
            ...transactions
              .filter((t) => t.type === "expense")
              .map((t) => t.amount),
            0
          )
        ),
        diasComTransacoes: diasComTransacoes,
        totalDiasMes: totalDiasMes,
      },

      categorias: Object.entries(stats.categories || {})
        .map(([cat, data]) => ({
          categoria: cat,
          valor: this.formatarMoeda(data.total),
          percentual:
            stats.totalExpenses > 0
              ? ((data.total / stats.totalExpenses) * 100).toFixed(1)
              : "0",
          transacoes: data.count,
        }))
        .sort((a, b) => parseFloat(b.percentual) - parseFloat(a.percentual)),

      // ✅ COMPARATIVO (se fornecido)
      comparativo: statsComparativo
        ? {
            gastosAnterior: this.formatarMoeda(statsComparativo.totalExpenses),
            variacaoGastos: this.calcularVariacao(
              statsComparativo.totalExpenses,
              stats.totalExpenses
            ),
            tendencia: this.analisarTendencia(
              statsComparativo.totalExpenses,
              stats.totalExpenses
            ),
          }
        : null,

      // ✅ RESUMO SEMANAL
      resumoSemanal: this.criarResumoSemanal(transactions, startDate, endDate),

      // ✅ TOP ESTABELECIMENTOS
      topEstabelecimentos: this.criarTopEstabelecimentos(transactions),

      // ✅ TRANSAÇÕES MAIS RELEVANTES (maiores valores)
      transacoesMaisRelevantes: transactions
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 20)
        .map((t) => ({
          tipo: t.type,
          valor: this.formatarMoeda(t.amount),
          categoria: t.category,
          estabelecimento: t.establishment,
          data: moment(t.date).format("DD/MM"),
        })),
    };

    return dadosResumo;
  }

  // ✅ MÉTODOS AUXILIARES

  static calcularVariacao(valorAnterior, valorAtual) {
    if (valorAnterior === 0) return "+100%";
    const variacao = ((valorAtual - valorAnterior) / valorAnterior) * 100;
    return `${variacao > 0 ? "+" : ""}${variacao.toFixed(1)}%`;
  }

  static analisarTendencia(valorAnterior, valorAtual) {
    if (valorAtual > valorAnterior * 1.1)
      return "Gastos aumentaram significativamente";
    if (valorAtual < valorAnterior * 0.9)
      return "Gastos diminuíram significativamente";
    return "Gastos estáveis";
  }

  static criarResumoSemanal(transactions, startDate, endDate) {
    const semanas = [];
    let currentWeekStart = moment(startDate).startOf("week");

    while (currentWeekStart.isBefore(endDate)) {
      const weekEnd = currentWeekStart.clone().endOf("week");
      if (weekEnd.isAfter(endDate)) weekEnd.set(endDate);

      const weekTransactions = transactions.filter((t) =>
        moment(t.date).isBetween(currentWeekStart, weekEnd, null, "[]")
      );

      const weekIncome = weekTransactions
        .filter((t) => t.type === "income")
        .reduce((sum, t) => sum + t.amount, 0);
      const weekExpenses = weekTransactions
        .filter((t) => t.type === "expense")
        .reduce((sum, t) => sum + t.amount, 0);

      semanas.push({
        periodo: `${currentWeekStart.format("DD/MM")} - ${weekEnd.format(
          "DD/MM"
        )}`,
        receitas: weekIncome > 0 ? this.formatarMoeda(weekIncome) : null,
        despesas: weekExpenses > 0 ? this.formatarMoeda(weekExpenses) : null,
        saldoSemana: this.formatarMoeda(weekIncome - weekExpenses),
        numTransacoes: weekTransactions.length,
      });

      currentWeekStart.add(1, "week");
    }

    return semanas;
  }

  static criarTopEstabelecimentos(transactions) {
    const estabelecimentos = {};

    transactions
      .filter((t) => t.type === "expense")
      .forEach((t) => {
        const nome = t.establishment || t.description || "Outros";
        if (!estabelecimentos[nome]) {
          estabelecimentos[nome] = { total: 0, count: 0 };
        }
        estabelecimentos[nome].total += t.amount;
        estabelecimentos[nome].count += 1;
      });

    return Object.entries(estabelecimentos)
      .map(([nome, data]) => ({
        nome,
        valor: this.formatarMoeda(data.total),
        transacoes: data.count,
      }))
      .sort(
        (a, b) =>
          parseFloat(b.valor.replace(/[^\d,]/g, "").replace(",", ".")) -
          parseFloat(a.valor.replace(/[^\d,]/g, "").replace(",", "."))
      )
      .slice(0, 10);
  }
}

module.exports = PdfService;
