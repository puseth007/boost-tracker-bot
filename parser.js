// Parser for incoming sales template in Telegram
// Matches provinces, packages, delivery, seller, customer phone, and date.

const CAMBODIA_PROVINCES = [
  { id: 'phnom_penh', km: 'ភ្នំពេញ', en: 'Phnom Penh', aliases: ['ភ្នំពេញ', 'phnom penh', 'pp'] },
  { id: 'kandal', km: 'កណ្ដាល', en: 'Kandal', aliases: ['កណ្ដាល', 'កណ្តាល', 'kandal'] },
  { id: 'kampong_cham', km: 'កំពង់ចាម', en: 'Kampong Cham', aliases: ['កំពង់ចាម', 'kampong cham'] },
  { id: 'kampong_chhnang', km: 'កំពង់ឆ្នាំង', en: 'Kampong Chhnang', aliases: ['កំពង់ឆ្នាំង', 'kampong chhnang'] },
  { id: 'kampong_speu', km: 'កំពង់ស្ពឺ', en: 'Kampong Speu', aliases: ['កំពង់ស្ពឺ', 'kampong speu'] },
  { id: 'kampong_thom', km: 'កំពង់ធំ', en: 'Kampong Thom', aliases: ['កំពង់ធំ', 'kampong thom'] },
  { id: 'kampot', km: 'កំពត', en: 'Kampot', aliases: ['កំពត', 'kampot'] },
  { id: 'koh_kong', km: 'កោះកុង', en: 'Koh Kong', aliases: ['កោះកុង', 'koh kong'] },
  { id: 'kep', km: 'កែប', en: 'Kep', aliases: ['កែប', 'kep'] },
  { id: 'kratie', km: 'ក្រចេះ', en: 'Kratie', aliases: ['ក្រចេះ', 'kratie'] },
  { id: 'takeo', km: 'តាកែវ', en: 'Takeo', aliases: ['តាកែវ', 'takeo'] },
  { id: 'tboung_khmum', km: 'ត្បូងឃ្មុំ', en: 'Tboung Khmum', aliases: ['ត្បូងឃ្មុំ', 'tboung khmum'] },
  { id: 'battambang', km: 'បាត់ដំបង', en: 'Battambang', aliases: ['បាត់ដំបង', 'battambang'] },
  { id: 'banteay_meanchey', km: 'បន្ទាយមានជ័យ', en: 'Banteay Meanchey', aliases: ['បន្ទាយមានជ័យ', 'banteay meanchey'] },
  { id: 'pailin', km: 'ប៉ៃលិន', en: 'Pailin', aliases: ['ប៉ៃលិន', 'pailin'] },
  { id: 'pursat', km: 'ពោធិ៍សាត់', en: 'Pursat', aliases: ['ពោធិ៍សាត់', 'pursat'] },
  { id: 'preah_vihear', km: 'ព្រះវិហារ', en: 'Preah Vihear', aliases: ['ព្រះវិហារ', 'preah vihear'] },
  { id: 'preah_sihanouk', km: 'ព្រះសីហនុ', en: 'Preah Sihanouk', aliases: ['ព្រះសីហនុ', 'កំពង់សោម', 'sihanoukville', 'preah sihanouk'] },
  { id: 'prey_veng', km: 'ព្រៃវែង', en: 'Prey Veng', aliases: ['ព្រៃវែង', 'prey veng'] },
  { id: 'mondulkiri', km: 'មណ្ឌលគិរី', en: 'Mondulkiri', aliases: ['មណ្ឌលគិរី', 'mondulkiri'] },
  { id: 'ratanakiri', km: 'រតនគិរី', en: 'Ratanakiri', aliases: ['រតនគិរី', 'ratanakiri'] },
  { id: 'siem_reap', km: 'សៀមរាប', en: 'Siem Reap', aliases: ['សៀមរាប', 'siem reap'] },
  { id: 'stung_treng', km: 'ស្ទឹងត្រែង', en: 'Stung Treng', aliases: ['ស្ទឹងត្រែង', 'stung treng'] },
  { id: 'svay_rieng', km: 'ស្វាយរៀង', en: 'Svay Rieng', aliases: ['ស្វាយរៀង', 'svay rieng'] },
  { id: 'oddar_meanchey', km: 'ឧត្តរមានជ័យ', en: 'Oddar Meanchey', aliases: ['ឧត្តរមានជ័យ', 'oddar meanchey'] },
];

