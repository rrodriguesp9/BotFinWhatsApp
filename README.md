# 🤖 Bot Financeiro WhatsApp

Bot financeiro pessoal inteligente via WhatsApp com controle de saldo, metas, relatórios e agenda.

## ✨ Funcionalidades

### 🎯 Funcionalidades Básicas (MVP)
- ✅ Registro de receitas e despesas por linguagem natural
- ✅ Saldo automático atualizado
- ✅ Categorização e metas por categoria
- ✅ Relatórios quinzenais e mensais com gráficos
- ✅ Integração com Google Calendar
- ✅ OCR para leitura de recibos
- ✅ Exportação de dados (PDF, CSV, Excel)
- ✅ Segurança com senha (PIN de 4 dígitos)
- ✅ Suporte multiusuário

### 🚀 Funcionalidades Avançadas
- 🔄 Lançamentos recorrentes
- 📆 Confirmação de eventos agendados
- 🧾 Importação de extratos bancários
- 💰 Cofrinhos / Objetivos financeiros
- 🧮 Divisão de despesas
- 💸 Arredondamento para poupança
- 🔕 Modo privado/silencioso
- 🎙️ Confirmação por áudio
- 👥 Acesso compartilhado

## 🛠️ Instalação

### Pré-requisitos
- Node.js 16+ 
- Conta no WhatsApp Business API
- Projeto Firebase
- Conta Google Cloud (para Calendar)

### 1. Clone o repositório
```bash
git clone https://github.com/seu-usuario/bot-financeiro-whatsapp.git
cd bot-financeiro-whatsapp
```

### 2. Instale as dependências
```bash
npm install
```

### 3. Configure as variáveis de ambiente
```bash
cp env.example .env
# Edite o arquivo .env com suas credenciais
```

### 4. Configure o Firebase
```bash
# Baixe o arquivo de credenciais do Firebase
# Coloque em src/config/firebase-key.json
```

### 5. Execute o bot
```bash
# Desenvolvimento
npm run dev

# Produção
npm start
```

## 📱 Como Usar

### Comandos Básicos
```
"Recebi 2500 hoje" → Registra entrada
"Gastei 50 com Uber" → Registra saída
"Quanto tenho agora?" → Mostra saldo
"Resumo da semana" → Lista movimentações
"Exporte agosto em CSV" → Envia relatório
```

### Comandos Avançados
```
"Criar cofrinho viagem 2000 até dezembro" → Inicia objetivo
"Foto do boleto" → Extrai valor via OCR
"Dividir pizza de 90 entre 3" → Lança gasto parcial
"Meta de mercado 600" → Define meta
"Pausar notificações por 3 dias" → Modo silencioso
```

## 🏗️ Arquitetura

```
src/
├── config/          # Configurações
├── controllers/     # Controladores
├── models/         # Modelos de dados
├── services/       # Serviços (OCR, Calendar, etc.)
├── utils/          # Utilitários
├── middleware/     # Middlewares
├── routes/         # Rotas da API
└── tests/          # Testes
```

## 🔧 Tecnologias

- **Backend:** Node.js + Express
- **Banco:** Firebase Firestore
- **OCR:** Tesseract.js
- **Calendário:** Google Calendar API
- **Relatórios:** Chart.js + PDFKit
- **Mensageria:** WhatsApp Business API

## 🧪 Testes

```bash
# Executar todos os testes
npm test

# Executar testes em modo watch
npm run test:watch
```

## 📊 Estrutura de Dados

### Usuários
- ID, telefone, nome, senha hash, data criação

### Transações
- ID, usuário, tipo, valor, categoria, descrição, data, recorrência

### Metas
- ID, usuário, categoria, limite mensal, alerta

### Saldos
- Usuário, saldo atual, data atualização

### Eventos
- ID, usuário, título, data, custo estimado, evento calendário

## 🔐 Segurança

- Autenticação via PIN de 4 dígitos
- Criptografia de dados sensíveis
- Validação de entrada
- Rate limiting
- Logs de auditoria

## 📈 Roadmap

- [ ] Integração com bancos brasileiros
- [ ] Análise de gastos com IA
- [ ] Backup automático
- [ ] Modo offline
- [ ] API pública

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request

## 📄 Licença

MIT License - veja o arquivo [LICENSE](LICENSE) para detalhes.

## 🆘 Suporte

- 📧 Email: suporte@botfinanceiro.com
- 💬 WhatsApp: +55 11 99999-9999
- 📖 Documentação: [docs.botfinanceiro.com](https://docs.botfinanceiro.com) 