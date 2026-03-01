// ✅ CRIAR arquivo: test-firebase.js (na raiz do projeto)
// Para testar Firebase isoladamente

const admin = require("firebase-admin");

console.log("🧪 TESTE ISOLADO DO FIREBASE");

// Carregar credenciais
const serviceAccount = require("./src/config/firebase-key.json");
console.log("✅ Credenciais carregadas");
console.log("🆔 Project ID:", serviceAccount.project_id);
console.log("📧 Client email:", serviceAccount.client_email);

// Inicializar Firebase
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "botfinwhatsapp.firebasestorage.app",
  });
  console.log("✅ Firebase inicializado");
} catch (error) {
  console.error("❌ Erro na inicialização:", error);
  process.exit(1);
}

const db = admin.firestore();

// Teste 1: Criar documento
async function test1() {
  try {
    console.log("\n🧪 TESTE 1: Criar documento...");
    await db.collection("_test").doc("connection").set({
      message: "Hello Firebase!",
      timestamp: new Date(),
    });
    console.log("✅ Documento criado");
  } catch (error) {
    console.error("❌ Erro ao criar documento:", error);
  }
}

// Teste 2: Ler documento
async function test2() {
  try {
    console.log("\n🧪 TESTE 2: Ler documento...");
    const doc = await db.collection("_test").doc("connection").get();
    if (doc.exists) {
      console.log("✅ Documento lido:", doc.data());
    } else {
      console.log("⚠️ Documento não existe");
    }
  } catch (error) {
    console.error("❌ Erro ao ler documento:", error);
  }
}

// Teste 3: Criar usuário de teste
async function test3() {
  try {
    console.log("\n🧪 TESTE 3: Criar usuário de teste...");
    const userRef = await db.collection("users").add({
      phoneNumber: "+5521999999999",
      name: "Usuario Teste",
      createdAt: new Date(),
      isActive: true,
      settings: {
        notifications: true,
        silentMode: { enabled: false, until: null },
        language: "pt-BR",
        currency: "BRL",
      },
    });
    console.log("✅ Usuário criado com ID:", userRef.id);

    // Criar saldo
    await db.collection("balances").doc(userRef.id).set({
      currentBalance: 0,
      updatedAt: new Date(),
    });
    console.log("✅ Saldo criado");
  } catch (error) {
    console.error("❌ Erro ao criar usuário:", error);
  }
}

// Teste 4: Criar transação de teste
async function test4() {
  try {
    console.log("\n🧪 TESTE 4: Criar transação de teste...");

    // Buscar usuário de teste
    const usersSnapshot = await db
      .collection("users")
      .where("phoneNumber", "==", "+5521999999999")
      .limit(1)
      .get();

    if (usersSnapshot.empty) {
      console.log("⚠️ Usuário de teste não encontrado");
      return;
    }

    const userId = usersSnapshot.docs[0].id;
    console.log("🔍 Usuário encontrado:", userId);

    // Criar transação
    await db.collection("transactions").add({
      userId: userId,
      type: "expense",
      amount: 50,
      category: "teste",
      description: "Transação de teste",
      date: new Date(),
      source: "test",
      createdAt: new Date(),
      isConfirmed: true,
      tags: [],
    });
    console.log("✅ Transação criada");
  } catch (error) {
    console.error("❌ Erro ao criar transação:", error);
  }
}

// Executar todos os testes
async function runAllTests() {
  await test1();
  await test2();
  await test3();
  await test4();

  console.log("\n🎯 TESTES CONCLUÍDOS");
  process.exit(0);
}

runAllTests();
