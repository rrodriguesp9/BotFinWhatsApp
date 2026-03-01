const { query } = require('../config/database');
const moment = require('moment');

class Transaction {
  constructor(row) {
    this.id = row.id;
    this.userId = row.user_id;
    this.type = row.type;
    this.amount = parseFloat(row.amount);
    this.category = row.category || 'outros';
    this.description = row.description || '';
    this.date = row.date;
    this.recurrenceId = row.recurrence_id;
    this.source = row.source || 'text';
    this.isConfirmed = row.is_confirmed;
    this.tags = row.tags || [];
    this.createdAt = row.created_at;
  }

  // Criar nova transação
  static async create(transactionData) {
    const { rows } = await query(
      `INSERT INTO transactions (user_id, type, amount, category, description, date, recurrence_id, source, is_confirmed, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        transactionData.userId,
        transactionData.type,
        transactionData.amount,
        transactionData.category || 'outros',
        transactionData.description || '',
        transactionData.date || new Date(),
        transactionData.recurrenceId || null,
        transactionData.source || 'text',
        transactionData.isConfirmed !== false,
        transactionData.tags || []
      ]
    );

    // Atualizar saldo
    await this.updateUserBalance(transactionData.userId, transactionData.type, transactionData.amount);

    return new Transaction(rows[0]);
  }

  // Atualizar saldo do usuário
  static async updateUserBalance(userId, type, amount) {
    const operator = type === 'income' ? '+' : '-';
    const { rows } = await query(
      `UPDATE balances
       SET current_balance = current_balance ${operator} $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING current_balance`,
      [amount, userId]
    );
    return rows.length > 0 ? parseFloat(rows[0].current_balance) : 0;
  }

  // Buscar transações do usuário
  static async findByUser(userId, filters = {}) {
    let sql = 'SELECT * FROM transactions WHERE user_id = $1';
    const params = [userId];
    let paramIndex = 2;

    if (filters.type) {
      sql += ` AND type = $${paramIndex++}`;
      params.push(filters.type);
    }
    if (filters.category) {
      sql += ` AND category = $${paramIndex++}`;
      params.push(filters.category);
    }
    if (filters.startDate) {
      sql += ` AND date >= $${paramIndex++}`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND date <= $${paramIndex++}`;
      params.push(filters.endDate);
    }

    sql += ' ORDER BY date DESC';

    const { rows } = await query(sql, params);
    return rows.map(row => new Transaction(row));
  }

  // Obter saldo atual
  static async getCurrentBalance(userId) {
    const { rows } = await query(
      'SELECT current_balance FROM balances WHERE user_id = $1',
      [userId]
    );
    return rows.length > 0 ? parseFloat(rows[0].current_balance) : 0;
  }

  // Estatísticas por categoria
  static async getCategoryStats(userId, period = 'month') {
    const startDate = this.getPeriodStartDate(period);
    const { rows } = await query(
      `SELECT category, type,
              SUM(amount) as total,
              COUNT(*) as count
       FROM transactions
       WHERE user_id = $1 AND date >= $2
       GROUP BY category, type`,
      [userId, startDate]
    );

    const stats = {};
    rows.forEach(row => {
      stats[row.category] = {
        total: parseFloat(row.total),
        count: parseInt(row.count),
        type: row.type
      };
    });
    return stats;
  }

  // Data de início do período
  static getPeriodStartDate(period) {
    const now = moment();
    switch (period) {
      case 'week': return now.startOf('week').toDate();
      case 'month': return now.startOf('month').toDate();
      case 'quarter': return now.startOf('quarter').toDate();
      case 'year': return now.startOf('year').toDate();
      default: return now.startOf('month').toDate();
    }
  }

  // Confirmar transação
  async confirm() {
    this.isConfirmed = true;
    await query(
      'UPDATE transactions SET is_confirmed = true WHERE id = $1',
      [this.id]
    );
  }

  // Excluir transação (reverte saldo)
  async delete() {
    const reverseType = this.type === 'income' ? 'expense' : 'income';
    await Transaction.updateUserBalance(this.userId, reverseType, this.amount);
    await query('DELETE FROM transactions WHERE id = $1', [this.id]);
  }

  // Formatar para exibição
  toDisplayFormat() {
    return {
      id: this.id,
      type: this.type,
      amount: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(this.amount),
      category: this.category,
      description: this.description,
      date: moment(this.date).format('DD/MM/YYYY'),
      source: this.source,
      isConfirmed: this.isConfirmed,
      tags: this.tags
    };
  }

  // Validar dados
  static validate(transactionData) {
    const errors = [];
    if (!transactionData.userId) errors.push('ID do usuário é obrigatório');
    if (!transactionData.type || !['income', 'expense'].includes(transactionData.type)) {
      errors.push('Tipo deve ser "income" ou "expense"');
    }
    if (!transactionData.amount || transactionData.amount <= 0) {
      errors.push('Valor deve ser maior que zero');
    }
    if (!transactionData.category) errors.push('Categoria é obrigatória');
    return errors;
  }
}

module.exports = Transaction;
