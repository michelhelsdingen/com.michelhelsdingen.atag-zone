'use strict';

// REST API endpoints voor de Ariston NET / ATAG Zone settings-pagina.
//
// Alleen de app-brede "Schrijven toestaan"-vlag. Inloggegevens staan per
// apparaat in de device store (gezet tijdens pairing), niet hier.

module.exports = {
  async getSettings({ homey }) {
    return {
      write_enabled: Boolean(homey.settings.get('write_enabled') || false),
    };
  },

  async saveSettings({ homey, body }) {
    if (body && Object.prototype.hasOwnProperty.call(body, 'write_enabled')) {
      homey.settings.set('write_enabled', Boolean(body.write_enabled));
    }
    return { success: true };
  },
};
