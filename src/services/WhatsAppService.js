const axios = require('axios');
const FormData = require('form-data');

class WhatsAppService {
  constructor() {
    const baseUrl = (process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com/').replace(/\/$/, '');
    const version = process.env.WHATSAPP_API_VERSION || 'v23.0';
    this.apiUrl = `${baseUrl}/${version}`;
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
          id: mediaId,
          ...(mediaType === 'document' && filename ? { filename } : {})
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
        contentType: this.getContentType(mediaType, filename)
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

  // Baixar mídia pelo media ID (Graph API exige 2 etapas: buscar URL, depois baixar)
  async downloadMedia(mediaId) {
    try {
      console.log(`📥 Baixando mídia ID: ${mediaId}`);

      // Etapa 1: obter a URL real do arquivo a partir do media ID (timeout 15s)
      const metaResponse = await this.client.get(`/${mediaId}`, { timeout: 15000 });
      const mediaUrl = metaResponse.data.url;

      if (!mediaUrl) {
        throw new Error('URL da mídia não retornada pela API do WhatsApp');
      }
      console.log(`📥 URL da mídia obtida (${mediaUrl.substring(0, 50)}...)`);

      // Etapa 2: baixar o arquivo usando a URL retornada (timeout 60s para arquivos grandes)
      const response = await axios.get(mediaUrl, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        },
        responseType: 'arraybuffer',
        timeout: 60000
      });

      const buffer = Buffer.from(response.data);
      console.log(`📥 Mídia baixada: ${buffer.length} bytes`);
      return buffer;

    } catch (error) {
      const errorDetail = error.response?.data
        ? (typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : error.response.data.toString().substring(0, 200))
        : error.message;
      console.error('❌ Erro ao baixar mídia:', errorDetail);
      throw new Error(`Falha ao baixar mídia: ${error.message}`);
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
  getContentType(mediaType, filename) {
    // Se temos filename, detectar pelo extensão
    if (filename) {
      const ext = filename.split('.').pop().toLowerCase();
      const extMap = {
        'pdf': 'application/pdf',
        'csv': 'text/csv',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'xls': 'application/vnd.ms-excel',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'mp3': 'audio/mp3',
        'ogg': 'audio/ogg',
        'mp4': 'video/mp4'
      };
      if (extMap[ext]) return extMap[ext];
    }

    const contentTypes = {
      'image': 'image/jpeg',
      'document': 'application/pdf',
      'audio': 'audio/mp3',
      'video': 'video/mp4'
    };

    return contentTypes[mediaType] || 'application/octet-stream';
  }

  // Validar número de telefone brasileiro
  validatePhoneNumber(phoneNumber) {
    const clean = phoneNumber.replace(/[^\d]/g, '');

    // Formato internacional: 55 + DDD(2) + número(8-9) = 12 ou 13 dígitos
    if ((clean.length === 12 || clean.length === 13) && clean.startsWith('55')) {
      return clean;
    }

    // Local sem código país: DDD(2) + número(8-9) = 10 ou 11 dígitos
    if (clean.length === 10 || clean.length === 11) {
      return `55${clean}`;
    }

    // Com zero na frente: 0XX XXXXX-XXXX
    if ((clean.length === 11 || clean.length === 12) && clean.startsWith('0')) {
      return `55${clean.substring(1)}`;
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