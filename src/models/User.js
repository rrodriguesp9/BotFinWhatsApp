const { query } = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  constructor(row) {
    this.id = row.id;
    this.phoneNumber = row.phone_number;
    this.name = row.name || '';
    this.pinHash = row.pin_hash || '';
    this.isActive = row.is_active;
    this.settings = {
      notifications: row.notifications,
      silentMode: {
        enabled: row.silent_mode,
        until: row.silent_until
      },
      language: row.language || 'pt-BR',
      currency: row.currency || 'BRL'
    };
    this.googleTokens = row.google_tokens || null;
    this.createdAt = row.created_at;
  }

  // Criar novo usuário (sem PIN padrão — onboarding pede para criar)
  static async create(phoneNumber, name = '') {
    const { rows } = await query(
      `INSERT INTO users (phone_number, name, pin_hash)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [phoneNumber, name, '']
    );

    // Criar saldo inicial
    await query(
      `INSERT INTO balances (user_id, current_balance) VALUES ($1, 0)`,
      [rows[0].id]
    );

    return new User(rows[0]);
  }

  // Buscar usuário por telefone
  static async findByPhone(phoneNumber) {
    const { rows } = await query(
      `SELECT * FROM users WHERE phone_number = $1 AND is_active = true LIMIT 1`,
      [phoneNumber]
    );

    if (rows.length === 0) return null;
    return new User(rows[0]);
  }

  // Buscar usuário por ID
  static async findById(userId) {
    const { rows } = await query(
      'SELECT * FROM users WHERE id = $1 AND is_active = true LIMIT 1',
      [userId]
    );
    if (rows.length === 0) return null;
    return new User(rows[0]);
  }

  // Verificar PIN
  async verifyPin(pin) {
    if (!this.pinHash) return false;
    return bcrypt.compare(pin, this.pinHash);
  }

  // Atualizar nome
  static async updateName(phoneNumber, name) {
    const result = await query(
      'UPDATE users SET name = $1, updated_at = NOW() WHERE phone_number = $2 RETURNING *',
      [name, phoneNumber]
    );
    return result.rows[0];
  }

  // Atualizar tokens do Google Calendar
  static async updateGoogleTokens(userId, tokens) {
    await query(
      'UPDATE users SET google_tokens = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(tokens), userId]
    );
  }

  // Atualizar PIN
  async updatePin(newPin) {
    this.pinHash = await bcrypt.hash(newPin, 10);
    await query(
      `UPDATE users SET pin_hash = $1, updated_at = NOW() WHERE id = $2`,
      [this.pinHash, this.id]
    );
  }

  // Atualizar configurações
  async updateSettings(newSettings) {
    if (newSettings.silentMode !== undefined) {
      this.settings.silentMode = newSettings.silentMode;
      await query(
        `UPDATE users SET silent_mode = $1, silent_until = $2, updated_at = NOW() WHERE id = $3`,
        [newSettings.silentMode.enabled, newSettings.silentMode.until, this.id]
      );
    }
    if (newSettings.notifications !== undefined) {
      this.settings.notifications = newSettings.notifications;
      await query(
        `UPDATE users SET notifications = $1, updated_at = NOW() WHERE id = $2`,
        [newSettings.notifications, this.id]
      );
    }
  }

  // Ativar/desativar modo silencioso
  async toggleSilentMode(duration = null) {
    const silentMode = duration
      ? { enabled: true, until: new Date(Date.now() + duration * 24 * 60 * 60 * 1000) }
      : { enabled: false, until: null };

    await this.updateSettings({ silentMode });
  }

  // Verificar se está em modo silencioso
  isInSilentMode() {
    if (!this.settings.silentMode.enabled) return false;
    if (this.settings.silentMode.until) {
      return new Date() < new Date(this.settings.silentMode.until);
    }
    return false;
  }

  // Dados públicos (sem PIN)
  toPublicJSON() {
    return {
      id: this.id,
      phoneNumber: this.phoneNumber,
      name: this.name,
      createdAt: this.createdAt,
      isActive: this.isActive,
      settings: {
        language: this.settings.language,
        currency: this.settings.currency
      }
    };
  }
}

module.exports = User;
