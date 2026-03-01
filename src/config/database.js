const { Pool } = require('pg');
const dns = require('dns');
const { promisify } = require('util');

const dnsLookup = promisify(dns.lookup);

let pool = null;

async function initPool() {
  if (pool) return pool;

  let host = process.env.DB_HOST;

  // Resolver DNS para IPv4 explicitamente (Render tenta IPv6, Supabase free não aceita)
  try {
    const result = await dnsLookup(host, { family: 4 });
    console.log(`🔍 DNS resolvido: ${host} -> ${result.address} (IPv4)`);
    host = result.address;
  } catch (err) {
    console.warn(`⚠️ Falha ao resolver DNS IPv4, usando hostname original: ${err.message}`);
  }

  pool = new Pool({
    host,
    port: parseInt(process.env.DB_PORT || '5432'),
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

  return pool;
}

// Helper para queries parametrizadas (inicializa pool na primeira chamada)
const query = async (text, params) => {
  const p = await initPool();
  return p.query(text, params);
};

// Inicializar pool imediatamente
initPool().catch(err => console.error('❌ Erro ao inicializar pool:', err.message));

module.exports = { query, initPool };
