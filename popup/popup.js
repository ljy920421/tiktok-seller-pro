/**
 * TikTok Seller Pro - Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Load settings
  const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });

  // Populate settings UI
  document.getElementById('region').value = settings.region || 'US';
  document.getElementById('isNewSeller').checked = settings.isNewSeller || false;
  document.getElementById('defaultCogs').value = settings.defaultCogs || '';

  // Load profit summaries
  await loadProfitSummaries(settings.region);

  // Check if we're on TikTok Seller Center
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isOnTikTok = tab?.url?.includes('seller') && tab?.url?.includes('tiktok.com');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('statusText');

  if (!isOnTikTok) {
    statusEl.classList.add('inactive');
    statusText.textContent = 'Open TikTok Seller Center to use';
  }

  // Settings change handlers
  document.getElementById('region').addEventListener('change', saveSettings);
  document.getElementById('isNewSeller').addEventListener('change', saveSettings);
  document.getElementById('defaultCogs').addEventListener('change', saveSettings);

  // Open advanced settings
  document.getElementById('openSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});

async function saveSettings() {
  const newSettings = {
    region: document.getElementById('region').value,
    isNewSeller: document.getElementById('isNewSeller').checked,
    defaultCogs: parseFloat(document.getElementById('defaultCogs').value) || 0
  };

  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', data: newSettings });

  // Reload profit display with new region
  await loadProfitSummaries(newSettings.region);
}

async function loadProfitSummaries(region) {
  const symbols = { US: '$', UK: '£', EU: '€' };
  const sym = symbols[region] || '$';

  try {
    const today = await chrome.runtime.sendMessage({ type: 'GET_PROFIT_SUMMARY', period: 'today' });
    const week = await chrome.runtime.sendMessage({ type: 'GET_PROFIT_SUMMARY', period: 'week' });
    const month = await chrome.runtime.sendMessage({ type: 'GET_PROFIT_SUMMARY', period: 'month' });

    updateMetric('todayProfit', today.totalProfit, sym);
    document.getElementById('todayOrders').textContent = `${today.orderCount} orders`;

    updateMetric('weekProfit', week.totalProfit, sym);
    document.getElementById('weekOrders').textContent = `${week.orderCount} orders`;

    updateMetric('monthProfit', month.totalProfit, sym);
    document.getElementById('monthOrders').textContent =
      `${month.orderCount} orders · ${month.profitMargin}% margin`;
  } catch (e) {
    console.log('Failed to load profit summaries:', e);
  }
}

function updateMetric(elementId, value, symbol) {
  const el = document.getElementById(elementId);
  const sign = value < 0 ? '-' : '';
  el.textContent = `${sign}${symbol}${Math.abs(value).toFixed(2)}`;
  el.classList.remove('positive', 'negative');
  el.classList.add(value >= 0 ? 'positive' : 'negative');
}
