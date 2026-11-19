require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { initializeApp, getApps } = require('firebase/app');
const {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
} = require('firebase/firestore');
const { parseOrderText, buildCompleteOrder, getKhmerToday } = require('./parser');

// ----------------------------------------------------
// Database for Shop 2: seth-shop2 (100% Dedicated & Isolated)
// ----------------------------------------------------
const firebaseConfigShop2 = {
  apiKey: "AIzaSyAjorZzIf18x1Tk_GxZLLr3AA43Au1Ydrs",
  authDomain: "seth-shop2.firebaseapp.com",
  projectId: "seth-shop2",
  storageBucket: "seth-shop2.firebasestorage.app",
  messagingSenderId: "914606007879",
  appId: "1:914606007879:web:bf1753e4b27fc9244fb362",
  measurementId: "G-5LH3415RDH"
};

const appShop2 = getApps().some((a) => a.name === 'shop2StandaloneApp')
  ? getApps().find((a) => a.name === 'shop2StandaloneApp')
  : initializeApp(firebaseConfigShop2, 'shop2StandaloneApp');
const dbShop2 = getFirestore(appShop2);

const TOKEN = process.env.TELEGRAM_BOT_TOKEN_SHOP2 || '9118979934:AAGuv8wfGqYYNdJ3zBZkioVJxydbIYy8R8E';

function sanitizeForFirestore(obj) {
  if (typeof obj === 'string') {
    const wellFormed = obj.toWellFormed ? obj.toWellFormed() : obj;
    return wellFormed.replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F]/gu, '').trim();
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore);
  }
  if (typeof obj === 'object' && obj !== null) {
    const res = {};
    for (const k of Object.keys(obj)) {
      res[k] = sanitizeForFirestore(obj[k]);
    }
    return res;
  }
  return obj;
}

function getPaymentInlineKeyboard(orderId, currentStatus) {
  const isPaid = currentStatus === 'paid';
  return [
    [
      {
        text: isPaid ? '✅ 🟢 បានទូទាត់' : '🟢 បានទូទាត់',
        callback_data: `tgpay2:${orderId}:paid`,
      },
      {
        text: !isPaid ? '✅ 🟠 មិនទាន់ទូទាត់' : '🟠 មិនទាន់ទូទាត់',
        callback_data: `tgpay2:${orderId}:unpaid`,
      },
    ],
  ];
}

const bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: { timeout: 10 },
  },
});

console.log('🤖 [Shop 2 Bot - @puseth_shop2_bot] is RUNNING on database: seth-shop2 (100% Isolated)!');

bot.on('polling_error', (err) => {
  console.log('[Shop 2 Polling notice]:', err.code || err.message);
});

bot.on('error', (err) => {
  console.log('[Shop 2 Error]:', err.message);
});

let cachedSellers = [];

async function loadSellersFromDb() {
  try {
    const docSnap = await getDoc(doc(dbShop2, 'metadata', 'sellers'));
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (Array.isArray(data.names)) {
        cachedSellers = data.names.map((item) => {
          if (typeof item === 'object' && item !== null) {
            return {
              name: item.name,
              role: item.role || 'seller',
              salary: typeof item.salary === 'number' ? item.salary : 0,
            };
          }
          return { name: String(item), role: 'seller', salary: 0 };
        });
      }
    }
  } catch (err) {
    console.error('[Shop 2] Error loading sellers:', err.message);
  }
}

loadSellersFromDb();

async function getNextOrderNumber() {
  try {
    const snap = await getDocs(collection(dbShop2, 'orders'));
    return snap.size + 1;
  } catch (e) {
    return Math.floor(Date.now() / 1000) % 10000;
  }
}

async function checkDuplicateOrder({ customerPhone, date }) {
  try {
    const q = query(
      collection(dbShop2, 'orders'),
      where('customerPhone', '==', customerPhone),
      where('date', '==', date)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      return snap.docs[0].data();
    }
    return null;
  } catch (err) {
    console.error('[Shop 2] Duplicate check error:', err.message);
    return null;
  }
}

