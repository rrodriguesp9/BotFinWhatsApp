const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '6543'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  console.log('✅ Conectado ao PostgreSQL (Supabase)');
});

pool.on('error', (err) => {
  console.error('❌ Erro na conexão PostgreSQL:', err.message);
});

const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };
