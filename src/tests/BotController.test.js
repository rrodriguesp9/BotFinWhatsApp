const BotController = require('../controllers/BotController');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

// Mock dos serviços
jest.mock('../services/WhatsAppService');
jest.mock('../services/OCRService');
jest.mock('../services/ReportService');

describe('BotController', () => {
  let botController;

  beforeEach(() => {
    botController = new BotController();
  });

  describe('processTextMessage', () => {
    it('deve processar comando de gasto corretamente', async () => {
      const mockUser = {
        id: 'user123',
        phoneNumber: '5511999999999',
        isInSilentMode: () => false
      };

      const message = 'gastei 50 no uber';

      // Mock do processamento de linguagem natural
      botController.nlp.processMessage = jest.fn().mockReturnValue({
        intention: 'expense',
        extracted: {
          type: 'expense',
          amount: 50,
          category: 'transporte',
          description: 'uber',
          date: new Date()
        }
      });

      // Mock do envio de mensagem
      botController.sendMessage = jest.fn();

      await botController.processTextMessage(mockUser, message);

      expect(botController.nlp.processMessage).toHaveBeenCalledWith(message);
      expect(botController.sendMessage).toHaveBeenCalled();
    });

    it('deve processar comando de saldo corretamente', async () => {
      const mockUser = {
        id: 'user123',
        phoneNumber: '5511999999999',
        isInSilentMode: () => false
      };

      const message = 'quanto tenho agora?';

      botController.nlp.processMessage = jest.fn().mockReturnValue({
        intention: 'balance',
        extracted: {
          type: 'query',
          query: 'balance'
        }
      });

      botController.sendMessage = jest.fn();

      await botController.processTextMessage(mockUser, message);

      expect(botController.nlp.processMessage).toHaveBeenCalledWith(message);
      expect(botController.sendMessage).toHaveBeenCalled();
    });

    it('deve lidar com comando desconhecido', async () => {
      const mockUser = {
        id: 'user123',
        phoneNumber: '5511999999999',
        isInSilentMode: () => false
      };

      const message = 'comando estranho';

      botController.nlp.processMessage = jest.fn().mockReturnValue({
        intention: 'unknown',
        extracted: {}
      });

      botController.sendMessage = jest.fn();

      await botController.processTextMessage(mockUser, message);

      expect(botController.sendMessage).toHaveBeenCalledWith(
        mockUser.phoneNumber,
        expect.stringContaining('Comando não reconhecido')
      );
    });
  });

  describe('handleTransaction', () => {
    it('deve criar transação válida', async () => {
      const mockUser = {
        id: 'user123',
        phoneNumber: '5511999999999'
      };

      const transactionData = {
        type: 'expense',
        amount: 50,
        category: 'transporte',
        description: 'uber',
        date: new Date()
      };

      // Mock do Transaction.create
      Transaction.create = jest.fn().mockResolvedValue({
        id: 'transaction123',
        ...transactionData
      });

      // Mock do Transaction.getCurrentBalance
      Transaction.getCurrentBalance = jest.fn().mockResolvedValue(1000);

      // Mock do Goal.findByCategory
      Goal.findByCategory = jest.fn().mockResolvedValue(null);

      botController.sendMessage = jest.fn();

      await botController.handleTransaction(mockUser, transactionData);

      expect(Transaction.create).toHaveBeenCalledWith({
        userId: mockUser.id,
        ...transactionData
      });
      expect(botController.sendMessage).toHaveBeenCalled();
    });

    it('deve validar dados da transação', async () => {
      const mockUser = {
        id: 'user123',
        phoneNumber: '5511999999999'
      };

      const invalidTransactionData = {
        type: 'expense',
        amount: -50, // valor inválido
        category: '',
        description: 'uber',
        date: new Date()
      };

      botController.sendMessage = jest.fn();

      await botController.handleTransaction(mockUser, invalidTransactionData);

      expect(botController.sendMessage).toHaveBeenCalledWith(
        mockUser.phoneNumber,
        expect.stringContaining('Dados inválidos')
      );
    });
  });

  describe('handleBalanceQuery', () => {
    it('deve retornar saldo formatado', async () => {
      const mockUser = {
        id: 'user123',
        phoneNumber: '5511999999999'
      };

      Transaction.getCurrentBalance = jest.fn().mockResolvedValue(1500.50);
      botController.sendMessage = jest.fn();

      await botController.handleBalanceQuery(mockUser);

      expect(Transaction.getCurrentBalance).toHaveBeenCalledWith(mockUser.id);
      expect(botController.sendMessage).toHaveBeenCalledWith(
        mockUser.phoneNumber,
        expect.stringContaining('R$ 1.500,50')
      );
    });
  });

  describe('sendWelcomeMessage', () => {
    it('deve enviar mensagem de boas-vindas', async () => {
      const phoneNumber = '5511999999999';
      botController.sendMessage = jest.fn();

      await botController.sendWelcomeMessage(phoneNumber);

      expect(botController.sendMessage).toHaveBeenCalledWith(
        phoneNumber,
        expect.stringContaining('BEM-VINDO AO BOT FINANCEIRO')
      );
    });
  });

  describe('sendHelpMessage', () => {
    it('deve enviar mensagem de ajuda', async () => {
      const phoneNumber = '5511999999999';
      botController.sendMessage = jest.fn();

      await botController.sendHelpMessage(phoneNumber);

      expect(botController.sendMessage).toHaveBeenCalledWith(
        phoneNumber,
        expect.stringContaining('COMANDOS DISPONÍVEIS')
      );
    });
  });
}); 