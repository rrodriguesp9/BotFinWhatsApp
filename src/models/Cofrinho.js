const { query, pool } = require('../config/database');
const moment = require('moment');

class Cofrinho {
  constructor(row) {
    this.id = row.id;
    this.userId = row.user_id;
    this.nome = row.nome;
    this.meta = parseFloat(row.meta);
    this.valorAtual = parseFloat(row.valor_atual);
    this.prazo = row.prazo;
    this.categoria = row.categoria || 'economia';
    this.descricao = row.descricao || '';
    this.ativo = row.ativo;
    this.criadoEm = row.created_at;
    this.atualizadoEm = row.updated_at;
  }

  // --- Métodos estáticos ---

  static async create(data) {
    const errors = Cofrinho.validate(data);
    if (errors.length > 0) throw new Error(errors.join(', '));

    const nome = Cofrinho.normalizeNome(data.nome || data.name);

    // Verificar duplicata
    const existing = await Cofrinho.findByName(data.userId, nome);
    if (existing) throw new Error(`Já existe um cofrinho chamado "${nome}"`);

    const { rows } = await query(
      `INSERT INTO cofrinhos (user_id, nome, meta, prazo, categoria, descricao)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [data.userId, nome, data.meta || data.target, data.prazo || null,
       data.categoria || 'economia', data.descricao || '']
    );
    return new Cofrinho(rows[0]);
  }

  static async findByUser(userId) {
    const { rows } = await query(
      'SELECT * FROM cofrinhos WHERE user_id = $1 AND ativo = true ORDER BY created_at DESC',
      [userId]
    );
    return rows.map(r => new Cofrinho(r));
  }

  static async findByName(userId, nome) {
    const normalized = Cofrinho.normalizeNome(nome);
    const { rows } = await query(
      'SELECT * FROM cofrinhos WHERE user_id = $1 AND LOWER(nome) = LOWER($2) AND ativo = true LIMIT 1',
      [userId, normalized]
    );
    return rows.length ? new Cofrinho(rows[0]) : null;
  }

  static async findById(cofrinhoId) {
    const { rows } = await query('SELECT * FROM cofrinhos WHERE id = $1', [cofrinhoId]);
    return rows.length ? new Cofrinho(rows[0]) : null;
  }

  static async obterResumoUsuario(userId) {
    const { rows } = await query(
      `SELECT COUNT(*) as total, COALESCE(SUM(valor_atual), 0) as total_guardado,
              COALESCE(SUM(meta), 0) as total_metas
       FROM cofrinhos WHERE user_id = $1 AND ativo = true`,
      [userId]
    );
    const r = rows[0];
    return {
      totalCofrinhos: parseInt(r.total),
      totalGuardado: parseFloat(r.total_guardado),
      totalMetas: parseFloat(r.total_metas)
    };
  }

  // --- Métodos de instância ---

  async adicionarValor(valor, descricao = '') {
    if (valor <= 0) throw new Error('Valor deve ser positivo');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const valorAnterior = this.valorAtual;

      const { rows } = await client.query(
        `UPDATE cofrinhos SET valor_atual = valor_atual + $1, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [valor, this.id]
      );

      await client.query(
        `INSERT INTO movimentos_cofrinho (cofrinho_id, user_id, tipo, valor, descricao, valor_anterior, valor_atual)
         VALUES ($1, $2, 'deposito', $3, $4, $5, $6)`,
        [this.id, this.userId, valor, descricao, valorAnterior, rows[0].valor_atual]
      );

      await client.query('COMMIT');

      this.valorAtual = parseFloat(rows[0].valor_atual);
      this.atualizadoEm = rows[0].updated_at;
      return this;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async retirarValor(valor, descricao = '') {
    if (valor <= 0) throw new Error('Valor deve ser positivo');
    if (valor > this.valorAtual) throw new Error('Saldo insuficiente no cofrinho');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const valorAnterior = this.valorAtual;

      const { rows } = await client.query(
        `UPDATE cofrinhos SET valor_atual = valor_atual - $1, updated_at = NOW()
         WHERE id = $2 AND valor_atual >= $1 RETURNING *`,
        [valor, this.id]
      );

      if (rows.length === 0) throw new Error('Saldo insuficiente');

      await client.query(
        `INSERT INTO movimentos_cofrinho (cofrinho_id, user_id, tipo, valor, descricao, valor_anterior, valor_atual)
         VALUES ($1, $2, 'retirada', $3, $4, $5, $6)`,
        [this.id, this.userId, valor, descricao, valorAnterior, rows[0].valor_atual]
      );

      await client.query('COMMIT');

      this.valorAtual = parseFloat(rows[0].valor_atual);
      this.atualizadoEm = rows[0].updated_at;
      return this;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async buscarHistorico(limite = 10, offset = 0) {
    const { rows } = await query(
      `SELECT * FROM movimentos_cofrinho WHERE cofrinho_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [this.id, limite, offset]
    );
    return rows;
  }

  async desativar() {
    await query(
      'UPDATE cofrinhos SET ativo = false, updated_at = NOW() WHERE id = $1',
      [this.id]
    );
    this.ativo = false;
  }

  async update(data) {
    const fields = [];
    const values = [];
    let i = 1;

    if (data.nome !== undefined) { fields.push(`nome = $${i++}`); values.push(Cofrinho.normalizeNome(data.nome)); }
    if (data.meta !== undefined) { fields.push(`meta = $${i++}`); values.push(data.meta); }
    if (data.prazo !== undefined) { fields.push(`prazo = $${i++}`); values.push(data.prazo); }
    if (data.descricao !== undefined) { fields.push(`descricao = $${i++}`); values.push(data.descricao); }

    if (fields.length === 0) return this;

    fields.push(`updated_at = NOW()`);
    values.push(this.id);

    const { rows } = await query(
      `UPDATE cofrinhos SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return new Cofrinho(rows[0]);
  }

  // --- Métodos puros (sem DB) ---

  calcularProgresso() {
    const percentual = this.meta > 0 ? (this.valorAtual / this.meta) * 100 : 0;
    return {
      percentual: Math.min(percentual, 100).toFixed(1),
      faltam: Math.max(this.meta - this.valorAtual, 0),
      atingido: this.valorAtual >= this.meta
    };
  }

  verificarPrazo() {
    if (!this.prazo) return { temPrazo: false };
    const agora = moment();
    const prazo = moment(this.prazo);
    const diasRestantes = prazo.diff(agora, 'days');
    return {
      temPrazo: true,
      diasRestantes,
      vencido: diasRestantes < 0,
      proximoVencimento: diasRestantes <= 7 && diasRestantes >= 0
    };
  }

  gerarRelatorio() {
    const progresso = this.calcularProgresso();
    const prazo = this.verificarPrazo();

    let msg = `💰 *Cofrinho: ${this.nome}*\n\n`;
    msg += `🎯 Meta: ${Cofrinho.formatarMoeda(this.meta)}\n`;
    msg += `💵 Guardado: ${Cofrinho.formatarMoeda(this.valorAtual)}\n`;
    msg += `📊 Progresso: ${progresso.percentual}%\n`;

    if (!progresso.atingido) {
      msg += `📉 Faltam: ${Cofrinho.formatarMoeda(progresso.faltam)}\n`;
    } else {
      msg += `✅ *Meta atingida!*\n`;
    }

    if (prazo.temPrazo) {
      if (prazo.vencido) {
        msg += `⚠️ Prazo vencido!\n`;
      } else {
        msg += `📅 Prazo: ${moment(this.prazo).format('DD/MM/YYYY')} (${prazo.diasRestantes} dias)\n`;
      }
    }

    return msg;
  }

  static formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
  }

  static validate(data) {
    const errors = [];
    const nome = data.nome || data.name;
    const meta = data.meta || data.target;

    if (!nome || nome.trim().length < 2) errors.push('Nome deve ter no mínimo 2 caracteres');
    if (!meta || meta <= 0) errors.push('Meta deve ser maior que zero');
    if (meta > 10000000) errors.push('Meta muito alta (máximo R$ 10.000.000)');
    if (data.prazo && moment(data.prazo).isBefore(moment())) errors.push('Prazo não pode ser no passado');

    return errors;
  }

  static normalizeNome(nome) {
    if (!nome) return '';
    return nome.trim().toLowerCase()
      .replace(/[^a-záàâãéèêíïóôõöúçñ\s0-9]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

module.exports = Cofrinho;
