const axios = require('axios');
const FormData = require('form-data');

class WhatsAppService {
  constructor() {
    this.apiUrl = process.env.WHATSAPP_API_URL;
    this.token = process.env.WHATSAPP_TOKEN;
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    
    this.client = axios.create({
      baseURL: this.apiUrl,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      }
    });
  }

  // Enviar mensagem de texto
  async sendMessage(phoneNumber, message) {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'text',
        text: {
          body: message
        }
      };

      const response = await this.client.post(`/${this.phoneNumberId}/messages`, payload);
      
      console.log('✅ Mensagem enviada:', response.data);
      return response.data;
      
    } catch (error) {
      console.error('❌ Erro ao enviar mensagem:', error.response?.data || error.message);
      throw error;
    }
  }

  // Enviar mídia (imagem, documento, etc.)
  async sendMedia(phoneNumber, mediaBuffer, mediaType = 'document', filename = 'relatorio.pdf') {
    try {
      // Primeiro, fazer upload da mídia
      const mediaId = await this.uploadMedia(mediaBuffer, mediaType, filename);
      
      // Depois, enviar a mensagem com a mídia
      const payload = {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: mediaType,
        [mediaType]: {
          id: mediaId
        }
      };

      const response = await this.client.post(`/${this.phoneNumberId}/messages`, payload);
      
      console.log('✅ Mídia enviada:', response.data);
      return response.data;
      
    } catch (error) {
      console.error('❌ Erro ao enviar mídia:', error.response?.data || error.message);
      throw error;
    }
  }

  // Fazer upload de mídia
  async uploadMedia(mediaBuffer, mediaType, filename) {
    try {
      const formData = new FormData();
      formData.append('messaging_product', 'whatsapp');
      formData.append('file', mediaBuffer, {
        filename: filename,
        contentType: this.getContentType(mediaType)
      });

      const response = await axios.post(
        `${this.apiUrl}/${this.phoneNumberId}/media`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`,
            ...formData.getHeaders()
          }
        }
      );

      return response.data.id;
      
    } catch (error) {
      console.error('❌ Erro ao fazer upload de mídia:', error.response?.data || error.message);
      throw error;
    }
  }

  // Baixar mídia
  async downloadMedia(mediaUrl) {
    try {
      const response = await axios.get(mediaUrl, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        },
        responseType: 'arraybuffer'
      });

      return Buffer.from(response.data);
      
    } catch (error) {
      console.error('❌ Erro ao baixar mídia:', error.response?.data || error.message);
      throw error;
    }
  }

  // Enviar botões interativos
  async sendButtons(phoneNumber, message, buttons) {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: message
          },
          action: {
            buttons: buttons.map((button, index) => ({
              type: 'reply',
              reply: {
                id: `btn_${index}`,
                title: button.title
              }
            }))
          }
        }
      };

      const response = await this.client.post(`/${this.phoneNumberId}/messages`, payload);
      
      console.log('✅ Botões enviados:', response.data);
      return response.data;
      
    } catch (error) {
      console.error('❌ Erro ao enviar botões:', error.response?.data || error.message);
      throw error;
    }
  }

  // Enviar lista de opções
  async sendList(phoneNumber, message, options, buttonText = 'Ver opções') {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: {
            text: message
          },
          action: {
            button: buttonText,
            sections: [
              {
                title: 'Opções disponíveis',
                rows: options.map((option, index) => ({
                  id: `opt_${index}`,
                  title: option.title,
                  description: option.description || ''
                }))
              }
            ]
          }
        }
      };

      const response = await this.client.post(`/${this.phoneNumberId}/messages`, payload);
      
      console.log('✅ Lista enviada:', response.data);
      return response.data;
      
    } catch (error) {
      console.error('❌ Erro ao enviar lista:', error.response?.data || error.message);
      throw error;
    }
  }

  // Verificar status da mensagem
  async getMessageStatus(messageId) {
    try {
      const response = await this.client.get(`/${this.phoneNumberId}/messages/${messageId}`);
      return response.data;
      
    } catch (error) {
      console.error('❌ Erro ao verificar status:', error.response?.data || error.message);
      throw error;
    }
  }

  // Obter tipo de conteúdo baseado no tipo de mídia
  getContentType(mediaType) {
    const contentTypes = {
      'image': 'image/jpeg',
      'document': 'application/pdf',
      'audio': 'audio/mp3',
      'video': 'video/mp4'
    };

    return contentTypes[mediaType] || 'application/octet-stream';
  }

  // Validar número de telefone
  validatePhoneNumber(phoneNumber) {
    // Remover caracteres especiais
    const cleanNumber = phoneNumber.replace(/[^\d]/g, '');
    
    // Verificar se é um número brasileiro válido
    if (cleanNumber.length === 11 && cleanNumber.startsWith('55')) {
      return cleanNumber;
    }
    
    if (cleanNumber.length === 10) {
      return `55${cleanNumber}`;
    }
    
    if (cleanNumber.length === 11 && cleanNumber.startsWith('0')) {
      return `55${cleanNumber.substring(1)}`;
    }
    
    return null;
  }

  // Formatar número para exibição
  formatPhoneNumber(phoneNumber) {
    const cleanNumber = phoneNumber.replace(/[^\d]/g, '');
    
    if (cleanNumber.length === 13 && cleanNumber.startsWith('55')) {
      const ddd = cleanNumber.substring(2, 4);
      const number = cleanNumber.substring(4);
      return `+55 (${ddd}) ${number.substring(0, 5)}-${number.substring(5)}`;
    }
    
    return phoneNumber;
  }

  // Testar conexão com a API
  async testConnection() {
    try {
      const response = await this.client.get(`/${this.phoneNumberId}`);
      console.log('✅ Conexão com WhatsApp API OK');
      return true;
      
    } catch (error) {
      console.error('❌ Erro na conexão com WhatsApp API:', error.response?.data || error.message);
      return false;
    }
  }
}

module.exports = WhatsAppService; 