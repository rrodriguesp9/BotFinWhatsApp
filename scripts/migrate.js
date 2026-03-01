require('dotenv').config();
const { pool } = require('../src/config/database');

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('🔄 Iniciando migração...\n');

    await client.query('BEGIN');

    // Tabela de usuários
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone_number VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(100) DEFAULT '',
        pin_hash VARCHAR(255) DEFAULT '',
        is_active BOOLEAN DEFAULT true,
        notifications BOOLEAN DEFAULT true,
        silent_mode BOOLEAN DEFAULT false,
        silent_until TIMESTAMPTZ,
        language VARCHAR(10) DEFAULT 'pt-BR',
        currency VARCHAR(5) DEFAULT 'BRL',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Tabela users criada');

    // Tabela de saldos
    await client.query(`
      CREATE TABLE IF NOT EXISTS balances (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        current_balance NUMERIC(12,2) DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Tabela balances criada');

    // Tabela de transações
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
        amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        category VARCHAR(50) DEFAULT 'outros',
        description TEXT DEFAULT '',
        date TIMESTAMPTZ DEFAULT NOW(),
        recurrence_id UUID,
        source VARCHAR(10) DEFAULT 'text' CHECK (source IN ('text', 'image', 'audio')),
        is_confirmed BOOLEAN DEFAULT true,
        tags TEXT[] DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Tabela transactions criada');

    // Índices para transactions
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);
      CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(user_id, category);
    `);
    console.log('✅ Índices de transactions criados');

    // Tabela de metas
    await client.query(`
      CREATE TABLE IF NOT EXISTS goals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category VARCHAR(50) NOT NULL,
        monthly_limit NUMERIC(12,2) NOT NULL CHECK (monthly_limit > 0),
        alert_threshold NUMERIC(3,2) DEFAULT 0.80,
        is_active BOOLEAN DEFAULT true,
        notifications BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, category)
      );
    `);
    console.log('✅ Tabela goals criada');

    // Índice para goals
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_goals_user_id ON goals(user_id);
    `);
    console.log('✅ Índice de goals criado');

    await client.query('COMMIT');
    console.log('\n✅ Migração concluída com sucesso!');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erro na migração:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
