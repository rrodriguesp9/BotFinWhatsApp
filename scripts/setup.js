#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🤖 CONFIGURAÇÃO DO BOT FINANCEIRO WHATSAPP\n');

async function setup() {
  try {
    // Verificar se o arquivo .env existe
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
      console.log('📝 Criando arquivo .env...');
      fs.copyFileSync(path.join(process.cwd(), 'env.example'), envPath);
      console.log('✅ Arquivo .env criado!');
    } else {
      console.log('✅ Arquivo .env já existe');
    }

    // Verificar se o arquivo de credenciais do Firebase existe
    const firebaseKeyPath = path.join(process.cwd(), 'src/config/firebase-key.json');
    if (!fs.existsSync(firebaseKeyPath)) {
      console.log('\n⚠️  ATENÇÃO: Arquivo de credenciais do Firebase não encontrado!');
      console.log('📁 Crie o arquivo: src/config/firebase-key.json');
      console.log('🔗 Baixe as credenciais em: https://console.firebase.google.com/');
    } else {
      console.log('✅ Credenciais do Firebase encontradas');
    }

    // Verificar dependências
    console.log('\n📦 Verificando dependências...');
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      console.log('❌ package.json não encontrado!');
      process.exit(1);
    }

    console.log('✅ Dependências verificadas');

    // Instruções finais
    console.log('\n🎯 PRÓXIMOS PASSOS:');
    console.log('1. Configure as variáveis no arquivo .env');
    console.log('2. Adicione suas credenciais do Firebase');
    console.log('3. Configure o webhook no WhatsApp Business API');
    console.log('4. Execute: npm install');
    console.log('5. Execute: npm start');

    console.log('\n📚 DOCUMENTAÇÃO:');
    console.log('• README.md - Instruções completas');
    console.log('• env.example - Exemplo de configuração');

    console.log('\n🚀 Para iniciar o bot:');
    console.log('npm start');

  } catch (error) {
    console.error('❌ Erro durante a configuração:', error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

setup(); 