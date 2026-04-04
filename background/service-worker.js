/**
 * TikTok Seller Pro - Background Service Worker
 * Handles storage, messaging, and extension lifecycle
 */

// Default settings
const DEFAULT_SETTINGS = {
  region: 'US',
  isNewSeller: false,
  currency: 'USD',
  cogsMap: {},        // { productId: cogsPerUnit }
  defaultCogs: 0,     // Default COGS if not set per product
  shippingCost: 0,    // Default shipping cost
  showProfitOverlay: true,
  showDashboardSummary: true,
  enableDomReport: true,  // Allow anonymous DOM structure reporting
  language: 'en'
};

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    console.log('[TikTok Seller Pro] Installed with default settings');
  }
});

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'GET_SETTINGS':
      return getSettings();

    case 'SAVE_SETTINGS':
      return saveSettings(message.data);

    case 'SET_COGS':
      return setCogs(message.productId, message.cogs);

    case 'GET_COGS':
      return getCogs(message.productId);

    case 'GET_ALL_COGS':
      return getAllCogs();

    case 'SAVE_ORDER_PROFIT':
      return saveOrderProfit(message.data);

    case 'GET_PROFIT_SUMMARY':
      return getProfitSummary(message.period);

    default:
      return { error: 'Unknown message type' };
  }
}

// Settings management
async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  return result.settings || DEFAULT_SETTINGS;
}

async function saveSettings(newSettings) {
  const current = await getSettings();
  const merged = { ...current, ...newSettings };
  await chrome.storage.local.set({ settings: merged });
  return merged;
}

// COGS management
async function setCogs(productId, cogs) {
  const settings = await getSettings();
  settings.cogsMap[productId] = parseFloat(cogs) || 0;
  await chrome.storage.local.set({ settings });
  return { success: true };
}

async function getCogs(productId) {
  const settings = await getSettings();
  return {
    cogs: settings.cogsMap[productId] ?? settings.defaultCogs
  };
}

async function getAllCogs() {
  const settings = await getSettings();
  return { cogsMap: settings.cogsMap, defaultCogs: settings.defaultCogs };
}

// Profit data storage (for dashboard summary)
async function saveOrderProfit(data) {
  const key = `profit_${data.date || getToday()}`;
  const existing = await chrome.storage.local.get(key);
  const dayData = existing[key] || { orders: [], totalRevenue: 0, totalProfit: 0, totalFees: 0 };

  dayData.orders.push({
    orderId: data.orderId,
    revenue: data.revenue,
    profit: data.profit,
    fees: data.fees,
    timestamp: Date.now()
  });
  dayData.totalRevenue += data.revenue;
  dayData.totalProfit += data.profit;
  dayData.totalFees += data.fees;

  await chrome.storage.local.set({ [key]: dayData });
  return { success: true };
}

async function getProfitSummary(period = 'today') {
  const keys = getPeriodKeys(period);
  const results = await chrome.storage.local.get(keys);

  let totalRevenue = 0;
  let totalProfit = 0;
  let totalFees = 0;
  let orderCount = 0;

  for (const key of keys) {
    const dayData = results[key];
    if (dayData) {
      totalRevenue += dayData.totalRevenue;
      totalProfit += dayData.totalProfit;
      totalFees += dayData.totalFees;
      orderCount += dayData.orders.length;
    }
  }

  const profitMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : '0.0';

  return { totalRevenue, totalProfit, totalFees, orderCount, profitMargin, period };
}

// Date helpers
function getToday() {
  return new Date().toISOString().split('T')[0];
}

function getPeriodKeys(period) {
  const today = new Date();
  const keys = [];

  if (period === 'today') {
    keys.push(`profit_${getToday()}`);
  } else if (period === 'week') {
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      keys.push(`profit_${d.toISOString().split('T')[0]}`);
    }
  } else if (period === 'month') {
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      keys.push(`profit_${d.toISOString().split('T')[0]}`);
    }
  }

  return keys;
}
