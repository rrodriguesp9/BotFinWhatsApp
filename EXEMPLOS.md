# 📱 Exemplos de Uso do Bot Financeiro

## 🎯 Comandos Básicos

### 💸 Registrar Gastos
```
"Gastei 50 no Uber"
→ 💸 Despesa registrada!
💰 Valor: R$ 50,00
📂 Categoria: transporte
📝 Descrição: uber
💳 Saldo atual: R$ 1.450,00

"Paguei 150 na conta de luz"
→ 💸 Despesa registrada!
💰 Valor: R$ 150,00
📂 Categoria: contas
📝 Descrição: conta de luz
💳 Saldo atual: R$ 1.300,00

"Comprei 80 no mercado"
→ 💸 Despesa registrada!
💰 Valor: R$ 80,00
📂 Categoria: mercado
📝 Descrição: mercado
💳 Saldo atual: R$ 1.220,00
```

### 💵 Registrar Receitas
```
"Recebi 2500 do salário"
→ 💵 Receita registrada!
💰 Valor: R$ 2.500,00
📂 Categoria: outros
📝 Descrição: salário
💳 Saldo atual: R$ 3.720,00

"Ganhei 500 do freela"
→ 💵 Receita registrada!
💰 Valor: R$ 500,00
📂 Categoria: outros
📝 Descrição: freela
💳 Saldo atual: R$ 4.220,00
```

### 💳 Consultar Saldo
```
"Quanto tenho agora?"
→ 💳 SEU SALDO ATUAL
💰 Disponível: R$ 4.220,00
💡 Dica: Envie "resumo da semana" para ver suas movimentações.

"Meu saldo"
→ 💳 SEU SALDO ATUAL
💰 Disponível: R$ 4.220,00
```

### 📊 Relatórios
```
"Resumo da semana"
→ 📊 RELATÓRIO WEEK
💵 Receitas: R$ 3.000,00
💸 Despesas: R$ 280,00
📂 Por Categoria:
• transporte: R$ 50,00
• contas: R$ 150,00
• mercado: R$ 80,00

"Relatório do mês"
→ 📊 RELATÓRIO MONTH
💵 Receitas: R$ 5.500,00
💸 Despesas: R$ 1.200,00
📂 Por Categoria:
• mercado: R$ 400,00
• transporte: R$ 300,00
• contas: R$ 500,00
```

## 🎯 Funcionalidades Avançadas

### 🎯 Metas Financeiras
```
"Meta de mercado 600"
→ 🎯 Meta criada com sucesso!
📂 Categoria: mercado
💰 Limite mensal: R$ 600,00
Receberá alertas quando atingir 80% do limite.

"Meta de transporte 200"
→ 🎯 Meta criada com sucesso!
📂 Categoria: transporte
💰 Limite mensal: R$ 200,00
```

### ⚠️ Alertas de Meta
```
[Quando atingir 80% da meta]
→ ⚠️ ALERTA DE META!
Você já gastou 80% (R$ 480,00) da sua meta de mercado.
Meta: R$ 600,00
Restante: R$ 120,00

[Quando ultrapassar a meta]
→ 🚨 ALERTA DE META EXCEDIDA!
Você ultrapassou a meta de mercado em R$ 50,00.
Meta: R$ 600,00
Gasto: R$ 650,00
```

### 💰 Cofrinhos
```
"Criar cofrinho viagem 2000"
→ 💰 Cofrinho criado!
🎯 Objetivo: viagem
💰 Meta: R$ 2.000,00
Para adicionar dinheiro ao cofrinho, digite:
"adicionar 100 ao cofrinho viagem"
```

### 🧮 Divisão de Despesas
```
"Dividir pizza de 90 entre 3"
→ 🧮 Despesa dividida registrada!
📝 Descrição: pizza
💰 Total: R$ 90,00
👥 Dividido por: 3 pessoas
💸 Sua parte: R$ 30,00
```

### 📤 Exportação de Dados
```
"Exporte este mês em PDF"
→ 📤 Relatório enviado!
📄 Formato: PDF
📅 Período: month
O arquivo foi enviado acima.

"Exporte agosto em CSV"
→ 📤 Relatório enviado!
📄 Formato: CSV
📅 Período: month
```

### 🔕 Modo Silencioso
```
"Pausar notificações por 3 dias"
→ 🔕 Modo silencioso ativado!
Notificações pausadas por 3 dias.
Para reativar, envie "ativar notificações".

"Ativar notificações"
→ 🔔 Notificações reativadas!
Você voltará a receber alertas e relatórios.
```

## 📷 Processamento de Imagens (OCR)