const PACKAGES = [
  { id: 'set_1', tubes: 1, nameKm: 'ឈុត ១ ទីប', price: 17 },
  { id: 'set_3', tubes: 3, nameKm: 'ឈុត ៣ ទីប (២ ថែម ១)', price: 30 },
  { id: 'set_6', tubes: 6, nameKm: 'ឈុត ៦ ទីប (៣ ថែម ៣)', price: 50 },
  { id: 'set_10', tubes: 10, nameKm: 'ឈុត ១០ ទីប (៥ ថែម ៥)', price: 70 },
];

const SELLER_COMMISSION_RATES = {
  standard: { set_1: 1.0, set_3: 2.0, set_6: 3.0, set_10: 5.0 },
  cod: { set_1: 0.7, set_3: 1.5, set_6: 2.5, set_10: 4.5 },
};

function getKhmerToday() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Phnom_Penh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date()); // YYYY-MM-DD
}

// Convert Khmer digits to Arabic digits: ០-៩ -> 0-9
function normalizeKhmerDigits(str) {
  if (!str) return '';
  const khmerNums = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩'];
  let res = str;
  khmerNums.forEach((k, idx) => {
    res = res.split(k).join(idx.toString());
  });
  return res;
}

// Parse Date string into YYYY-MM-DD
// Supports "30 10/26", "30/10/26", "30-10-2026", "2026-10-30"
function parseKhmerDate(rawStr) {
  if (!rawStr) return getKhmerToday();
  const cleaned = normalizeKhmerDigits(rawStr.trim());

  // Matches 30 10/26 or 30/10/26 or 30-10-26 or 30 10 2026
  const partsMatch = cleaned.match(/(\d{1,2})[\s\/\-\.]+(\d{1,2})[\s\/\-\.]+(\d{2,4})/);
  if (partsMatch) {
    const day = partsMatch[1].padStart(2, '0');
    const month = partsMatch[2].padStart(2, '0');
    let year = partsMatch[3];
    if (year.length === 2) {
      year = '20' + year;
    }
    return `${year}-${month}-${day}`;
  }

  // Matches ISO 2026-10-30
  const isoMatch = cleaned.match(/(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  return getKhmerToday();
}

/**
 * Main parser function
 * Takes raw text from Telegram message and extracts all order fields.
 */
function parseOrderText(text) {
  if (!text || typeof text !== 'string') return null;

  const rawLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (rawLines.length === 0) return null;

  let locationText = '';
  let customerPhone = '';
  let packageRaw = '';
  let deliveryRaw = '';
  let dateRaw = '';
  let rawDateLineIndex = -1;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // Location: 💜ទីតាំង: or ទីតាំង:
    if (/ទីតាំង/i.test(line)) {
      locationText = line.replace(/^[💜\*\-\s]*ទីតាំង\s*[:៖]?\s*/i, '').trim();
    }
    // Customer phone: 💜អ្នកទទួល : or អ្នកទទួល:
    else if (/អ្នកទទួល/i.test(line)) {
      const match = line.match(/(0\d{8,9})/);
      if (match) {
        customerPhone = match[1];
      } else {
        customerPhone = line.replace(/^[💜\*\-\s]*អ្នកទទួល\s*[:៖]?\s*/i, '').trim();
      }
    }
    // Quantity / Package: 💜ចំនួន:
    else if (/ចំនួន/i.test(line)) {
      packageRaw = line.replace(/^[💜\*\-\s]*ចំនួន\s*[:៖]?\s*/i, '').trim();
    }
    // Delivery: 💜ដាក់តាម
    else if (/ដាក់តាម|ដឹកជញ្ជូន/i.test(line)) {
      deliveryRaw = line.replace(/^[💜\*\-\s]*(ដាក់តាម|ដឹកជញ្ជូន)\s*[:៖]?\s*/i, '').trim();
    }
    // Date: 💜Date: or Date: or កាលបរិច្ឆេទ
    else if (/Date|កាលបរិច្ឆេទ/i.test(line)) {
      dateRaw = line.replace(/^[💜\*\-\s]*(Date|កាលបរិច្ឆេទ)\s*[:៖]?\s*/i, '').trim();
      rawDateLineIndex = i;
    }
  }

  // If customerPhone is not found under 'អ្នកទទួល', find first phone that is NOT adviser phone
  if (!customerPhone) {
    for (const line of rawLines) {
      if (!/អ្នកប្រឹក្សា/i.test(line)) {
        const phoneMatch = line.match(/\b(0\d{8,9})\b/);
        if (phoneMatch) {
          customerPhone = phoneMatch[1];
          break;
        }
      }
    }
  }

  // Real Seller Name:
  // Written at the bottom (after the Date line or last non-empty line)
  let sellerName = '';
  if (rawDateLineIndex !== -1 && rawDateLineIndex < rawLines.length - 1) {
    // Take lines after Date:
    const remaining = rawLines.slice(rawDateLineIndex + 1).filter((l) => {
      // Exclude emoji-only or divider lines
      return !l.startsWith('💜') && !l.startsWith('---') && l.trim().length > 0;
    });
    if (remaining.length > 0) {
      sellerName = remaining[remaining.length - 1].trim();
    }
  }

  // Fallback: Check the very last line if sellerName is still empty
  if (!sellerName && rawLines.length > 0) {
    const lastLine = rawLines[rawLines.length - 1];
    if (!lastLine.startsWith('💜') && !/Date|តម្លៃ|ចំនួន|ទីតាំង/i.test(lastLine)) {
      sellerName = lastLine.trim();
    }
  }

  // Strip prefixes like 'ឈ្មោះ:' or '-'
  sellerName = sellerName.replace(/^(ឈ្មោះ|អ្នកលក់|Seller)\s*[:៖]?\s*/i, '').trim();
  if (!sellerName) {
    sellerName = 'ទូទៅ'; // Default fallback seller
  }

  // Match Province
  let provinceId = 'phnom_penh';
  let matchedProv = null;
  for (const prov of CAMBODIA_PROVINCES) {
    for (const alias of prov.aliases) {
      if (locationText.includes(alias) || text.includes(alias)) {
        provinceId = prov.id;
        matchedProv = prov;
        break;
      }
    }
    if (matchedProv) break;
  }

  // Destination detail (clean province name from location text)
  let destination = locationText;
  if (matchedProv) {
    destination = destination
      .replace(new RegExp(`ខេត្ត${matchedProv.km}`, 'g'), '')
      .replace(new RegExp(`រាជធានី${matchedProv.km}`, 'g'), '')
      .replace(new RegExp(matchedProv.km, 'g'), '')
      .replace(/^[\s,]+|[\s,]+$/g, '')
      .trim();
    if (!destination) {
      destination = matchedProv.km;
    }
  }

  // Match Package
  const normPkg = normalizeKhmerDigits(packageRaw).toLowerCase();
  let selectedPkg = PACKAGES[1]; // Default to set_3 (2+1)
  if (normPkg.includes('10') || normPkg.includes('5+5') || normPkg.includes('5ថែម5')) {
    selectedPkg = PACKAGES[3]; // set_10
  } else if (normPkg.includes('6') || normPkg.includes('3+3') || normPkg.includes('3ថែម3')) {
    selectedPkg = PACKAGES[2]; // set_6
  } else if (normPkg.includes('2+1') || normPkg.includes('2ថែម1') || normPkg.includes('3') || normPkg.includes('៣')) {
    selectedPkg = PACKAGES[1]; // set_3
  } else if (normPkg.includes('1') || normPkg.includes('១')) {
    selectedPkg = PACKAGES[0]; // set_1
  }

  // Delivery Method & COD
  let deliveryMethod = 'company';
  let companyDeliveryType = 'standard';
  let deliveryFee = 2; // Default company standard is $2

  const normDelivery = deliveryRaw.toLowerCase() + ' ' + text.toLowerCase();
  const isMoto = normDelivery.includes('ម៉ូតូ') || normDelivery.includes('ដឹកម៉ូតូ') || normDelivery.includes('moto');
  const isCod = normDelivery.includes('cod') || normDelivery.includes('ស៊ីអូឌី');

  if (isMoto) {
    deliveryMethod = 'moto';
    companyDeliveryType = 'standard';
    deliveryFee = 2.0; // Per user rule: Default $2 for moto
  } else {
    deliveryMethod = 'company';
    if (isCod) {
      companyDeliveryType = 'cod';
      deliveryFee = 3.0; // Company COD is $3
    } else {
      companyDeliveryType = 'standard';
      deliveryFee = 2.0; // Company standard is $2
    }
  }

  // Parse Date
  const date = parseKhmerDate(dateRaw);

  // Parse Payment Status: Check if customer paid via ABA, transfer, etc.
  let paymentStatus = 'unpaid';
  const normText = text.toLowerCase();
  if (/វេររួច|បង់រួច|ផ្ទេររួច|បានបង់|បានវេរ|paid|aba|acleda|wing|វេរប្រាក់រួច|បង់ប្រាក់រួច|ទូទាត់រួច/i.test(normText)) {
    paymentStatus = 'paid';
  } else if (/cod|ស៊ីអូឌី/i.test(normText)) {
    paymentStatus = 'unpaid';
  }

  return {
    customerPhone,
    provinceId,
    provinceKm: matchedProv ? matchedProv.km : 'ភ្នំពេញ',
    destination,
    packageId: selectedPkg.id,
    pkg: selectedPkg,
    deliveryMethod,
    companyDeliveryType,
    deliveryFee,
    sellerName,
    date,
    paymentStatus,
    rawText: text,
  };
}

/**
 * Calculates profit and complete order object
 */
function buildCompleteOrder({
  parsed,
  orderNumber,
  sellerRole = 'seller', // 'seller' | 'staff'
  paymentStatus = null,
}) {
  const { pkg, deliveryMethod, companyDeliveryType, deliveryFee, sellerName, provinceId, destination, customerPhone, date } = parsed;

  const isCod = deliveryMethod === 'company' && companyDeliveryType === 'cod';
  const table = isCod ? SELLER_COMMISSION_RATES.cod : SELLER_COMMISSION_RATES.standard;
  const sellerCommission = sellerRole === 'staff' ? 0 : (table[pkg.id] || 0);

  const productCost = pkg.tubes * 3.5;
  const orderProfit = pkg.price - deliveryFee - productCost - sellerCommission;

  const timestamp = Date.now();
  const id = `ord_${timestamp}_${Math.random().toString(36).substring(2, 6)}`;

  return {
    id,
    orderNumber,
    customerPhone: customerPhone || 'N/A',
    sellerName: sellerName.trim(),
    sellerRole,
    sellerCommission,
    productCost,
    orderProfit,
    provinceId,
    destination: destination || 'N/A',
    packageId: pkg.id,
    tubes: pkg.tubes,
    price: pkg.price,
    deliveryMethod,
    companyDeliveryType,
    deliveryFee,
    date,
    paymentStatus: paymentStatus || parsed.paymentStatus || 'unpaid',
    note: 'បញ្ចូលតាមរយៈ Telegram Chatbot',
    createdBy: 'Telegram Bot',
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  CAMBODIA_PROVINCES,
  PACKAGES,
  parseOrderText,
  buildCompleteOrder,
  getKhmerToday,
};
