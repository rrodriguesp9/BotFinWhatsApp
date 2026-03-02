require('dotenv').config();
const NLP = require('../src/services/NaturalLanguageProcessor');
const nlp = new NLP();

const tests = [
  { input: 'fiz um pix de 2k para Carlos', expect: 'expense', amount: 2000 },
  { input: 'transferi 500 para Maria', expect: 'expense', amount: 500 },
  { input: 'pix de 1.5k pro João', expect: 'expense', amount: 1500 },
  { input: 'gastei 50 no uber', expect: 'expense', amount: 50 },
  { input: 'recebi um pix de 3k', expect: 'income', amount: 3000 },
  { input: 'mandei um pix de 200', expect: 'expense', amount: 200 },
  { input: 'salário de 5k', expect: 'income', amount: 5000 },
  { input: 'oi', expect: 'greeting', amount: null },
  { input: 'gst 80 mercado', expect: 'expense', amount: 80 },
  { input: 'bom dia', expect: 'greeting', amount: null },
  { input: 'quanto tenho', expect: 'balance', amount: null },
  { input: 'ajuda', expect: 'help', amount: null },
  { input: 'enviei um pix de 300 pro dentista', expect: 'expense', amount: 300 },
];

let passed = 0;
for (const t of tests) {
  const result = nlp.processMessage(t.input);
  const intentOk = result.intention === t.expect;
  const amountOk = t.amount === null || result.extracted.amount === t.amount;
  const ok = intentOk && amountOk;

  let line = ok ? '  PASS' : '  FAIL';
  line += ` "${t.input}" => ${result.intention}`;
  if (t.amount !== null) {
    line += ` amt=${result.extracted.amount} (expected ${t.amount})`;
  }
  if (!intentOk) line += ` [expected intent: ${t.expect}]`;
  console.log(line);
  if (ok) passed++;
}
console.log(`\nResultado: ${passed}/${tests.length} passaram`);
process.exit(passed === tests.length ? 0 : 1);