// COMMAND: /start or /help
bot.onText(/\/start|\/help/i, (msg) => {
  const helpText = `🚀 <b>សូមស្វាគមន៍មកកាន់ Boost Tracker 2 Bot! (@puseth_shop2_bot)</b>
-----------------------------------------
📌 <b>ប្រព័ន្ធគ្រប់គ្រងការលក់សម្រាប់ Shop 2 (Database: seth-shop2)</b>

🔹 <b>របៀបប្រើប្រាស់៖</b>
គ្រាន់តែ Copy & Paste ទម្រង់សារកុម្ម៉ង់មកទីនេះ Bot នឹងកត់ត្រាចូល App 2 ដោយស្វ័យប្រវត្តិ!

🔹 <b>ពាក្យបញ្ជាបន្ថែម៖</b>
/today - មើលរបាយការណ៍លក់ប្រចាំថ្ងៃរបស់ Shop 2
/sellers - មើលបញ្ជីឈ្មោះអ្នកលក់របស់ Shop 2
/help - មើលរបៀបប្រើប្រាស់`;

  bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'HTML' });
});

// COMMAND: /sellers
bot.onText(/\/sellers(@\w+)?/i, async (msg) => {
  const chatId = msg.chat.id;
  await loadSellersFromDb();
  if (cachedSellers.length === 0) {
    return bot.sendMessage(chatId, '📭 Shop 2 មិនទាន់មានឈ្មោះអ្នកលក់ក្នុងបញ្ជីនៅឡើយទេ។ សូមបន្ថែមក្នុង App 2!');
  }

  let text = `👥 បញ្ជីឈ្មោះអ្នកលក់ (Shop 2 - seth-shop2)៖\n\n`;
  cachedSellers.forEach((s, idx) => {
    const roleLabel = s.role === 'staff' ? 'បុគ្គលិក' : 'អ្នកលក់';
    text += `${idx + 1}. ${s.name} - [${roleLabel}]\n`;
  });
  bot.sendMessage(chatId, text);
});

// COMMAND: /today
bot.onText(/\/today(@\w+)?/i, async (msg) => {
  const chatId = msg.chat.id;
  const today = getKhmerToday();
  try {
    const q = query(collection(dbShop2, 'orders'), where('date', '==', today));
    const snap = await getDocs(q);
    let totalRevenue = 0;
    let totalProfit = 0;
    let totalTubes = 0;
    let paidCount = 0;
    let paidAmount = 0;
    let unpaidCount = 0;
    let unpaidAmount = 0;

    snap.forEach((d) => {
      const data = d.data();
      const price = Number(data.price || 0);
      totalRevenue += price;
      totalProfit += Number(data.orderProfit || 0);
      totalTubes += Number(data.tubes || 0);
      if (data.paymentStatus === 'paid') {
        paidCount += 1;
        paidAmount += price;
      } else {
        unpaidCount += 1;
        unpaidAmount += price;
      }
    });

    const msgText = `📊 របាយការណ៍លក់ថ្ងៃនេះ (${today}) [Shop 2 - seth-shop2]៖
----------------------------------
📦 ចំនួនកុម្ម៉ង់សរុប: ${snap.size} កុម្ម៉ង់
🧪 ចំនួនទីបសរុប: ${totalTubes} ទីប
🟢 បានទូទាត់: ${paidCount} នាក់ ($${paidAmount.toFixed(0)})
🟠 មិនទាន់ទូទាត់: ${unpaidCount} នាក់ ($${unpaidAmount.toFixed(0)})
💵 ចំណូលសរុប: $${totalRevenue.toFixed(2)}
💰 ចំណេញសុទ្ធ: $${totalProfit.toFixed(2)}
----------------------------------
📲 ទិន្នន័យបាន Sync ជាមួយ App Boost Tracker 2!`;

    bot.sendMessage(chatId, msgText);
  } catch (e) {
    bot.sendMessage(chatId, `⚠️ មិនអាចទាញទិន្នន័យបាន: ${e.message}`);
  }
});

const pendingOrders = new Map();

