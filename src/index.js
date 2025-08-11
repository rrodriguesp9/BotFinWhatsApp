require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const BotController = require('./controllers/BotController');
const WhatsAppService = require('./services/WhatsAppService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares de segurança
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requests por IP
  message: {
    error: 'Muitas requisições. Tente novamente em alguns minutos.'
  }
});
app.use('/api/', limiter);

// Instanciar controlador do bot
const botController = new BotController();
const whatsappService = new WhatsAppService();

// Middleware de logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Rota de health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Rota para receber webhooks do WhatsApp
app.post('/webhook', async (req, res) => {
  try {
    const { object, entry } = req.body;

    if (object === 'whatsapp_business_account') {
      for (const webhookEntry of entry) {
        const { changes } = webhookEntry;
        
        for (const change of changes) {
          if (change.value && change.value.messages) {
            for (const message of change.value.messages) {
              const phoneNumber = message.from;
              const messageType = message.type;
              
              console.log(`📱 Nova mensagem recebida de ${phoneNumber}: ${messageType}`);

              if (messageType === 'text') {
                await botController.processMessage(phoneNumber, message.text.body);
              } else if (messageType === 'image') {
                const mediaUrl = message.image.id;
                await botController.processMessage(phoneNumber, '', mediaUrl);
              } else if (messageType === 'document') {
                const mediaUrl = message.document.id;
                await botController.processMessage(phoneNumber, '', mediaUrl);
              } else {
                console.log(`⚠️ Tipo de mensagem não suportado: ${messageType}`);
              }
            }
          }
        }
      }
    }

    res.status(200).json({ status: 'OK' });
  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Rota para verificar webhook (WhatsApp requer)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'seu_verify_token';

  if (mode && token) {
    if (mode === 'subscribe' && token === verifyToken) {
      console.log('✅ Webhook verificado com sucesso');
      res.status(200).send(challenge);
    } else {
      res.status(403).json({ error: 'Token inválido' });
    }
  } else {
    res.status(400).json({ error: 'Parâmetros inválidos' });
  }
});

// Rota para enviar mensagem manual (para testes)
app.post('/api/send-message', async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
      return res.status(400).json({
        error: 'phoneNumber e message são obrigatórios'
      });
    }

    await whatsappService.sendMessage(phoneNumber, message);
    
    res.json({
      success: true,
      message: 'Mensagem enviada com sucesso'
    });
  } catch (error) {
    console.error('❌ Erro ao enviar mensagem:', error);
    res.status(500).json({
      error: 'Erro ao enviar mensagem',
      details: error.message
    });
  }
});

// Rota para testar conexão com WhatsApp
app.get('/api/test-connection', async (req, res) => {
  try {
    const isConnected = await whatsappService.testConnection();
    
    res.json({
      success: isConnected,
      message: isConnected ? 'Conexão OK' : 'Erro na conexão'
    });
  } catch (error) {
    console.error('❌ Erro ao testar conexão:', error);
    res.status(500).json({
      error: 'Erro ao testar conexão',
      details: error.message
    });
  }
});

// Rota para obter estatísticas do bot
app.get('/api/stats', async (req, res) => {
  try {
    // Implementar estatísticas do bot
    const stats = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    };

    res.json(stats);
  } catch (error) {
    console.error('❌ Erro ao obter estatísticas:', error);
    res.status(500).json({
      error: 'Erro ao obter estatísticas',
      details: error.message
    });
  }
});

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
  console.error('❌ Erro não tratado:', error);
  res.status(500).json({
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Algo deu errado'
  });
});

// Rota 404
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Rota não encontrada',
    message: 'A rota solicitada não existe'
  });
});

// Inicializar servidor
async function startServer() {
  try {
    // Testar conexão com WhatsApp
    console.log('🔍 Testando conexão com WhatsApp...');
    const isConnected = await whatsappService.testConnection();
    
    if (!isConnected) {
      console.warn('⚠️ Aviso: Não foi possível conectar com WhatsApp API');
    } else {
      console.log('✅ Conexão com WhatsApp OK');
    }

    // Iniciar servidor
    app.listen(PORT, () => {
      console.log(`🚀 Servidor iniciado na porta ${PORT}`);
      console.log(`📱 Webhook URL: http://localhost:${PORT}/webhook`);
      console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
      console.log(`📊 Stats: http://localhost:${PORT}/api/stats`);
    });

  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

// Tratamento de sinais para graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Recebido SIGINT. Encerrando servidor...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Recebido SIGTERM. Encerrando servidor...');
  process.exit(0);
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Erro não capturado:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejeitada não tratada:', reason);
  process.exit(1);
});

// Iniciar servidor
startServer(); 