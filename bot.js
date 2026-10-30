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

// Firebase Configuration matching the React Native App
const firebaseConfig = {
  apiKey: "AIzaSyDzUauBrOR3w6Q58PXX0S_1ceid0NBi2sU",
  authDomain: "seth-3aa05.firebaseapp.com",
  projectId: "seth-3aa05",
  storageBucket: "seth-3aa05.firebasestorage.app",
  messagingSenderId: "707626112303",
  appId: "1:707626112303:web:195deaea25ac0df07bdda",
  measurementId: "G-JQVGET5ZPZ"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
  console.log('----------------------------------------------------');
  console.log('⚠️  សូមបញ្ចូល TELEGRAM_BOT_TOKEN របស់អ្នកក្នុងឯកសារ .env');
  console.log('👉 របៀបយក Token:');
  console.log('   1. ចូល Telegram ស្វែងរក @BotFather');
  console.log('   2. វាយពាក្យ /newbot ហើយដាក់ឈ្មោះ Bot');
  console.log('   3. ចម្លង Token (ឧទាហរណ៍: 7123456789:ABCdef...) យកមកដាក់ក្នុង .env');
  console.log('----------------------------------------------------');
  process.exit(1);
}

// Start Telegram Bot in Polling Mode
const bot = new TelegramBot(token, { polling: true });
console.log('🚀 Boost & Sales Tracker Telegram Bot is RUNNING!');

// Lightweight HTTP server for Cloud Hosting Health Checks (Render / Railway / Koyeb)
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🚀 Boost & Sales Tracker Telegram Bot is Online and Running 24/7!');
}).listen(PORT, () => {
  console.log(`🌐 Cloud Health Check Server is running on port ${PORT}`);
});

// Cache sellers in memory & sync with Firestore
let cachedSellers = [];

async function loadSellersFromDb() {
  try {
    const docSnap = await getDoc(doc(db, 'metadata', 'sellers'));
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (Array.isArray(data.names)) {
        cachedSellers = data.names.map((item) => {
          if (typeof item === 'object' && item !== null) {
            return { name: item.name, role: item.role || 'seller' };
          }
          return { name: String(item), role: 'seller' };
        });
      }
    }
  } catch (err) {
    console.error('Error loading sellers:', err.message);
  }
}

// Initial load
loadSellersFromDb();

// Levenshtein distance for fuzzy Khmer typo detection
function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function normalizeKhmer(str) {
  if (!str) return '';
  return str.replace(/[\s\u200B\u200C\u200D\-_:.]+/g, '').toLowerCase();
}

/**
 * Smart Seller Matcher:
 * 1. Matches exact name ignoring spaces (e.g. "ពូពន្លក" -> "ពូ ពន្លក")
 * 2. Matches substrings/shortened names (e.g. "ពន្លក" -> "ពូ ពន្លក")
 * 3. Matches slight typos via fuzzy distance (e.g. "ពូ ពន្លុក" -> "ពូ ពន្លក")
 * 4. Falls back to registering as a new seller if not recognized
 */
async function resolveSeller(rawInputName) {
  await loadSellersFromDb();
  const trimmed = (rawInputName || '').trim();
  const normInput = normalizeKhmer(trimmed);

  if (!normInput) {
    return { resolvedName: 'ទូទៅ', role: 'seller', wasCorrected: false };
  }

  // 1. Exact match ignoring spaces and special characters
  for (const s of cachedSellers) {
    if (normalizeKhmer(s.name) === normInput) {
      const wasCorrected = s.name !== trimmed;
      return { resolvedName: s.name, role: s.role || 'seller', wasCorrected, original: trimmed };
    }
  }

  // 2. Substring match (e.g. "ពន្លក" matches "ពូ ពន្លក")
  for (const s of cachedSellers) {
    const normS = normalizeKhmer(s.name);
    if (normS.length >= 3 && normInput.length >= 3) {
      if (normS.includes(normInput) || normInput.includes(normS)) {
        return { resolvedName: s.name, role: s.role || 'seller', wasCorrected: true, original: trimmed };
      }
    }
  }

  // 3. Typo Fuzzy Match (Levenshtein distance <= 2)
  let bestMatch = null;
  let minDistance = 999;
  for (const s of cachedSellers) {
    const normS = normalizeKhmer(s.name);
    const dist = levenshteinDistance(normInput, normS);
    const threshold = normS.length >= 5 ? 2 : 1;
    if (dist <= threshold && dist < minDistance) {
      minDistance = dist;
      bestMatch = s;
    }
  }

  if (bestMatch) {
    return { resolvedName: bestMatch.name, role: bestMatch.role || 'seller', wasCorrected: true, original: trimmed };
  }

  // 4. Not matched: add to metadata/sellers as a new seller
  try {
    const newSeller = { name: trimmed, role: 'seller' };
    const updatedList = [...cachedSellers, newSeller];
    await setDoc(doc(db, 'metadata', 'sellers'), { names: updatedList }, { merge: true });
    cachedSellers = updatedList;
  } catch (e) {
    console.log('Auto-add seller notice:', e.message);
  }
  return { resolvedName: trimmed, role: 'seller', wasCorrected: false };
}

