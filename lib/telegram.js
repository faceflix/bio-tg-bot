const crypto = require('crypto');

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Telegram Login Widget-dan kelgan ma'lumotlarni tekshiradi.
 * Hujjat: https://core.telegram.org/widgets/login
 */
function verifyLoginData(data, botToken) {
  if (!data || !data.id || !data.auth_date || !data.hash) return false;

  const fields = [];
  for (const key of Object.keys(data).sort()) {
    if (key === 'hash') continue;
    if (typeof data[key] !== 'string') data[key] = String(data[key]);
    fields.push(`${key}=${data[key]}`);
  }
  const dataCheckString = fields.join('\n');

  const secret = crypto.createHash('sha256').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  if (hash !== data.hash) return false;

  // Auth 24 soatdan eski bo'lmasin
  const authAge = Math.floor(Date.now() / 1000) - Number(data.auth_date);
  if (authAge > 24 * 3600) return false;

  return true;
}

/**
 * Telegram API: /getChatMember
 * Qaytadi: { isMember: boolean, status: string | null, error: string | null }
 */
async function checkChannelMembership(botToken, channelUsername, userId) {
  const chatId = channelUsername.startsWith('@') ? channelUsername : `@${channelUsername}`;
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(userId)}`);
    const json = await res.json();
    if (!json.ok) {
      return { isMember: false, status: null, error: json.description || 'Telegram xatosi' };
    }
    const status = json.result.status;
    const allowed = ['creator', 'administrator', 'member'];
    return { isMember: allowed.includes(status), status, error: null };
  } catch (e) {
    return { isMember: false, status: null, error: 'Telegram bilan bog\'lanib bo\'lmadi: ' + e.message };
  }
}

async function getChatInfo(botToken, channelUsername) {
  const chatId = channelUsername.startsWith('@') ? channelUsername : `@${channelUsername}`;
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`);
    const json = await res.json();
    if (!json.ok) return { ok: false, error: json.description || 'Xato' };
    return { ok: true, chat: json.result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { verifyLoginData, checkChannelMembership, getChatInfo };
