// Configurações globais para testes
process.env.NODE_ENV = 'test';

// Mock do console para reduzir ruído nos testes
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Configurar timeout para testes
jest.setTimeout(10000);

// Mock das variáveis de ambiente
process.env.WHATSAPP_API_URL = 'https://api.whatsapp.com/v1';
process.env.WHATSAPP_TOKEN = 'test_token';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'test_phone_id';
process.env.FIREBASE_PROJECT_ID = 'test_project';
process.env.JWT_SECRET = 'test_secret';
process.env.TESSERACT_LANG = 'por'; 