/**
 * Get next order number based on total orders count in Firestore
 */
async function getNextOrderNumber() {
  try {
    const snap = await getDocs(collection(db, 'orders'));
    return snap.size + 1;
  } catch (e) {
    return Math.floor(Math.random() * 900) + 100;
  }
}

// COMMAND: /start or /help
bot.onText(/\/(start|help)/, (msg) => {
  const chatId = msg.chat.id;
  const helpText = `👋 ជំរាបសួរ! ខ្ញុំជា Bot សម្រាប់កត់ត្រាទិន្នន័យលក់ចូលក្នុង App "Boost & Sales Tracker"។

📝 របៀបប្រើប្រាស់៖
គ្រាន់តែបោះទិន្នន័យតាមទម្រង់ធម្មតា ចូលក្នុងឆាតនេះ (ឬក្នុងគ្រុប)៖

💜ទីតាំង: ស្រុកស្វាយជ្រុំខេត្តស្វាយរៀង
💜អ្នកប្រឹក្សា: 0962501336
💜អ្នកទទួល: 0885443824
💜ចំនួន: គ្រីម 2ថែម1
💜តម្លៃ 120000
💜ដាក់តាម វិរះប៑ុនថាំ
💜អ្នកលក់: ស៊ីងអឺ
💜ថ្នាក់ដឹកនាំ: ឡា ធីតា
💜Date: 30 10/26
ពូ ពន្លក

📌 ចំណាំសំខាន់៖
- ឈ្មោះអ្នកលក់ពិតប្រាកដ គឺសរសេរនៅខាងក្រោមគេបង្អស់ (ឧ. ពូ ពន្លក)
- បើមានពាក្យ COD (ឧ. វិរះប៊ុនថាំ COD) នោះ Bot នឹងគិតជាអីវ៉ាន់ COD ($3)
- បើដឹកតាមម៉ូតូ Bot នឹងគិតតម្លៃ 2$
- App នឹងគណនាតម្លៃដើម កម្រៃអ្នកលក់ និងចំណេញសុទ្ធដោយស្វ័យប្រវត្តិ!

💡 បញ្ជាផ្សេងៗ៖
/sellers - មើលបញ្ជីឈ្មោះអ្នកលក់ និងតួនាទី
/today - មើលចំនួនកុម្ម៉ង់ប្រចាំថ្ងៃនេះ`;

  bot.sendMessage(chatId, helpText);
});

// COMMAND: /sellers
bot.onText(/\/sellers/, async (msg) => {
  const chatId = msg.chat.id;
  await loadSellersFromDb();
  if (cachedSellers.length === 0) {
    return bot.sendMessage(chatId, '📭 មិនទាន់មានឈ្មោះអ្នកលក់ក្នុងបញ្ជីនៅឡើយទេ។');
  }

  let text = '👥 បញ្ជីឈ្មោះអ្នកលក់ក្នុងប្រព័ន្ធ៖\n\n';
  cachedSellers.forEach((s, idx) => {
    const roleLabel = s.role === 'staff' ? 'បុគ្គលិក (ប្រាក់ខែគោល)' : 'អ្នកលក់ (បានកម្រៃ)';
    text += `${idx + 1}. ${s.name} - [${roleLabel}]\n`;
  });
  bot.sendMessage(chatId, text);
});

