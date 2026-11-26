/**
 * Regolamento pubblicato come APP.
 *
 * Un messaggio inviato dal bot mostra il pallino online/offline; un webhook
 * compare come APP con il nome scelto e senza stato. Qui il regolamento viene
 * mandato da un webhook "Regolamento" nel canale delle regole, così si vede
 * esattamente come nell'esempio.
 */

const { getRulesSettings, updateRulesSettings, buildRulesEmbed } = require('../commands/regole');

const WEBHOOK_NAME = 'Regolamento';
const REASON = 'Regolamento auramen';

/** Trova (o crea) il webhook che firma il regolamento. */
async function ensureRulesWebhook(channel) {
  const hooks = await channel.fetchWebhooks();
  const existing = hooks.find(hook => hook.name === WEBHOOK_NAME && hook.channelId === channel.id);
  if (existing) return existing;
  return channel.createWebhook({
    name: WEBHOOK_NAME,
    avatar: channel.client.user.displayAvatarURL({ extension: 'png', size: 256 }),
    reason: REASON
  });
}

/**
 * Pubblica o aggiorna il regolamento tramite il webhook.
 * Restituisce { webhook, messageId, edited }.
 */
async function publishRulesAsApp(channel) {
  const guildId = channel.guild.id;
  const rules = getRulesSettings(guildId);
  const payload = { embeds: [buildRulesEmbed(rules)], allowedMentions: { parse: [] } };
  const webhook = await ensureRulesWebhook(channel);

  if (rules.messageId && rules.channelId === channel.id) {
    try {
      await webhook.editMessage(rules.messageId, payload);
      updateRulesSettings(guildId, { webhookId: webhook.id, viaWebhook: true });
      return { webhook, messageId: rules.messageId, edited: true };
    } catch {
      // Il messaggio precedente non è del webhook: si toglie e se ne invia uno nuovo.
      const old = await channel.messages.fetch(rules.messageId).catch(() => null);
      if (old && old.webhookId !== webhook.id) await old.delete().catch(() => {});
    }
  }

  const sent = await webhook.send({ ...payload, username: WEBHOOK_NAME, wait: true });
  updateRulesSettings(guildId, {
    messageId: sent.id,
    channelId: channel.id,
    webhookId: webhook.id,
    viaWebhook: true
  });
  return { webhook, messageId: sent.id, edited: false };
}

module.exports = { ensureRulesWebhook, publishRulesAsApp, WEBHOOK_NAME };
