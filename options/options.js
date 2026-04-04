/**
 * TikTok Seller Pro - Options Page Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
});

async function loadSettings() {
  const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });

  document.getElementById('region').value = settings.region || 'US';
  document.getElementById('isNewSeller').checked = settings.isNewSeller || false;
  document.getElementById('shippingCost').value = settings.shippingCost || '';
  document.getElementById('showProfitOverlay').checked = settings.showProfitOverlay !== false;
  document.getElementById('showDashboardSummary').checked = settings.showDashboardSummary !== false;
  document.getElementById('defaultCogs').value = settings.defaultCogs || '';
  document.getElementById('enableDomReport').checked = settings.enableDomReport !== false;

  renderCogsTable(settings.cogsMap || {});
}

function setupEventListeners() {
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('resetBtn').addEventListener('click', resetSettings);
  document.getElementById('addCogs').addEventListener('click', addCogsEntry);

  // Enter key on COGS input
  document.getElementById('newCogsCost').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addCogsEntry();
  });
}

async function saveSettings() {
  const cogsMap = collectCogsFromTable();

  const newSettings = {
    region: document.getElementById('region').value,
    isNewSeller: document.getElementById('isNewSeller').checked,
    shippingCost: parseFloat(document.getElementById('shippingCost').value) || 0,
    showProfitOverlay: document.getElementById('showProfitOverlay').checked,
    showDashboardSummary: document.getElementById('showDashboardSummary').checked,
    enableDomReport: document.getElementById('enableDomReport').checked,
    defaultCogs: parseFloat(document.getElementById('defaultCogs').value) || 0,
    cogsMap
  };

  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', data: newSettings });
  showSaveStatus();
}

async function resetSettings() {
  if (!confirm('Reset all settings to defaults?')) return;

  await chrome.runtime.sendMessage({
    type: 'SAVE_SETTINGS',
    data: {
      region: 'US',
      isNewSeller: false,
      shippingCost: 0,
      showProfitOverlay: true,
      showDashboardSummary: true,
      enableDomReport: true,
      defaultCogs: 0,
      cogsMap: {}
    }
  });

  await loadSettings();
  showSaveStatus();
}

// COGS Table Management
function renderCogsTable(cogsMap) {
  const tbody = document.getElementById('cogsTableBody');
  tbody.innerHTML = '';

  for (const [productId, cost] of Object.entries(cogsMap)) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(productId)}</td>
      <td><input type="number" min="0" step="0.01" value="${cost}" data-product-id="${escapeHtml(productId)}" class="cogs-input"></td>
      <td><button class="btn btn-danger cogs-delete" data-product-id="${escapeHtml(productId)}">Remove</button></td>
    `;
    tbody.appendChild(row);
  }

  // Add delete handlers
  tbody.querySelectorAll('.cogs-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('tr').remove();
    });
  });

  if (Object.keys(cogsMap).length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="3" style="text-align:center;color:#999;font-size:13px;">No product-specific COGS set. Default COGS will be used.</td>';
    tbody.appendChild(row);
  }
}

function addCogsEntry() {
  const idInput = document.getElementById('newCogsId');
  const costInput = document.getElementById('newCogsCost');

  const productId = idInput.value.trim();
  const cost = parseFloat(costInput.value);

  if (!productId) { idInput.focus(); return; }
  if (isNaN(cost) || cost < 0) { costInput.focus(); return; }

  const tbody = document.getElementById('cogsTableBody');

  // Remove "no data" row if present
  const noDataRow = tbody.querySelector('td[colspan]');
  if (noDataRow) noDataRow.closest('tr').remove();

  const row = document.createElement('tr');
  row.innerHTML = `
    <td>${escapeHtml(productId)}</td>
    <td><input type="number" min="0" step="0.01" value="${cost}" data-product-id="${escapeHtml(productId)}" class="cogs-input"></td>
    <td><button class="btn btn-danger cogs-delete" data-product-id="${escapeHtml(productId)}">Remove</button></td>
  `;
  tbody.appendChild(row);

  row.querySelector('.cogs-delete').addEventListener('click', () => row.remove());

  idInput.value = '';
  costInput.value = '';
  idInput.focus();
}

function collectCogsFromTable() {
  const cogsMap = {};
  document.querySelectorAll('.cogs-input').forEach(input => {
    const productId = input.dataset.productId;
    const cost = parseFloat(input.value);
    if (productId && !isNaN(cost)) {
      cogsMap[productId] = cost;
    }
  });
  return cogsMap;
}

function showSaveStatus() {
  const el = document.getElementById('saveStatus');
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