// COMMAND: /today
bot.onText(/\/today/, async (msg) => {
  const chatId = msg.chat.id;
  const today = getKhmerToday();
  try {
    const q = query(collection(db, 'orders'), where('date', '==', today));
    const snap = await getDocs(q);
    let totalRevenue = 0;
    let totalProfit = 0;
    let totalTubes = 0;

    snap.forEach((d) => {
      const data = d.data();
      totalRevenue += Number(data.price || 0);
      totalProfit += Number(data.orderProfit || 0);
      totalTubes += Number(data.tubes || 0);
    });

    const msgText = `📊 របាយការណ៍លក់ថ្ងៃនេះ (${today})៖
----------------------------------
📦 ចំនួនកុម្ម៉ង់សរុប: ${snap.size} កុម្ម៉ង់
🧪 ចំនួនទីបសរុប: ${totalTubes} ទីប
💵 ចំណូលសរុប: $${totalRevenue.toFixed(2)}
💰 ចំណេញសុទ្ធ: $${totalProfit.toFixed(2)}
----------------------------------
ទិន្នន័យបាន Sync ជាមួយ App ផ្ទាល់!`;

    bot.sendMessage(chatId, msgText);
  } catch (e) {
    bot.sendMessage(chatId, `⚠️ មិនអាចទាញទិន្នន័យបាន: ${e.message}`);
  }
});

// Pending Orders Waiting for Seller Selection (Option 1)
const pendingOrders = new Map();

// MESSAGE HANDLER: Parse template messages and present seller selection buttons
bot.on('message', async (msg) => {
  // Ignore command messages like /start
  if (!msg.text || msg.text.startsWith('/')) return;

  const text = msg.text.trim();
  // Check if message is a sales entry template
  const isTemplate = /ទីតាំង|អ្នកទទួល|ចំនួន|ដាក់តាម/i.test(text);
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

    // Always fetch fresh sellers list from Firestore (including newly added sellers from the App!)
    await loadSellersFromDb();

    if (cachedSellers.length === 0) {
      cachedSellers = [
        { name: 'ពូ ពន្លក', role: 'seller' },
        { name: 'ចែ ម៉ៅ', role: 'staff' },
      ];
    }

    // Generate unique short pending ID
    const pendingId = `p${Date.now().toString(36)}`;
    pendingOrders.set(pendingId, {
      parsed,
      sellers: [...cachedSellers],
      chatId,
      originalMsgId: msg.message_id,
      createdAt: Date.now(),
    });

    // Automatically clean up pending orders older than 30 minutes
    setTimeout(() => pendingOrders.delete(pendingId), 30 * 60 * 1000);

    // Build Inline Keyboard with 2 buttons per row
    const keyboardRows = [];
    let currentRow = [];

    cachedSellers.forEach((s, idx) => {
      const roleIcon = s.role === 'staff' ? '👔' : '💼';
      const roleText = s.role === 'staff' ? '(បុគ្គលិក)' : '';
      currentRow.push({
        text: `${roleIcon} ${s.name} ${roleText}`.trim(),
        callback_data: `pick_${pendingId}_${idx}`,
      });

      if (currentRow.length === 2) {
        keyboardRows.push(currentRow);
        currentRow = [];
      }
    });

    if (currentRow.length > 0) {
      keyboardRows.push(currentRow);
    }

    // Cancel Button
    keyboardRows.push([
      { text: '❌ បោះបង់ (Cancel)', callback_data: `cancel_${pendingId}` },
    ]);

    const deliveryTypeBadge = parsed.deliveryMethod === 'moto'
      ? `ម៉ូតូ ($${parsed.deliveryFee})`
      : parsed.companyDeliveryType === 'cod'
      ? `ក្រុមហ៊ុន COD ($${parsed.deliveryFee})`
      : `ក្រុមហ៊ុន ធម្មតា ($${parsed.deliveryFee})`;

    const previewMsg = `📦 ទទួលបានព័ត៌មានកុម្ម៉ង់!
-----------------------------------------
📞 លេខភ្ញៀវ: ${parsed.customerPhone}
📍 ទីតាំង: ${parsed.destination}, ខេត្ត${parsed.provinceKm}
🛍️ ឈុតទំនិញ: ${parsed.pkg.nameKm} ($${parsed.pkg.price})
🚚 សេវាដឹក: ${deliveryTypeBadge}
📅 កាលបរិច្ឆេទ: ${parsed.date}
-----------------------------------------
👉 សូមជ្រើសរើសឈ្មោះ «អ្នកលក់» ខាងក្រោមដើម្បីកត់ត្រាចូល App៖`;

    bot.sendMessage(chatId, previewMsg, {
      reply_to_message_id: msg.message_id,
      reply_markup: {
        inline_keyboard: keyboardRows,
      },
    });
  } catch (err) {
    console.error('Error processing order message:', err);
    bot.sendMessage(
      chatId,
      `❌ មានបញ្ហាក្នុងការកត់ត្រា៖ ${err.message}`,
      { reply_to_message_id: msg.message_id }
    );
  }
});