// MESSAGE HANDLER
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const text = msg.text.trim();
  const isTemplate = /ទីតាំង|អ្នកទទួល|ចំនួន|ដាក់តាម|អ្នកលក់/i.test(text);
  if (!isTemplate) return;

  const chatId = msg.chat.id;

  try {
    const parsed = parseOrderText(text);
    if (!parsed || !parsed.customerPhone) {
      return bot.sendMessage(
        chatId,
        '⚠️ រកមិនឃើញលេខទូរស័ព្ទភ្ញៀវ ឬទិន្នន័យមិនត្រឹមត្រូវ។ សូមពិនិត្យទម្រង់សារឡើងវិញ!',
        { reply_to_message_id: msg.message_id }
      );
    }

    const duplicate = await checkDuplicateOrder({
      customerPhone: parsed.customerPhone,
      date: parsed.date,
    });

    if (duplicate) {
      const dupMsg = `⚠️ ការកុម្ម៉ង់នេះបានកត់ត្រារួចហើយក្នុង Shop 2 (ទិន្នន័យស្ទួន)!
-----------------------------------------
📞 លេខភ្ញៀវ: ${duplicate.customerPhone}
📍 ទីតាំង: ${duplicate.destination || 'N/A'}, ខេត្ត${parsed.provinceKm}
📅 កាលបរិច្ឆេទ: ${duplicate.date}
🔖 លេខកុម្ម៉ង់: #${duplicate.orderNumber || ''}
👨‍💼 អ្នកលក់: ${duplicate.sellerName || 'N/A'}
🛍️ ឈុត: ${duplicate.packageId ? (duplicate.tubes + ' ទីប ($' + duplicate.price + ')') : 'ឈុតទំនិញ'}
-----------------------------------------
👉 Bot បានចាប់យកទិន្នន័យតែម្តងប៉ុណ្ណោះ មិនកត់ត្រាស្ទួនឡើងវិញឡើយ!`;

      return bot.sendMessage(chatId, dupMsg, {
        reply_to_message_id: msg.message_id,
      });
    }

    await loadSellersFromDb();

    let sellerName = parsed.sellerName;
    let matchedSeller = cachedSellers.find(
      (s) => s.name && (s.name.replace(/\s+/g, '') === (sellerName || '').replace(/\s+/g, ''))
    );

    // If explicit seller in message and exists in Shop 2 sellers -> auto-record!
    if (matchedSeller) {
      const orderNumber = await getNextOrderNumber();
      const completeOrder = buildCompleteOrder({
        parsed,
        orderNumber,
        sellerRole: matchedSeller.role || 'seller',
        paymentStatus: 'unpaid',
        teamLeader: 'Shop 2',
      });
      completeOrder.sellerName = matchedSeller.name;
      completeOrder.teamLeader = 'Shop 2';

      await setDoc(doc(dbShop2, 'orders', completeOrder.id), sanitizeForFirestore(completeOrder));

      const payBadge = `🟠 មិនទាន់ទូទាត់ ($${completeOrder.price})`;
      const deliveryBadge = completeOrder.deliveryMethod === 'moto'
        ? `ម៉ូតូ ($${completeOrder.deliveryFee})`
        : `ក្រុមហ៊ុន ($${completeOrder.deliveryFee})`;

      const pkgTitle = completeOrder.packageId === 'combo_1_1'
        ? 'ឈុត ១ កំប៉ុង + ១ គ្រីម'
        : `ឈុត ${completeOrder.tubes} ទីប`;

      const successMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${orderNumber}) [Shop 2]
-----------------------------------------
📞 ភ្ញៀវ: ${completeOrder.customerPhone}
📍 ទីតាំង: ${completeOrder.destination}
🛍️ ឈុត: ${pkgTitle} ($${completeOrder.price})
🚚 សេវាដឹក: ${deliveryBadge}
👨‍💼 អ្នកលក់: ${completeOrder.sellerName}
💳 ស្ថានភាពទូទាត់: ${payBadge}
💰 ចំណេញសុទ្ធ: $${completeOrder.orderProfit.toFixed(2)}
📅 កាលបរិច្ឆេទ: ${completeOrder.date}
-----------------------------------------
📲 ទិន្នន័យបានចូលទៅក្នុង App Boost Tracker 2 រួចរាល់!
👉 ចុចប៊ូតុងខាងក្រោមដើម្បីប្ដូរស្ថានភាពទូទាត់ប្រាក់៖`;

      return bot.sendMessage(chatId, successMsg, {
        reply_to_message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: getPaymentInlineKeyboard(completeOrder.id, 'unpaid'),
        },
      });
    }

    // Otherwise, show buttons to pick seller
    const availableSellers = cachedSellers.length > 0
      ? cachedSellers
      : [{ name: 'អ្នកលក់ទូទៅ', role: 'seller' }];

    const pendingId = `p2_${Date.now().toString(36)}`;
    pendingOrders.set(pendingId, {
      parsed,
      sellers: availableSellers,
      chatId,
      originalMsgId: msg.message_id,
      createdAt: Date.now(),
    });

    setTimeout(() => pendingOrders.delete(pendingId), 30 * 60 * 1000);

    const keyboardRows = [];
    let currentRow = [];

    availableSellers.forEach((s, idx) => {
      currentRow.push({
        text: `💼 ${s.name}`,
        callback_data: `pick2_${pendingId}_${idx}`,
      });
      if (currentRow.length === 2) {
        keyboardRows.push(currentRow);
        currentRow = [];
      }
    });

    if (currentRow.length > 0) keyboardRows.push(currentRow);
    keyboardRows.push([{ text: '❌ បោះបង់ (Cancel)', callback_data: `cancel2_${pendingId}` }]);

    const previewMsg = `📦 ទទួលបានព័ត៌មានកុម្ម៉ង់! [Shop 2]
-----------------------------------------
📞 លេខភ្ញៀវ: ${parsed.customerPhone}
📍 ទីតាំង: ${parsed.destination}, ខេត្ត${parsed.provinceKm}
🛍️ ឈុត: ${parsed.pkg.tubes} ទីប ($${parsed.pkg.price})
📅 កាលបរិច្ឆេទ: ${parsed.date}
-----------------------------------------
👉 សូមជ្រើសរើសឈ្មោះ «អ្នកលក់» ខាងក្រោមដើម្បីកត់ត្រាចូល App 2៖`;

    bot.sendMessage(chatId, previewMsg, {
      reply_to_message_id: msg.message_id,
      reply_markup: { inline_keyboard: keyboardRows },
    });
  } catch (err) {
    console.error('[Shop 2] Message error:', err);
  }
});

// CALLBACK QUERY HANDLER (Buttons)
bot.on('callback_query', async (queryMsg) => {
  const data = queryMsg.data || '';
  const chatId = queryMsg.message ? queryMsg.message.chat.id : null;
  const messageId = queryMsg.message ? queryMsg.message.message_id : null;

  if (data.startsWith('cancel2_')) {
    const pendingId = data.replace('cancel2_', '');
    pendingOrders.delete(pendingId);
    bot.answerCallbackQuery(queryMsg.id, { text: 'បានបោះបង់ការកត់ត្រា!' });
    if (chatId && messageId) {
      bot.editMessageText('❌ ការកុម្ម៉ង់នេះត្រូវបានបោះបង់ចោល។', {
        chat_id: chatId,
        message_id: messageId,
      });
    }
    return;
  }

  if (data.startsWith('pick2_')) {
    const parts = data.split('_');
    const pendingId = parts[1];
    const sellerIdx = parseInt(parts[2], 10);

    const pending = pendingOrders.get(pendingId);
    if (!pending) {
      return bot.answerCallbackQuery(queryMsg.id, {
        text: 'ទិន្នន័យផុតកំណត់ ឬត្រូវបានកត់ត្រារួចហើយ!',
        show_alert: true,
      });
    }

    pendingOrders.delete(pendingId);
    const selectedSeller = pending.sellers[sellerIdx] || { name: 'ទូទៅ', role: 'seller' };

    try {
      const orderNumber = await getNextOrderNumber();
      const completeOrder = buildCompleteOrder({
        parsed: pending.parsed,
        orderNumber,
        sellerRole: selectedSeller.role || 'seller',
        paymentStatus: 'unpaid',
        teamLeader: 'Shop 2',
      });
      completeOrder.sellerName = selectedSeller.name;
      completeOrder.teamLeader = 'Shop 2';

      await setDoc(doc(dbShop2, 'orders', completeOrder.id), sanitizeForFirestore(completeOrder));

      const payBadge = `🟠 មិនទាន់ទូទាត់ ($${completeOrder.price})`;
      const deliveryBadge = completeOrder.deliveryMethod === 'moto'
        ? `ម៉ូតូ ($${completeOrder.deliveryFee})`
        : `ក្រុមហ៊ុន ($${completeOrder.deliveryFee})`;

      const pkgTitle = completeOrder.packageId === 'combo_1_1'
        ? 'ឈុត ១ កំប៉ុង + ១ គ្រីម'
        : `ឈុត ${completeOrder.tubes} ទីប`;

      const successMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${orderNumber}) [Shop 2]
-----------------------------------------
📞 ភ្ញៀវ: ${completeOrder.customerPhone}
📍 ទីតាំង: ${completeOrder.destination}
🛍️ ឈុត: ${pkgTitle} ($${completeOrder.price})
🚚 សេវាដឹក: ${deliveryBadge}
👨‍💼 អ្នកលក់: ${completeOrder.sellerName}
💳 ស្ថានភាពទូទាត់: ${payBadge}
💰 ចំណេញសុទ្ធ: $${completeOrder.orderProfit.toFixed(2)}
📅 កាលបរិច្ឆេទ: ${completeOrder.date}
-----------------------------------------
📲 ទិន្នន័យបានចូលទៅក្នុង App Boost Tracker 2 រួចរាល់!
👉 ចុចប៊ូតុងខាងក្រោមដើម្បីប្ដូរស្ថានភាពទូទាត់ប្រាក់៖`;

      bot.answerCallbackQuery(queryMsg.id, { text: `បានជ្រើសរើស ${selectedSeller.name}` });

      bot.editMessageText(successMsg, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: getPaymentInlineKeyboard(completeOrder.id, 'unpaid'),
        },
      });
    } catch (e) {
      console.error('[Shop 2] Error saving order:', e);
      bot.answerCallbackQuery(queryMsg.id, { text: `កំហុស: ${e.message}`, show_alert: true });
    }
    return;
  }

  // Payment Toggle
  if (data.startsWith('tgpay2:')) {
    const [, orderId, newStatus] = data.split(':');
    try {
      const orderRef = doc(dbShop2, 'orders', orderId);
      await setDoc(orderRef, { paymentStatus: newStatus, updatedAt: new Date().toISOString() }, { merge: true });

      const snap = await getDoc(orderRef);
      const updatedOrder = snap.data();

      bot.answerCallbackQuery(queryMsg.id, {
        text: newStatus === 'paid' ? '✅ បានប្តូរទៅជា «បានទូទាត់»' : '🟠 បានប្តូរទៅជា «មិនទាន់ទូទាត់»',
      });

      const payBadge = newStatus === 'paid'
        ? `🟢 បានទូទាត់ ($${updatedOrder.price || 0})`
        : `🟠 មិនទាន់ទូទាត់ ($${updatedOrder.price || 0})`;

      const deliveryBadge = updatedOrder.deliveryMethod === 'moto'
        ? `ម៉ូតូ ($${updatedOrder.deliveryFee || 2})`
        : `ក្រុមហ៊ុន ($${updatedOrder.deliveryFee || 2})`;

      const pkgTitle = updatedOrder.packageId === 'combo_1_1'
        ? 'ឈុត ១ កំប៉ុង + ១ គ្រីម'
        : `ឈុត ${updatedOrder.tubes || 3} ទីប`;

      const updatedSuccessMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${updatedOrder.orderNumber || ''}) [Shop 2]
-----------------------------------------
📞 ភ្ញៀវ: ${updatedOrder.customerPhone}
📍 ទីតាំង: ${updatedOrder.destination}
🛍️ ឈុត: ${pkgTitle} ($${updatedOrder.price || 0})
🚚 សេវាដឹក: ${deliveryBadge}
👨‍💼 អ្នកលក់: ${updatedOrder.sellerName}
💳 ស្ថានភាពទូទាត់: ${payBadge}
💰 ចំណេញសុទ្ធ: $${Number(updatedOrder.orderProfit || 0).toFixed(2)}
📅 កាលបរិច្ឆេទ: ${updatedOrder.date}
-----------------------------------------
📲 ទិន្នន័យបានចូលទៅក្នុង App Boost Tracker 2 រួចរាល់!
👉 ចុចប៊ូតុងខាងក្រោមដើម្បីប្ដូរស្ថានភាពទូទាត់ប្រាក់៖`;

      bot.editMessageText(updatedSuccessMsg, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: getPaymentInlineKeyboard(orderId, newStatus),
        },
      });
    } catch (e) {
      console.error('[Shop 2] Error toggling payment:', e);
      bot.answerCallbackQuery(queryMsg.id, { text: `កំហុស: ${e.message}`, show_alert: true });
    }
  }
});

module.exports = bot;
