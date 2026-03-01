require('dotenv').config();
const User = require('../src/models/User');
const Transaction = require('../src/models/Transaction');
const Goal = require('../src/models/Goal');
const NaturalLanguageProcessor = require('../src/services/NaturalLanguageProcessor');
const BotController = require('../src/controllers/BotController');
const ReportService = require('../src/services/ReportService');
const { pool } = require('../src/config/database');

let userId;
const phone = '5511888880001';
let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FALHOU: ${label}`);
    failed++;
  }
}

async function testUserModel() {
  console.log('\n═══════════════════════════════════════');
  console.log('  TESTE 1: USER MODEL');
  console.log('═══════════════════════════════════════\n');

  const user = await User.create(phone, 'Teste Bot');
  userId = user.id;
  assert('User.create()', user.phoneNumber === phone && user.name === 'Teste Bot');

  const found = await User.findByPhone(phone);
  assert('User.findByPhone() encontra', found !== null && found.id === userId);

  const notFound = await User.findByPhone('0000000000');
  assert('User.findByPhone() retorna null se nao existe', notFound === null);

  const pinOk = await user.verifyPin('1234');
  assert('verifyPin("1234") = true (PIN padrao)', pinOk === true);

  const pinBad = await user.verifyPin('0000');
  assert('verifyPin("0000") = false', pinBad === false);

  await user.updatePin('5678');
  const newPinOk = await user.verifyPin('5678');
  assert('updatePin("5678") funciona', newPinOk === true);

  assert('isInSilentMode() = false (padrao)', user.isInSilentMode() === false);

  await user.toggleSilentMode(3);
  const silentUser = await User.findByPhone(phone);
  assert('toggleSilentMode(3) ativa por 3 dias', silentUser.isInSilentMode() === true);

  await silentUser.toggleSilentMode();
  const unsilent = await User.findByPhone(phone);
  assert('toggleSilentMode() desativa', unsilent.isInSilentMode() === false);

  const pub = user.toPublicJSON();
  assert('toPublicJSON() nao expoe pinHash', pub.pinHash === undefined);
}

async function testTransactionModel() {
  console.log('\n═══════════════════════════════════════');
  console.log('  TESTE 2: TRANSACTION MODEL');
  console.log('═══════════════════════════════════════\n');

  const balInit = await Transaction.getCurrentBalance(userId);
  assert('Saldo inicial = 0', balInit === 0);

  await Transaction.create({ userId, type: 'income', amount: 3000, category: 'outros', description: 'Salario' });
  const bal1 = await Transaction.getCurrentBalance(userId);
  assert('Receita R$3000 -> saldo = 3000', bal1 === 3000);

  await Transaction.create({ userId, type: 'expense', amount: 50, category: 'transporte', description: 'Uber' });
  await Transaction.create({ userId, type: 'expense', amount: 350, category: 'mercado', description: 'Supermercado' });
  await Transaction.create({ userId, type: 'expense', amount: 150, category: 'contas', description: 'Luz' });
  await Transaction.create({ userId, type: 'expense', amount: 80, category: 'mercado', description: 'Feira' });
  const bal2 = await Transaction.getCurrentBalance(userId);
  assert('4 despesas -> saldo = 2370', bal2 === 2370);

  const all = await Transaction.findByUser(userId);
  assert('findByUser() retorna 5 transacoes', all.length === 5);

  const expenses = await Transaction.findByUser(userId, { type: 'expense' });
  assert('filter type=expense -> 4 resultados', expenses.length === 4);

  const mercado = await Transaction.findByUser(userId, { category: 'mercado' });
  assert('filter category=mercado -> 2 resultados', mercado.length === 2);

  const stats = await Transaction.getCategoryStats(userId, 'month');
  assert('getCategoryStats() tem mercado', stats.mercado && stats.mercado.total === 430);
  assert('getCategoryStats() tem transporte', stats.transporte && stats.transporte.total === 50);

  const display = all[0].toDisplayFormat();
  assert('toDisplayFormat() tem amount e date formatados', display.amount.includes('R$') && display.date.includes('/'));

  const errOk = Transaction.validate({ userId, type: 'expense', amount: 50, category: 'test' });
  assert('validate(valido) = 0 erros', errOk.length === 0);

  const errBad = Transaction.validate({ type: 'invalid', amount: -10 });
  assert('validate(invalido) >= 2 erros', errBad.length >= 2);

  // Deletar e reverter saldo
  const uberTx = expenses.find(t => t.description === 'Uber');
  await uberTx.delete();
  const bal3 = await Transaction.getCurrentBalance(userId);
  assert('delete() reverte saldo (+50) -> 2420', bal3 === 2420);
}

async function testGoalModel() {
  console.log('\n═══════════════════════════════════════');
  console.log('  TESTE 3: GOAL MODEL');
  console.log('═══════════════════════════════════════\n');

  const goal = await Goal.create({ userId, category: 'mercado', limit: 600 });
  assert('Goal.create() mercado R$600', goal.category === 'mercado' && goal.monthlyLimit === 600);

  // mercado: 350 + 80 = 430
  const prog = await goal.calculateProgress();
  assert('calculateProgress() totalSpent=430', prog.totalSpent === 430);
  assert('calculateProgress() percentage=72%', prog.percentage === 72);
  assert('calculateProgress() shouldAlert=false (72% < 80%)', prog.shouldAlert === false);

  const foundGoal = await Goal.findByCategory(userId, 'mercado');
  assert('findByCategory(mercado) encontra', foundGoal !== null);

  const noGoal = await Goal.findByCategory(userId, 'lazer');
  assert('findByCategory(lazer) = null', noGoal === null);

  const allGoals = await Goal.findByUser(userId);
  assert('findByUser() retorna 1 meta', allGoals.length === 1);

  // Adicionar mais gasto para atingir 80%
  await Transaction.create({ userId, type: 'expense', amount: 70, category: 'mercado', description: 'Padaria' });
  // mercado agora: 430 + 70 = 500 -> 83%
  const prog2 = await goal.calculateProgress();
  assert('Apos +R$70: percentage=83%', prog2.percentage === 83);
  assert('shouldAlert=true (83% >= 80%)', prog2.shouldAlert === true);

  const alert = await goal.generateAlertMessage();
  assert('generateAlertMessage() retorna string', typeof alert === 'string' && alert.includes('ALERTA'));

  // Ultrapassar limite
  await Transaction.create({ userId, type: 'expense', amount: 150, category: 'mercado', description: 'Extra' });
  // mercado agora: 500 + 150 = 650 -> 108%
  const prog3 = await goal.calculateProgress();
  assert('Apos +R$150: isOverLimit=true', prog3.isOverLimit === true);

  const alertExc = await goal.generateAlertMessage();
  assert('generateAlertMessage() EXCEDIDA', typeof alertExc === 'string' && alertExc.includes('EXCEDIDA'));

  // Update
  await goal.update({ monthlyLimit: 800 });
  assert('update(limit=800) funciona', goal.monthlyLimit === 800);

  // Deactivate
  await goal.deactivate();
  const deact = await Goal.findByCategory(userId, 'mercado');
  assert('deactivate() -> findByCategory = null', deact === null);

  // Validação
  const errOk = Goal.validate({ userId, category: 'test', limit: 100 });
  assert('validate(valido) = 0 erros', errOk.length === 0);

  const errBad = Goal.validate({ category: '', limit: -10 });
  assert('validate(invalido) >= 2 erros', errBad.length >= 2);
}

async function testNLP() {
  console.log('\n═══════════════════════════════════════');
  console.log('  TESTE 4: NLP (Natural Language)');
  console.log('═══════════════════════════════════════\n');

  const nlp = new NaturalLanguageProcessor();

  const tests = [
    { msg: 'gastei 50 no uber', expect: 'expense', checkAmt: 50 },
    { msg: 'paguei 150 na conta de luz', expect: 'expense', checkAmt: 150 },
    { msg: 'comprei 80 no mercado', expect: 'expense', checkAmt: 80 },
    { msg: 'almoço 35', expect: 'expense', checkAmt: 35 },
    { msg: 'recebi 2500 do salário', expect: 'income', checkAmt: 2500 },
    { msg: 'ganhei 500 do freela', expect: 'income', checkAmt: 500 },
    { msg: 'quanto tenho agora?', expect: 'balance' },
    { msg: 'meu saldo', expect: 'balance' },
    { msg: 'resumo da semana', expect: 'report' },
    { msg: 'relatório do mês', expect: 'report' },
    { msg: 'meta de mercado 600', expect: 'goal' },
    { msg: 'criar cofrinho viagem 2000', expect: 'savings' },
    { msg: 'dividir pizza de 90 entre 3', expect: 'split' },
    { msg: 'exporte este mês em PDF', expect: 'export' },
    { msg: 'ajuda', expect: 'help' },
    { msg: 'pausar notificações por 3 dias', expect: 'silent' },
  ];

  tests.forEach(({ msg, expect, checkAmt }) => {
    const result = nlp.processMessage(msg);
    const intentOk = result.intention === expect;
    const amtOk = checkAmt ? result.extracted.amount === checkAmt : true;
    assert(`"${msg}" -> ${expect}${checkAmt ? ' R$' + checkAmt : ''}`, intentOk && amtOk);
  });

  // Teste de categorias
  const catTests = [
    { msg: 'gastei 10 no uber', cat: 'transporte' },
    { msg: 'comprei 20 no mercado', cat: 'mercado' },
    { msg: 'paguei 30 na conta de luz', cat: 'contas' },
    { msg: 'gastei 40 no restaurante', cat: 'alimentação' },
  ];

  catTests.forEach(({ msg, cat }) => {
    const result = nlp.processMessage(msg);
    assert(`"${msg}" -> categoria: ${cat}`, result.extracted.category === cat);
  });

  // Teste de período
  const periodTests = [
    { msg: 'resumo da semana', period: 'week' },
    { msg: 'relatório do mês', period: 'month' },
  ];

  periodTests.forEach(({ msg, period }) => {
    const result = nlp.processMessage(msg);
    assert(`"${msg}" -> period: ${period}`, result.extracted.period === period);
  });

  // Help message
  const helpMsg = nlp.generateHelpMessage();
  assert('generateHelpMessage() retorna string longa', helpMsg.length > 200);
}

async function testBotController() {
  console.log('\n═══════════════════════════════════════');
  console.log('  TESTE 5: BOT CONTROLLER (E2E)');
  console.log('═══════════════════════════════════════\n');

  const bot = new BotController();
  const sentMessages = [];

  // Mock do WhatsApp (captura mensagens ao invés de enviar)
  bot.whatsapp.sendMessage = async (phone, msg) => {
    sentMessages.push({ phone, msg });
    return { messages: [{ id: 'mock' }] };
  };

  // 5.1 Novo usuário -> welcome
  sentMessages.length = 0;
  await bot.processMessage('5511777770001', 'oi');
  assert('Novo usuario recebe welcome', sentMessages.length > 0 && sentMessages[0].msg.includes('BEM-VINDO'));

  // Buscar o user criado
  const testUser = await User.findByPhone('5511777770001');

  // 5.2 Registrar receita
  sentMessages.length = 0;
  await bot.processMessage('5511777770001', 'recebi 5000 do salário');
  assert('Receita registrada', sentMessages.length > 0 && sentMessages[0].msg.includes('Receita registrada'));

  // 5.3 Registrar despesa
  sentMessages.length = 0;
  await bot.processMessage('5511777770001', 'gastei 200 no mercado');
  assert('Despesa registrada', sentMessages.length > 0 && sentMessages[0].msg.includes('Despesa registrada'));

  // 5.4 Consultar saldo
  sentMessages.length = 0;
  await bot.processMessage('5511777770001', 'quanto tenho agora?');
  assert('Saldo retornado', sentMessages.length > 0 && sentMessages[0].msg.includes('SALDO'));

  // 5.5 Criar meta
  sentMessages.length = 0;
  await bot.processMessage('5511777770001', 'meta de mercado 500');
  assert('Meta criada', sentMessages.length > 0 && sentMessages[0].msg.includes('Meta criada'));

  // 5.6 Relatório
  sentMessages.length = 0;
  await bot.processMessage('5511777770001', 'resumo da semana');
  const reportMsg = sentMessages.length > 0 ? sentMessages[0].msg : '';
  assert('Relatório gerado', reportMsg.includes('RELATÓRIO') || reportMsg.includes('Nenhuma'));

  // 5.7 Dividir despesa
  sentMessages.length = 0;
  await bot.processMessage('5511777770001', 'dividir pizza de 90 entre 3');
  assert('Divisão registrada', sentMessages.length > 0 && sentMessages[0].msg.includes('dividida'));

  // 5.8 Ajuda
  sentMessages.length = 0;
  await bot.processMessage('5511777770001', 'ajuda');
  assert('Ajuda enviada', sentMessages.length > 0 && sentMessages[0].msg.includes('COMANDOS'));

  // 5.9 Modo silencioso
  sentMessages.length = 0;
  await bot.processMessage('5511777770001', 'pausar notificações por 2 dias');
  assert('Modo silencioso ativado', sentMessages.length > 0 && sentMessages[0].msg.includes('silencioso'));

  // 5.10 Comando desconhecido (desativar silent mode antes)
  const u = await User.findByPhone('5511777770001');
  await u.toggleSilentMode(); // desativar
  sentMessages.length = 0;
  await bot.processMessage('5511777770001', 'blablabla');
  assert('Comando desconhecido tratado', sentMessages.length > 0 && sentMessages[0].msg.includes('não reconhecido'));

  // 5.11 OCR confirmation flow
  bot.sessions.set('5511777770001', {
    type: 'ocr_confirmation',
    data: { amount: 89.50, category: 'mercado', description: 'Supermercado ABC', date: new Date() },
    timestamp: Date.now()
  });
  sentMessages.length = 0;
  await bot.processMessage('5511777770001', 'sim');
  assert('OCR "sim" registra transação', sentMessages.length > 0 && sentMessages[0].msg.includes('registrada'));

  // 5.12 OCR "não"
  bot.sessions.set('5511777770001', {
    type: 'ocr_confirmation',
    data: { amount: 50, category: 'outros' },
    timestamp: Date.now()
  });
  sentMessages.length = 0;
  await bot.processMessage('5511777770001', 'não');
  assert('OCR "não" cancela', sentMessages.length > 0 && sentMessages[0].msg.includes('cancelada'));

  // Cleanup user E2E
  if (testUser) {
    await pool.query('DELETE FROM transactions WHERE user_id = $1', [testUser.id]);
    await pool.query('DELETE FROM goals WHERE user_id = $1', [testUser.id]);
    await pool.query('DELETE FROM balances WHERE user_id = $1', [testUser.id]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUser.id]);
  }
}

async function testReportService() {
  console.log('\n═══════════════════════════════════════');
  console.log('  TESTE 6: REPORT SERVICE');
  console.log('═══════════════════════════════════════\n');

  // Criar dados temporários para relatório
  const user = await User.create('5511666660001', 'Report Test');
  const uid = user.id;

  await Transaction.create({ userId: uid, type: 'income', amount: 2000, category: 'outros', description: 'Salario' });
  await Transaction.create({ userId: uid, type: 'expense', amount: 100, category: 'mercado', description: 'Compras' });
  await Transaction.create({ userId: uid, type: 'expense', amount: 50, category: 'transporte', description: 'Uber' });

  const report = new ReportService();

  // CSV
  const csv = await report.generateReport(uid, 'csv', 'month');
  const csvStr = csv.toString();
  assert('CSV gerado com header', csvStr.includes('Data,Tipo,Valor,Categoria'));
  assert('CSV contem transações', csvStr.includes('Compras') && csvStr.includes('Uber'));

  // Excel
  const excel = await report.generateReport(uid, 'excel', 'month');
  assert('Excel gerado (Buffer)', Buffer.isBuffer(excel) && excel.length > 100);

  // PDF
  const pdf = await report.generateReport(uid, 'pdf', 'month');
  assert('PDF gerado (Buffer)', Buffer.isBuffer(pdf) && pdf.length > 100);

  // Trends
  const trends = await report.generateTrendsReport(uid, 3);
  assert('Trends retorna array de 3 meses', Array.isArray(trends) && trends.length === 3);

  // Cleanup
  await pool.query('DELETE FROM transactions WHERE user_id = $1', [uid]);
  await pool.query('DELETE FROM goals WHERE user_id = $1', [uid]);
  await pool.query('DELETE FROM balances WHERE user_id = $1', [uid]);
  await pool.query('DELETE FROM users WHERE id = $1', [uid]);
}

async function main() {
  console.log('\n🧪 BATERIA COMPLETA DE TESTES - Bot Financeiro WhatsApp');
  console.log('   Banco: Supabase PostgreSQL (produção)\n');

  try {
    await testUserModel();
    await testTransactionModel();
    await testGoalModel();
    await testNLP();
    await testBotController();
    await testReportService();

    console.log('\n═══════════════════════════════════════');
    console.log('  RESULTADO FINAL');
    console.log('═══════════════════════════════════════\n');
    console.log(`  ✅ Passou: ${passed}`);
    console.log(`  ❌ Falhou: ${failed}`);
    console.log(`  📊 Total:  ${passed + failed}\n`);

    if (failed === 0) {
      console.log('  🎉 100% DOS TESTES PASSARAM!\n');
    } else {
      console.log(`  ⚠️  ${failed} teste(s) falharam.\n`);
    }
  } catch (e) {
    console.error('\n❌ ERRO FATAL:', e.message);
    console.error(e.stack);
  } finally {
    // Cleanup final
    if (userId) {
      await pool.query('DELETE FROM transactions WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM goals WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM balances WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    }
    await pool.end();
  }
}

main();