// CALLBACK QUERY HANDLER: Triggered when user taps a seller button
bot.on('callback_query', async (queryMsg) => {
  const data = queryMsg.data;
  if (!data) return;

  const chatId = queryMsg.message.chat.id;
  const messageId = queryMsg.message.message_id;

  // Handle Cancel
  if (data.startsWith('cancel_')) {
    const pendingId = data.replace('cancel_', '');
    pendingOrders.delete(pendingId);

    bot.answerCallbackQuery(queryMsg.id, { text: 'បានបោះបង់ការកត់ត្រា' });
    return bot.editMessageText('❌ បានបោះបង់ការកត់ត្រាកុម្ម៉ង់នេះ។', {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  // Handle Pick Seller: pick_<pendingId>_<sellerIndex>
  if (data.startsWith('pick_')) {
    const parts = data.split('_');
    const pendingId = parts[1];
    const sellerIdx = parseInt(parts[2], 10);

    const pending = pendingOrders.get(pendingId);
    if (!pending) {
      return bot.answerCallbackQuery(queryMsg.id, {
        text: 'ទិន្នន័យនេះបានកត់ត្រារួចហើយ ឬផុតកំណត់!',
        show_alert: true,
      });
    }

    const selectedSeller = pending.sellers[sellerIdx];
    if (!selectedSeller) {
      return bot.answerCallbackQuery(queryMsg.id, {
        text: 'រកមិនឃើញឈ្មោះអ្នកលក់នេះទេ!',
        show_alert: true,
      });
    }

    // Acknowledge tap
    bot.answerCallbackQuery(queryMsg.id, {
      text: `✅ បានជ្រើសរើស: ${selectedSeller.name}`,
    });

    // Remove from pending
    pendingOrders.delete(pendingId);

    try {
      const orderNumber = await getNextOrderNumber();
      const completeOrder = buildCompleteOrder({
        parsed: {
          ...pending.parsed,
          sellerName: selectedSeller.name,
        },
        orderNumber,
        sellerRole: selectedSeller.role || 'seller',
      });

      // Save directly to Firestore collection 'orders'
      await setDoc(doc(db, 'orders', completeOrder.id), completeOrder);

      const roleBadge = completeOrder.sellerRole === 'staff'
        ? 'បុគ្គលិក (កម្រៃ $0)'
        : `អ្នកលក់ (កម្រៃ: $${completeOrder.sellerCommission})`;

      const deliveryTypeBadge = completeOrder.deliveryMethod === 'moto'
        ? `ម៉ូតូ ($${completeOrder.deliveryFee})`
        : completeOrder.companyDeliveryType === 'cod'
        ? `ក្រុមហ៊ុន COD ($${completeOrder.deliveryFee})`
        : `ក្រុមហ៊ុន ធម្មតា ($${completeOrder.deliveryFee})`;

      const successMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${orderNumber})
-----------------------------------------
📞 ភ្ញៀវ: ${completeOrder.customerPhone}
📍 ទីតាំង: ${completeOrder.destination}, ខេត្ត${pending.parsed.provinceKm}
🛍️ ឈុត: ${pending.parsed.pkg.nameKm} ($${completeOrder.price})
🚚 សេវាដឹក: ${deliveryTypeBadge}
👨‍💼 អ្នកលក់: ${completeOrder.sellerName} [${roleBadge}]
💰 ចំណេញសុទ្ធ: $${completeOrder.orderProfit.toFixed(2)}
📅 កាលបរិច្ឆេទ: ${completeOrder.date}
-----------------------------------------
📲 ទិន្នន័យបានចូលទៅក្នុង App Boost & Sales Tracker រួចរាល់!`;

      // Update the message so buttons disappear and confirmation is shown
      bot.editMessageText(successMsg, {
        chat_id: chatId,
        message_id: messageId,
      });

      console.log(`[Order Saved] #${orderNumber} for seller: ${completeOrder.sellerName}, profit: $${completeOrder.orderProfit}`);
    } catch (err) {
      console.error('Error saving order from callback:', err);
      bot.editMessageText(`❌ មានបញ្ហាក្នុងការរក្សាទុក៖ ${err.message}`, {
        chat_id: chatId,
        message_id: messageId,
      });
    }
  }
});
