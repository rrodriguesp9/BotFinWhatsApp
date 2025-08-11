const { db } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');

class Goal {
  constructor(data) {
    this.id = data.id || uuidv4();
    this.userId = data.userId;
    this.category = data.category;
    this.monthlyLimit = data.monthlyLimit;
    this.alertThreshold = data.alertThreshold || 0.8; // 80% por padrão
    this.createdAt = data.createdAt || new Date();
    this.isActive = data.isActive !== false;
    this.notifications = data.notifications !== false;
  }

  // Criar nova meta
  static async create(goalData) {
    try {
      const goal = new Goal(goalData);
      
      await db.collection('goals').doc(goal.id).set({
        userId: goal.userId,
        category: goal.category,
        monthlyLimit: goal.monthlyLimit,
        alertThreshold: goal.alertThreshold,
        createdAt: goal.createdAt,
        isActive: goal.isActive,
        notifications: goal.notifications
      });

      return goal;
    } catch (error) {
      throw new Error(`Erro ao criar meta: ${error.message}`);
    }
  }

  // Buscar metas do usuário
  static async findByUser(userId, activeOnly = true) {
    try {
      let query = db.collection('goals').where('userId', '==', userId);
      
      if (activeOnly) {
        query = query.where('isActive', '==', true);
      }

      const snapshot = await query.get();
      
      return snapshot.docs.map(doc => new Goal({ id: doc.id, ...doc.data() }));
    } catch (error) {
      throw new Error(`Erro ao buscar metas: ${error.message}`);
    }
  }

  // Buscar meta por categoria
  static async findByCategory(userId, category) {
    try {
      const snapshot = await db.collection('goals')
        .where('userId', '==', userId)
        .where('category', '==', category)
        .where('isActive', '==', true)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return null;
      }

      const doc = snapshot.docs[0];
      return new Goal({ id: doc.id, ...doc.data() });
    } catch (error) {
      throw new Error(`Erro ao buscar meta por categoria: ${error.message}`);
    }
  }

  // Calcular progresso da meta
  async calculateProgress(month = null) {
    try {
      const Transaction = require('./Transaction');
      
      const startDate = month ? moment(month).startOf('month').toDate() : moment().startOf('month').toDate();
      const endDate = month ? moment(month).endOf('month').toDate() : moment().endOf('month').toDate();

      const transactions = await Transaction.findByUser(this.userId, {
        type: 'expense',
        category: this.category,
        startDate,
        endDate
      });

      const totalSpent = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
      const progress = totalSpent / this.monthlyLimit;
      const remaining = this.monthlyLimit - totalSpent;

      return {
        totalSpent,
        progress: Math.min(progress, 1), // Máximo 100%
        remaining: Math.max(remaining, 0),
        percentage: Math.round(progress * 100),
        isOverLimit: totalSpent > this.monthlyLimit,
        shouldAlert: progress >= this.alertThreshold
      };
    } catch (error) {
      throw new Error(`Erro ao calcular progresso: ${error.message}`);
    }
  }

  // Verificar se deve enviar alerta
  async shouldSendAlert() {
    try {
      const progress = await this.calculateProgress();
      return progress.shouldAlert && this.notifications;
    } catch (error) {
      throw new Error(`Erro ao verificar alerta: ${error.message}`);
    }
  }

  // Atualizar meta
  async update(updateData) {
    try {
      const allowedFields = ['monthlyLimit', 'alertThreshold', 'isActive', 'notifications'];
      const updates = {};

      allowedFields.forEach(field => {
        if (updateData[field] !== undefined) {
          updates[field] = updateData[field];
        }
      });

      updates.updatedAt = new Date();

      await db.collection('goals').doc(this.id).update(updates);

      // Atualizar propriedades locais
      Object.assign(this, updates);

      return true;
    } catch (error) {
      throw new Error(`Erro ao atualizar meta: ${error.message}`);
    }
  }

  // Desativar meta
  async deactivate() {
    try {
      this.isActive = false;
      await db.collection('goals').doc(this.id).update({
        isActive: false,
        updatedAt: new Date()
      });
      return true;
    } catch (error) {
      throw new Error(`Erro ao desativar meta: ${error.message}`);
    }
  }

  // Formatar para exibição
  async toDisplayFormat() {
    const progress = await this.calculateProgress();
    
    return {
      id: this.id,
      category: this.category,
      monthlyLimit: new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      }).format(this.monthlyLimit),
      totalSpent: new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      }).format(progress.totalSpent),
      remaining: new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      }).format(progress.remaining),
      percentage: progress.percentage,
      isOverLimit: progress.isOverLimit,
      shouldAlert: progress.shouldAlert,
      isActive: this.isActive,
      notifications: this.notifications
    };
  }

  // Gerar mensagem de alerta
  async generateAlertMessage() {
    try {
      const progress = await this.calculateProgress();
      
      if (progress.isOverLimit) {
        return `🚨 **ALERTA DE META EXCEDIDA!**\n\n` +
               `Você ultrapassou a meta de **${this.category}** em ` +
               `${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(progress.totalSpent - this.monthlyLimit)}.\n\n` +
               `Meta: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(this.monthlyLimit)}\n` +
               `Gasto: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(progress.totalSpent)}`;
      } else if (progress.shouldAlert) {
        return `⚠️ **ALERTA DE META!**\n\n` +
               `Você já gastou **${progress.percentage}%** (${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(progress.totalSpent)}) ` +
               `da sua meta de **${this.category}**.\n\n` +
               `Meta: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(this.monthlyLimit)}\n` +
               `Restante: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(progress.remaining)}`;
      }
      
      return null;
    } catch (error) {
      throw new Error(`Erro ao gerar mensagem de alerta: ${error.message}`);
    }
  }

  // Validar dados da meta
  static validate(goalData) {
    const errors = [];

    if (!goalData.userId) {
      errors.push('ID do usuário é obrigatório');
    }

    if (!goalData.category) {
      errors.push('Categoria é obrigatória');
    }

    if (!goalData.monthlyLimit || goalData.monthlyLimit <= 0) {
      errors.push('Limite mensal deve ser maior que zero');
    }

    if (goalData.alertThreshold && (goalData.alertThreshold < 0 || goalData.alertThreshold > 1)) {
      errors.push('Limite de alerta deve estar entre 0 e 1');
    }

    return errors;
  }
}

module.exports = Goal; 