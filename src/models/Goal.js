const { query } = require('../config/database');
const moment = require('moment');

class Goal {
  constructor(row) {
    this.id = row.id;
    this.userId = row.user_id;
    this.category = row.category;
    this.monthlyLimit = parseFloat(row.monthly_limit);
    this.alertThreshold = parseFloat(row.alert_threshold || 0.8);
    this.isActive = row.is_active;
    this.notifications = row.notifications;
    this.createdAt = row.created_at;
  }

  // Criar nova meta
  static async create(goalData) {
    const { rows } = await query(
      `INSERT INTO goals (user_id, category, monthly_limit, alert_threshold)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, category) DO UPDATE
       SET monthly_limit = EXCLUDED.monthly_limit, is_active = true, updated_at = NOW()
       RETURNING *`,
      [
        goalData.userId,
        goalData.category,
        goalData.limit || goalData.monthlyLimit,
        goalData.alertThreshold || 0.8
      ]
    );
    return new Goal(rows[0]);
  }

  // Buscar metas do usuário
  static async findByUser(userId, activeOnly = true) {
    let sql = 'SELECT * FROM goals WHERE user_id = $1';
    if (activeOnly) sql += ' AND is_active = true';

    const { rows } = await query(sql, [userId]);
    return rows.map(row => new Goal(row));
  }

  // Buscar meta por categoria
  static async findByCategory(userId, category) {
    const { rows } = await query(
      'SELECT * FROM goals WHERE user_id = $1 AND category = $2 AND is_active = true LIMIT 1',
      [userId, category]
    );
    if (rows.length === 0) return null;
    return new Goal(rows[0]);
  }

  // Calcular progresso da meta
  async calculateProgress() {
    const startDate = moment().startOf('month').toDate();
    const endDate = moment().endOf('month').toDate();

    const { rows } = await query(
      `SELECT COALESCE(SUM(amount), 0) as total_spent
       FROM transactions
       WHERE user_id = $1 AND category = $2 AND type = 'expense'
         AND date >= $3 AND date <= $4`,
      [this.userId, this.category, startDate, endDate]
    );

    const totalSpent = parseFloat(rows[0].total_spent);
    const progress = totalSpent / this.monthlyLimit;
    const remaining = this.monthlyLimit - totalSpent;

    return {
      totalSpent,
      progress: Math.min(progress, 1),
      remaining: Math.max(remaining, 0),
      percentage: Math.round(progress * 100),
      isOverLimit: totalSpent > this.monthlyLimit,
      shouldAlert: progress >= this.alertThreshold
    };
  }

  // Verificar se deve enviar alerta
  async shouldSendAlert() {
    const progress = await this.calculateProgress();
    return progress.shouldAlert && this.notifications;
  }

  // Atualizar meta
  async update(updateData) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    if (updateData.monthlyLimit !== undefined) {
      fields.push(`monthly_limit = $${paramIndex++}`);
      values.push(updateData.monthlyLimit);
      this.monthlyLimit = updateData.monthlyLimit;
    }
    if (updateData.alertThreshold !== undefined) {
      fields.push(`alert_threshold = $${paramIndex++}`);
      values.push(updateData.alertThreshold);
    }
    if (updateData.isActive !== undefined) {
      fields.push(`is_active = $${paramIndex++}`);
      values.push(updateData.isActive);
    }
    if (updateData.notifications !== undefined) {
      fields.push(`notifications = $${paramIndex++}`);
      values.push(updateData.notifications);
    }

    if (fields.length === 0) return;

    fields.push(`updated_at = NOW()`);
    values.push(this.id);

    await query(
      `UPDATE goals SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  }

  // Desativar meta
  async deactivate() {
    this.isActive = false;
    await query(
      'UPDATE goals SET is_active = false, updated_at = NOW() WHERE id = $1',
      [this.id]
    );
  }

  // Gerar mensagem de alerta
  async generateAlertMessage() {
    const progress = await this.calculateProgress();
    const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

    if (progress.isOverLimit) {
      return `🚨 **ALERTA DE META EXCEDIDA!**\n\n` +
        `Você ultrapassou a meta de **${this.category}** em ${fmt(progress.totalSpent - this.monthlyLimit)}.\n\n` +
        `Meta: ${fmt(this.monthlyLimit)}\nGasto: ${fmt(progress.totalSpent)}`;
    } else if (progress.shouldAlert) {
      return `⚠️ **ALERTA DE META!**\n\n` +
        `Você já gastou **${progress.percentage}%** (${fmt(progress.totalSpent)}) da sua meta de **${this.category}**.\n\n` +
        `Meta: ${fmt(this.monthlyLimit)}\nRestante: ${fmt(progress.remaining)}`;
    }
    return null;
  }

  // Validar dados
  static validate(goalData) {
    const errors = [];
    if (!goalData.userId) errors.push('ID do usuário é obrigatório');
    if (!goalData.category) errors.push('Categoria é obrigatória');
    const limit = goalData.limit || goalData.monthlyLimit;
    if (!limit || limit <= 0) errors.push('Limite mensal deve ser maior que zero');
    return errors;
  }
}

module.exports = Goal;
