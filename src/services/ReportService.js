const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const Transaction = require('../models/Transaction');
const Goal = require('../models/Goal');
const moment = require('moment');

class ReportService {
  constructor() {
    this.moment = moment;
  }

  // Gerar relatório no formato especificado
  async generateReport(userId, format = 'pdf', period = 'month') {
    try {
      const transactions = await Transaction.findByUser(userId, {
        startDate: Transaction.getPeriodStartDate(period)
      });

      const stats = await Transaction.getCategoryStats(userId, period);
      const goals = await Goal.findByUser(userId);
      const balance = await Transaction.getCurrentBalance(userId);

      switch (format.toLowerCase()) {
        case 'pdf':
          return await this.generatePDFReport(userId, transactions, stats, goals, balance, period);
        case 'csv':
          return await this.generateCSVReport(transactions, stats, period);
        case 'excel':
          return await this.generateExcelReport(transactions, stats, goals, balance, period);
        default:
          throw new Error(`Formato não suportado: ${format}`);
      }
    } catch (error) {
      console.error('❌ Erro ao gerar relatório:', error);
      throw error;
    }
  }

  // Gerar relatório PDF
  async generatePDFReport(userId, transactions, stats, goals, balance, period) {
    // Pré-calcular progresso das metas (async) antes de gerar o PDF (sync)
    const goalsData = [];
    for (const goal of goals) {
      const progress = await goal.calculateProgress();
      goalsData.push({ category: goal.category, monthlyLimit: goal.monthlyLimit, progress });
    }

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 50
        });

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        // Cabeçalho
        doc.fontSize(24)
           .font('Helvetica-Bold')
           .text('RELATORIO FINANCEIRO', { align: 'center' });

        doc.moveDown();
        doc.fontSize(12)
           .font('Helvetica')
           .text(`Periodo: ${this.getPeriodText(period)}`, { align: 'center' })
           .text(`Gerado em: ${moment().format('DD/MM/YYYY HH:mm')}`, { align: 'center' });

        doc.moveDown(2);

        // Saldo atual
        doc.fontSize(16)
           .font('Helvetica-Bold')
           .text('SALDO ATUAL');

        doc.fontSize(12)
           .font('Helvetica')
           .text(`R$ ${balance.toFixed(2)}`);

        doc.moveDown(2);

        // Resumo por categoria
        doc.fontSize(16)
           .font('Helvetica-Bold')
           .text('GASTOS POR CATEGORIA');

        Object.entries(stats).forEach(([category, data]) => {
          if (data.total > 0) {
            doc.fontSize(10)
               .font('Helvetica')
               .text(`${category}: R$ ${data.total.toFixed(2)} (${data.count} transacoes)`);
          }
        });

        doc.moveDown(2);

        // Metas
        if (goalsData.length > 0) {
          doc.fontSize(16)
             .font('Helvetica-Bold')
             .text('METAS');

          goalsData.forEach(({ category, monthlyLimit, progress }) => {
            doc.fontSize(10)
               .font('Helvetica')
               .text(`${category}: ${progress.percentage}% (R$ ${progress.totalSpent.toFixed(2)} / R$ ${monthlyLimit.toFixed(2)})`);
          });

          doc.moveDown(2);
        }

        // Transações recentes
        doc.fontSize(16)
           .font('Helvetica-Bold')
           .text('ULTIMAS TRANSACOES');

        transactions.slice(0, 20).forEach(transaction => {
          const formattedAmount = new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
          }).format(transaction.amount);

          const formattedDate = moment(transaction.date).format('DD/MM/YYYY');
          const icon = transaction.type === 'income' ? '[+]' : '[-]';

          doc.fontSize(8)
             .font('Helvetica')
             .text(`${formattedDate} - ${icon} ${formattedAmount} - ${transaction.category} - ${transaction.description}`);
        });

        // Rodapé
        doc.moveDown(2);
        doc.fontSize(10)
           .font('Helvetica-Oblique')
           .text('Relatorio gerado pelo Bot Financeiro WhatsApp', { align: 'center' });

        doc.end();

      } catch (error) {
        reject(error);
      }
    });
  }

  // Gerar relatório CSV
  async generateCSVReport(transactions, stats, period) {
    let csv = 'Data,Tipo,Valor,Categoria,Descrição\n';

    // Adicionar transações
    transactions.forEach(transaction => {
      const date = moment(transaction.date).format('DD/MM/YYYY');
      const amount = transaction.amount.toFixed(2);
      const type = transaction.type === 'income' ? 'Receita' : 'Despesa';
      
      csv += `${date},${type},${amount},${transaction.category},"${transaction.description}"\n`;
    });

    // Adicionar resumo por categoria
    csv += '\n\nResumo por Categoria\n';
    csv += 'Categoria,Total,Quantidade\n';
    
    Object.entries(stats).forEach(([category, data]) => {
      if (data.total > 0) {
        csv += `${category},${data.total.toFixed(2)},${data.count}\n`;
      }
    });

    return Buffer.from(csv, 'utf-8');
  }

  // Gerar relatório Excel
  async generateExcelReport(transactions, stats, goals, balance, period) {
    const workbook = new ExcelJS.Workbook();
    
    // Planilha de transações
    const transactionsSheet = workbook.addWorksheet('Transações');
    
    // Cabeçalhos
    transactionsSheet.columns = [
      { header: 'Data', key: 'date', width: 12 },
      { header: 'Tipo', key: 'type', width: 10 },
      { header: 'Valor', key: 'amount', width: 15 },
      { header: 'Categoria', key: 'category', width: 15 },
      { header: 'Descrição', key: 'description', width: 30 }
    ];

    // Adicionar dados
    transactions.forEach(transaction => {
      transactionsSheet.addRow({
        date: moment(transaction.date).format('DD/MM/YYYY'),
        type: transaction.type === 'income' ? 'Receita' : 'Despesa',
        amount: transaction.amount,
        category: transaction.category,
        description: transaction.description
      });
    });

    // Formatar valores monetários
    transactionsSheet.getColumn('amount').numFmt = 'R$ #,##0.00';

    // Planilha de resumo
    const summarySheet = workbook.addWorksheet('Resumo');
    
    // Saldo atual
    summarySheet.addRow(['Saldo Atual', balance]);
    summarySheet.addRow([]);

    // Estatísticas por categoria
    summarySheet.addRow(['Categoria', 'Total', 'Quantidade']);
    
    Object.entries(stats).forEach(([category, data]) => {
      if (data.total > 0) {
        summarySheet.addRow([category, data.total, data.count]);
      }
    });

    // Formatar valores monetários
    summarySheet.getColumn(2).numFmt = 'R$ #,##0.00';

    // Planilha de metas
    if (goals.length > 0) {
      const goalsSheet = workbook.addWorksheet('Metas');
      
      goalsSheet.columns = [
        { header: 'Categoria', key: 'category', width: 15 },
        { header: 'Limite Mensal', key: 'limit', width: 15 },
        { header: 'Gasto Atual', key: 'spent', width: 15 },
        { header: 'Restante', key: 'remaining', width: 15 },
        { header: 'Progresso (%)', key: 'progress', width: 15 }
      ];

      for (const goal of goals) {
        const progress = await goal.calculateProgress();
        goalsSheet.addRow({
          category: goal.category,
          limit: goal.monthlyLimit,
          spent: progress.totalSpent,
          remaining: progress.remaining,
          progress: progress.percentage
        });
      }

      // Formatar valores monetários
      goalsSheet.getColumn('limit').numFmt = 'R$ #,##0.00';
      goalsSheet.getColumn('spent').numFmt = 'R$ #,##0.00';
      goalsSheet.getColumn('remaining').numFmt = 'R$ #,##0.00';
      goalsSheet.getColumn('progress').numFmt = '0%';
    }

    return await workbook.xlsx.writeBuffer();
  }

  // Gerar gráfico de pizza (simulado)
  async generatePieChart(data) {
    // Implementação básica - em produção, usar biblioteca de gráficos
    const chartData = Object.entries(data).map(([category, value]) => ({
      category,
      value: value.total,
      percentage: (value.total / Object.values(data).reduce((sum, item) => sum + item.total, 0)) * 100
    }));

    return chartData;
  }

  // Gerar gráfico de barras (simulado)
  async generateBarChart(data) {
    // Implementação básica - em produção, usar biblioteca de gráficos
    const chartData = Object.entries(data).map(([category, value]) => ({
      category,
      value: value.total,
      count: value.count
    }));

    return chartData;
  }

  // Obter texto do período
  getPeriodText(period) {
    const periodTexts = {
      'week': 'Esta semana',
      'month': 'Este mês',
      'quarter': 'Este trimestre',
      'year': 'Este ano'
    };

    return periodTexts[period] || 'Este mês';
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
            isOverLimit: progress.isOverLimit
          });
        }
      }

      return alerts;
    } catch (error) {
      console.error('❌ Erro ao gerar relatório de alertas:', error);
      throw error;
    }
  }

  // Gerar relatório de tendências
  async generateTrendsReport(userId, months = 6) {
    try {
      const trends = [];
      
      for (let i = 0; i < months; i++) {
        const startDate = moment().subtract(i, 'months').startOf('month').toDate();
        const endDate = moment().subtract(i, 'months').endOf('month').toDate();
        
        const transactions = await Transaction.findByUser(userId, {
          startDate,
          endDate
        });

        const totalIncome = transactions
          .filter(t => t.type === 'income')
          .reduce((sum, t) => sum + t.amount, 0);
        
        const totalExpense = transactions
          .filter(t => t.type === 'expense')
          .reduce((sum, t) => sum + t.amount, 0);

        trends.push({
          month: moment(startDate).format('MMM/YYYY'),
          income: totalIncome,
          expense: totalExpense,
          balance: totalIncome - totalExpense
        });
      }

      return trends.reverse();
    } catch (error) {
      console.error('❌ Erro ao gerar relatório de tendências:', error);
      throw error;
    }
  }
}

module.exports = ReportService; 