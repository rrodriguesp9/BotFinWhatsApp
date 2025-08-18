const admin = require("firebase-admin");
const { db } = require("../config/database");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

class User {
  // ✅ CORRIGIR settings padrão no constructor
  constructor(data) {
    this.id = data.id || uuidv4();
    this.phoneNumber = data.phoneNumber;
    this.name = data.name || "";
    this.pinHash = data.pinHash || "";
    this.createdAt = data.createdAt || new Date();
    this.isActive = data.isActive !== false;
    this.settings = data.settings || {
      notifications: true,
      silentMode: { enabled: false, until: null }, // ✅ CORRIGIDO: Objeto em vez de boolean
      language: "pt-BR",
      currency: "BRL",
    };
  }

  // ✅ CORRIGIR create method também
  static async create(phoneNumber, name = "", pin = "1234") {
    try {
      const pinHash = await bcrypt.hash(pin, 10);

      const userData = {
        phoneNumber,
        name,
        pinHash,
        createdAt: new Date(),
        isActive: true,
        settings: {
          notifications: true,
          silentMode: { enabled: false, until: null }, // ✅ CORRIGIDO
          language: "pt-BR",
          currency: "BRL",
        },
      };

      const userRef = await db.collection("users").add(userData);

      // Criar saldo inicial
      await db.collection("balances").doc(userRef.id).set({
        currentBalance: 0,
        updatedAt: new Date(),
      });

      return new User({ id: userRef.id, ...userData });
    } catch (error) {
      console.error("❌ ERRO detalhado ao criar usuário:", error);
      throw new Error(`Erro ao criar usuário: ${error.message}`);
    }
  }
  // Buscar usuário por telefone
  static async findByPhone(phoneNumber) {
    try {
      const snapshot = await db
        .collection("users")
        .where("phoneNumber", "==", phoneNumber)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return null;
      }

      const doc = snapshot.docs[0];
      return new User({ id: doc.id, ...doc.data() });
    } catch (error) {
      throw new Error(`Erro ao buscar usuário: ${error.message}`);
    }
  }

  // Verificar PIN
  async verifyPin(pin) {
    try {
      return await bcrypt.compare(pin, this.pinHash);
    } catch (error) {
      throw new Error(`Erro ao verificar PIN: ${error.message}`);
    }
  }

  // Atualizar PIN
  async updatePin(newPin) {
    try {
      this.pinHash = await bcrypt.hash(newPin, 10);
      await db.collection("users").doc(this.id).update({
        pinHash: this.pinHash,
        updatedAt: new Date(),
      });
      return true;
    } catch (error) {
      throw new Error(`Erro ao atualizar PIN: ${error.message}`);
    }
  }

  // Atualizar configurações
  async updateSettings(newSettings) {
    try {
      this.settings = { ...this.settings, ...newSettings };
      await db.collection("users").doc(this.id).update({
        settings: this.settings,
        updatedAt: new Date(),
      });
      return true;
    } catch (error) {
      throw new Error(`Erro ao atualizar configurações: ${error.message}`);
    }
  }

  // Ativar/desativar modo silencioso
  async toggleSilentMode(duration = null) {
    try {
      const silentMode = duration
        ? {
            enabled: true,
            until: new Date(Date.now() + duration * 24 * 60 * 60 * 1000), // dias para ms
          }
        : {
            enabled: false,
            until: null,
          };

      await this.updateSettings({ silentMode });
      return true;
    } catch (error) {
      throw new Error(`Erro ao alterar modo silencioso: ${error.message}`);
    }
  }

  // Verificar se está em modo silencioso
  isInSilentMode() {
    // ✅ CORREÇÃO: Verificar se silentMode existe e é objeto
    if (!this.settings || !this.settings.silentMode) {
      return false;
    }

    // ✅ CORREÇÃO: Compatibilidade com formato antigo (boolean)
    if (typeof this.settings.silentMode === "boolean") {
      return this.settings.silentMode;
    }

    // ✅ CORREÇÃO: Formato novo (objeto)
    if (typeof this.settings.silentMode === "object") {
      if (!this.settings.silentMode.enabled) return false;

      if (this.settings.silentMode.until) {
        return new Date() < this.settings.silentMode.until;
      }

      return this.settings.silentMode.enabled;
    }

    return false;
  }

  // Obter dados públicos (sem informações sensíveis)
  toPublicJSON() {
    return {
      id: this.id,
      phoneNumber: this.phoneNumber,
      name: this.name,
      createdAt: this.createdAt,
      isActive: this.isActive,
      settings: {
        language: this.settings.language,
        currency: this.settings.currency,
      },
    };
  }

  // ✅ ADICIONAR na classe User:

  static async updateGoogleTokens(userId, tokens) {
    console.log(
      `🧪 DEBUG - updateGoogleTokens chamado: userId=${userId}, tokens=`,
      tokens
    );
    const db = admin.firestore();
    await db.collection("users").doc(userId).update({
      googleTokens: tokens,
      calendarAuthorized: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`🧪 DEBUG - updateGoogleTokens concluído para user ${userId}`);
  }

  async isCalendarAuthorized() {
    return this.googleTokens && this.calendarAuthorized;
  }
}

module.exports = User;