### 📸 Envio de Recibo
```
[Enviar foto do recibo]
→ 📷 DADOS EXTRAÍDOS DO RECIBO
💰 Valor: R$ 89,50
🏪 Estabelecimento: Supermercado ABC
📅 Data: 15/08/2024
📂 Categoria: mercado
✅ Confirma este gasto?
Responda "sim" para confirmar ou "não" para cancelar.

[Responder "sim"]
→ 💸 Despesa registrada!
💰 Valor: R$ 89,50
📂 Categoria: mercado
📝 Descrição: Supermercado ABC - R$ 89,50 - 15/08/2024
💳 Saldo atual: R$ 4.130,50
```

## 🤖 Comandos de Ajuda

### 📚 Ajuda Geral
```
"ajuda"
→ 🤖 COMANDOS DISPONÍVEIS

💰 Registrar Gastos:
• "Gastei 50 no Uber"
• "Paguei 150 na conta de luz"
• "Comprei 80 no mercado"

💵 Registrar Receitas:
• "Recebi 2500 do salário"
• "Ganhei 500 do freela"

📊 Consultas:
• "Quanto tenho agora?"
• "Resumo da semana"
• "Relatório do mês"

🎯 Metas:
• "Meta de mercado 600"
• "Meta de transporte 200"

💰 Cofrinhos:
• "Criar cofrinho viagem 2000"

📤 Exportação:
• "Exporte este mês em PDF"
• "Exporte agosto em CSV"

🔕 Configurações:
• "Pausar notificações por 3 dias"

📷 OCR:
• Envie uma foto de recibo para extração automática
```

## 🔄 Fluxo Completo de Exemplo

### 📅 Dia 1 - Configuração Inicial
```
[Primeira mensagem]
→ 🤖 BEM-VINDO AO BOT FINANCEIRO!
💰 Controle suas finanças via WhatsApp

Como usar:
• "Gastei 50 no Uber" - Registra despesa
• "Recebi 2500 do salário" - Registra receita
• "Quanto tenho agora?" - Consulta saldo
• "Resumo da semana" - Relatório

📷 Envie uma foto de recibo para extração automática!

Digite "ajuda" para ver todos os comandos.
```

### 📅 Dia 2 - Registrando Movimentações
```
"Recebi 3000 do salário"
→ 💵 Receita registrada!
💰 Valor: R$ 3.000,00
💳 Saldo atual: R$ 3.000,00

"Gastei 45 no Uber"
→ 💸 Despesa registrada!
💰 Valor: R$ 45,00
💳 Saldo atual: R$ 2.955,00

"Meta de mercado 800"
→ 🎯 Meta criada com sucesso!
📂 Categoria: mercado
💰 Limite mensal: R$ 800,00
```

### 📅 Dia 15 - Relatório e Alertas
```
"Resumo da semana"
→ 📊 RELATÓRIO WEEK
💵 Receitas: R$ 3.000,00
💸 Despesas: R$ 650,00
📂 Por Categoria:
• mercado: R$ 400,00
• transporte: R$ 250,00

[Alerta automático quando atingir 80% da meta]
→ ⚠️ ALERTA DE META!
Você já gastou 80% (R$ 640,00) da sua meta de mercado.
Meta: R$ 800,00
Restante: R$ 160,00
```

### 📅 Dia 30 - Exportação
```
"Exporte este mês em PDF"
→ 📤 Relatório enviado!
📄 Formato: PDF
📅 Período: month
[Arquivo PDF enviado]

"Quanto tenho agora?"
→ 💳 SEU SALDO ATUAL
💰 Disponível: R$ 2.350,00
```

## 🎨 Dicas de Uso

### 💡 Melhores Práticas
1. **Seja específico**: "Gastei 50 no Uber" é melhor que "50"
2. **Use categorias**: O bot detecta automaticamente categorias comuns
3. **Envie fotos**: Use OCR para recibos complexos
4. **Configure metas**: Defina limites para categorias importantes
5. **Exporte regularmente**: Mantenha backup dos seus dados

### 🔧 Personalização
- **Categorias automáticas**: mercado, transporte, contas, alimentação, etc.
- **Detecção inteligente**: Uber → transporte, Carrefour → mercado
- **Alertas personalizáveis**: 80% por padrão, configurável
- **Modo silencioso**: Pause notificações quando necessário

### 📱 Compatibilidade
- ✅ WhatsApp Web
- ✅ iOS (iPhone)
- ✅ Android
- ✅ Desktop
- ❌ Não requer app externo

### 🔐 Segurança
- **Dados criptografados**: PIN de 4 dígitos para operações sensíveis
- **Backup automático**: Dados salvos na nuvem
- **Exportação**: Sempre tenha seus dados em mãos
- **Privacidade**: Cada usuário tem sua conta isolada 