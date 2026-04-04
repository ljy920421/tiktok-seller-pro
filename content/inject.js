/**
 * TikTok Seller Pro - Content Script (Main Entry)
 * Injected into TikTok Seller Center pages
 * Detects current page type and activates corresponding modules
 */

(async function TikTokSellerPro() {
  'use strict';

  // Prevent double injection
  if (window.__tiktokSellerProLoaded) return;
  window.__tiktokSellerProLoaded = true;

  console.log('[TikTok Seller Pro] Content script loaded');

  // ============================================================
  // Core: Settings & State
  // ============================================================
  let settings = {};
  let currentPage = null;

  async function loadSettings() {
    try {
      settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    } catch (e) {
      console.warn('[TikTok Seller Pro] Failed to load settings:', e);
      settings = { region: 'US', isNewSeller: false, defaultCogs: 0, cogsMap: {} };
    }
  }

  // ============================================================
  // Page Detection
  // ============================================================
  // URL patterns - TikTok Seller Center is a React SPA
  // Patterns cover known and likely URL structures
  const PAGE_PATTERNS = {
    dashboard: /\/(homepage)\b|^\/$/,
    orderList: /\/order(?:s)?(?:\/list)?(?:\?|$)/,
    orderDetail: /\/order(?:s)?\/detail/,
    productList: /\/product(?:s)?(?:\/list)?(?:\/manage)?(?:\?|$)/,
    productEdit: /\/product(?:s)?\/(?:edit|create|add)/,
    dataOverview: /\/compass\/data-overview/
  };

  function detectPage() {
    const path = window.location.pathname;
    for (const [page, pattern] of Object.entries(PAGE_PATTERNS)) {
      if (pattern.test(path)) return page;
    }
    return 'unknown';
  }

  // ============================================================
  // Fee Calculator (inline for content script context)
  // ============================================================
  const FEE_RATES = {
    US: { referralRate: 0.06, referralRateNew: 0.03, paymentFeeRate: 0.0102 },
    UK: { referralRate: 0.09, referralRateNew: 0.045, paymentFeeRate: 0.012 },
    EU: { referralRate: 0.09, referralRateNew: 0.045, paymentFeeRate: 0.012 }
  };

  function calcProfit(orderTotal, cogs = 0, region = 'US', isNew = false) {
    const rates = FEE_RATES[region] || FEE_RATES.US;
    const refRate = isNew ? rates.referralRateNew : rates.referralRate;
    const referralFee = +(orderTotal * refRate).toFixed(2);
    const paymentFee = +(orderTotal * rates.paymentFeeRate).toFixed(2);
    const totalFees = +(referralFee + paymentFee).toFixed(2);
    const netProfit = +(orderTotal - totalFees - cogs).toFixed(2);
    const margin = orderTotal > 0 ? +((netProfit / orderTotal) * 100).toFixed(1) : 0;

    return { orderTotal, referralFee, paymentFee, totalFees, cogs, netProfit, margin, isProfitable: netProfit > 0 };
  }

  // ============================================================
  // DOM Helpers
  // ============================================================

  /**
   * Wait for an element to appear in the DOM
   * TikTok Seller Center is a SPA, elements load dynamically
   */
  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver((mutations, obs) => {
        const el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`[TikTok Seller Pro] Element not found: ${selector}`));
      }, timeout);
    });
  }

  /**
   * Wait for multiple elements (e.g., table rows)
   */
  function waitForElements(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const els = document.querySelectorAll(selector);
      if (els.length > 0) return resolve(els);

      const observer = new MutationObserver((mutations, obs) => {
        const els = document.querySelectorAll(selector);
        if (els.length > 0) {
          obs.disconnect();
          resolve(els);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(document.querySelectorAll(selector)); // Return whatever we have
      }, timeout);
    });
  }

  /**
   * Create a styled element
   */
  function createElement(tag, className, textContent = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (textContent) el.textContent = textContent;
    return el;
  }

  /**
   * Parse price string to number
   * Handles formats like "$12.34", "£12.34", "€12.34", "12.34"
   */
  function parsePrice(priceStr) {
    if (!priceStr) return 0;
    const cleaned = priceStr.replace(/[^0-9.,-]/g, '').replace(',', '');
    return parseFloat(cleaned) || 0;
  }

  /**
   * Format currency amount
   */
  function formatMoney(amount, region) {
    const r = region || settings.region || 'US';
    const symbols = { US: '$', UK: '£', EU: '€' };
    const sym = symbols[r] || '$';
    const sign = amount < 0 ? '-' : '';
    return `${sign}${sym}${Math.abs(amount).toFixed(2)}`;
  }

  // ============================================================
  // Profit Badge Component
  // ============================================================

  function createProfitBadge(profitData) {
    const badge = createElement('span', 'tsp-profit-badge');
    badge.textContent = formatMoney(profitData.netProfit, settings.region);

    if (profitData.isProfitable) {
      badge.classList.add('tsp-profit-positive');
    } else {
      badge.classList.add('tsp-profit-negative');
    }

    // Tooltip with fee breakdown
    badge.title = [
      `Revenue: ${formatMoney(profitData.orderTotal)}`,
      `Referral Fee: -${formatMoney(profitData.referralFee)}`,
      `Payment Fee: -${formatMoney(profitData.paymentFee)}`,
      profitData.cogs > 0 ? `COGS: -${formatMoney(profitData.cogs)}` : null,
      `─────────`,
      `Net Profit: ${formatMoney(profitData.netProfit)}`,
      `Margin: ${profitData.margin}%`
    ].filter(Boolean).join('\n');

    // Click to show detailed breakdown
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      showFeeBreakdown(profitData);
    });

    return badge;
  }

  // ============================================================
  // Fee Breakdown Modal
  // ============================================================

  function showFeeBreakdown(profitData) {
    // Remove existing modal
    const existing = document.querySelector('.tsp-modal-overlay');
    if (existing) existing.remove();

    const overlay = createElement('div', 'tsp-modal-overlay');
    const modal = createElement('div', 'tsp-modal');

    modal.innerHTML = `
      <div class="tsp-modal-header">
        <span class="tsp-modal-title">Fee Breakdown</span>
        <span class="tsp-modal-close">&times;</span>
      </div>
      <div class="tsp-modal-body">
        <div class="tsp-fee-row">
          <span>Order Total</span>
          <span class="tsp-fee-value">${formatMoney(profitData.orderTotal)}</span>
        </div>
        <div class="tsp-fee-row tsp-fee-deduct">
          <span>Referral Fee (${((profitData.referralFee / profitData.orderTotal) * 100).toFixed(1)}%)</span>
          <span class="tsp-fee-value">-${formatMoney(profitData.referralFee)}</span>
        </div>
        <div class="tsp-fee-row tsp-fee-deduct">
          <span>Payment Processing</span>
          <span class="tsp-fee-value">-${formatMoney(profitData.paymentFee)}</span>
        </div>
        ${profitData.cogs > 0 ? `
        <div class="tsp-fee-row tsp-fee-deduct">
          <span>COGS</span>
          <span class="tsp-fee-value">-${formatMoney(profitData.cogs)}</span>
        </div>` : ''}
        <div class="tsp-fee-row tsp-fee-total ${profitData.isProfitable ? 'tsp-profit-positive' : 'tsp-profit-negative'}">
          <span><strong>Net Profit</strong></span>
          <span class="tsp-fee-value"><strong>${formatMoney(profitData.netProfit)}</strong> (${profitData.margin}%)</span>
        </div>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close handlers
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    modal.querySelector('.tsp-modal-close').addEventListener('click', () => overlay.remove());
  }

  // ============================================================
  // Page Handlers with Adaptive DOM Detection
  // ============================================================

  // Default selectors (will be overridden by community-learned selectors)
  let SELECTORS = {
    orderList: {
      table: 'table, [class*="order-list"], [class*="OrderList"]',
      row: 'tr, [class*="order-item"], [class*="OrderItem"]',
      priceCell: '[class*="price"], [class*="amount"], [class*="total"]',
      orderIdCell: '[class*="order-id"], [class*="orderId"]',
      statusCell: '[class*="status"]'
    },
    productList: {
      table: 'table, [class*="product-list"], [class*="ProductList"]',
      row: 'tr, [class*="product-item"], [class*="ProductItem"]',
      priceCell: '[class*="price"]',
      nameCell: '[class*="product-name"], [class*="ProductName"]'
    },
    dashboard: {
      metricsContainer: '[class*="metric"], [class*="dashboard"], [class*="overview"]'
    }
  };

  // Try to load community-learned selectors
  async function loadRemoteSelectors() {
    if (typeof DOMReporter === 'undefined') return;
    try {
      const remote = await DOMReporter.fetchLatestSelectors();
      if (remote) {
        for (const [pageType, data] of Object.entries(remote)) {
          if (data.selectors && data.reportCount >= 3) {
            SELECTORS[pageType] = { ...SELECTORS[pageType], ...data.selectors };
            console.log(`[TikTok Seller Pro] Loaded community selectors for ${pageType} (${data.reportCount} reports)`);
          }
        }
      }
    } catch (e) {
      console.debug('[TikTok Seller Pro] Remote selectors not available, using defaults');
    }
  }

  /**
   * Process rows with adaptive DOM detection
   * 1. Try predefined selectors
   * 2. If fail, use DOMDetector heuristics
   * 3. Report successful selectors
   */
  function processRowsAdaptive(pageType, container) {
    const selectorSet = SELECTORS[pageType];
    let rows = [];
    let priceSel = selectorSet?.priceCell;

    // Step 1: Try predefined selectors
    if (selectorSet?.row) {
      rows = Array.from((container || document).querySelectorAll(selectorSet.row))
        .filter(r => !r.closest('thead') && !r.querySelector('th')); // skip header rows
    }

    // Step 2: If predefined failed, use heuristic detection
    if (rows.length === 0 && typeof DOMDetector !== 'undefined') {
      console.log(`[TikTok Seller Pro] Predefined selectors failed for ${pageType}, trying heuristic...`);
      const probeResult = DOMDetector.probe(selectorSet, pageType);

      if (probeResult.matched) {
        console.log(`[TikTok Seller Pro] Heuristic found ${pageType} elements via ${probeResult.method}`);
        rows = Array.from(document.querySelectorAll(probeResult.selectors.row || ''));
        if (probeResult.selectors.priceCell) priceSel = probeResult.selectors.priceCell;

        // Step 3: Report successful detection
        if (typeof DOMReporter !== 'undefined' && settings.enableDomReport !== false) {
          DOMReporter.report(probeResult);
        }
      }
    } else if (rows.length > 0 && typeof DOMReporter !== 'undefined' && settings.enableDomReport !== false) {
      // Report predefined selector success too
      DOMReporter.report({
        matched: true,
        selectors: selectorSet,
        method: 'predefined',
        pageType: pageType,
        matchCount: rows.length,
        confidence: 1.0
      });
    }

    return { rows, priceSel };
  }

  /**
   * Process order list page - add profit badges to each order
   */
  async function processOrderList() {
    console.log('[TikTok Seller Pro] Processing order list page');

    try {
      // Wait for content to load
      await waitForElements('tr, [class*="order"]', 15000);

      const { rows, priceSel } = processRowsAdaptive('orderList');
      console.log(`[TikTok Seller Pro] Found ${rows.length} order rows`);

      for (const row of rows) {
        if (row.querySelector('.tsp-profit-badge')) continue;

        // Try configured price selector, then fallback to heuristic
        let priceEl = priceSel ? row.querySelector(priceSel) : null;
        if (!priceEl && typeof DOMDetector !== 'undefined') {
          const priceEls = DOMDetector.findPriceElements(row);
          if (priceEls.length > 0) priceEl = priceEls[0].element;
        }
        if (!priceEl) continue;

        const orderTotal = parsePrice(priceEl.textContent);
        if (orderTotal <= 0) continue;

        const cogs = settings.defaultCogs || 0;
        const profit = calcProfit(orderTotal, cogs, settings.region, settings.isNewSeller);
        const badge = createProfitBadge(profit);
        priceEl.parentElement.appendChild(badge);
      }
    } catch (e) {
      console.log('[TikTok Seller Pro] Order list processing:', e.message);
    }
  }

  /**
   * Process product list page - add profit margin to each product
   */
  async function processProductList() {
    console.log('[TikTok Seller Pro] Processing product list page');

    try {
      await waitForElements('tr, [class*="product"]', 15000);

      const { rows, priceSel } = processRowsAdaptive('productList');

      for (const row of rows) {
        if (row.querySelector('.tsp-profit-badge')) continue;

        let priceEl = priceSel ? row.querySelector(priceSel) : null;
        if (!priceEl && typeof DOMDetector !== 'undefined') {
          const priceEls = DOMDetector.findPriceElements(row);
          if (priceEls.length > 0) priceEl = priceEls[0].element;
        }
        if (!priceEl) continue;

        const price = parsePrice(priceEl.textContent);
        if (price <= 0) continue;

        const cogs = settings.defaultCogs || 0;
        const profit = calcProfit(price, cogs, settings.region, settings.isNewSeller);
        const badge = createProfitBadge(profit);
        priceEl.parentElement.appendChild(badge);
      }
    } catch (e) {
      console.log('[TikTok Seller Pro] Product list processing:', e.message);
    }
  }

  /**
   * Add profit summary bar to dashboard
   */
  async function processDashboard() {
    console.log('[TikTok Seller Pro] Processing dashboard page');

    if (!settings.showDashboardSummary) return;

    // Don't duplicate
    if (document.querySelector('.tsp-dashboard-bar')) return;

    try {
      // Get profit summary from storage
      const todaySummary = await chrome.runtime.sendMessage({ type: 'GET_PROFIT_SUMMARY', period: 'today' });
      const weekSummary = await chrome.runtime.sendMessage({ type: 'GET_PROFIT_SUMMARY', period: 'week' });
      const monthSummary = await chrome.runtime.sendMessage({ type: 'GET_PROFIT_SUMMARY', period: 'month' });

      // Create summary bar
      const bar = createElement('div', 'tsp-dashboard-bar');
      bar.innerHTML = `
        <div class="tsp-dashboard-title">📊 TikTok Seller Pro - Profit Summary</div>
        <div class="tsp-dashboard-metrics">
          <div class="tsp-metric">
            <div class="tsp-metric-label">Today</div>
            <div class="tsp-metric-value ${todaySummary.totalProfit >= 0 ? 'tsp-profit-positive' : 'tsp-profit-negative'}">
              ${formatMoney(todaySummary.totalProfit)}
            </div>
            <div class="tsp-metric-sub">${todaySummary.orderCount} orders · ${todaySummary.profitMargin}% margin</div>
          </div>
          <div class="tsp-metric">
            <div class="tsp-metric-label">This Week</div>
            <div class="tsp-metric-value ${weekSummary.totalProfit >= 0 ? 'tsp-profit-positive' : 'tsp-profit-negative'}">
              ${formatMoney(weekSummary.totalProfit)}
            </div>
            <div class="tsp-metric-sub">${weekSummary.orderCount} orders · ${weekSummary.profitMargin}% margin</div>
          </div>
          <div class="tsp-metric">
            <div class="tsp-metric-label">This Month</div>
            <div class="tsp-metric-value ${monthSummary.totalProfit >= 0 ? 'tsp-profit-positive' : 'tsp-profit-negative'}">
              ${formatMoney(monthSummary.totalProfit)}
            </div>
            <div class="tsp-metric-sub">${monthSummary.orderCount} orders · ${monthSummary.profitMargin}% margin</div>
          </div>
        </div>
      `;

      // Insert at top of main content area
      const mainContent = document.querySelector('main, [class*="content"], [class*="container"]');
      if (mainContent) {
        mainContent.insertBefore(bar, mainContent.firstChild);
      } else {
        document.body.insertBefore(bar, document.body.firstChild);
      }
    } catch (e) {
      console.log('[TikTok Seller Pro] Dashboard processing:', e.message);
    }
  }

  // ============================================================
  // SPA Navigation Observer
  // TikTok Seller Center is a SPA, need to re-process on route change
  // ============================================================

  let lastUrl = window.location.href;

  function setupRouteObserver() {
    // Watch for URL changes (SPA navigation)
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log('[TikTok Seller Pro] Route changed:', lastUrl);
        setTimeout(onPageChange, 500); // Delay for page render
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Also listen for popstate (browser back/forward)
    window.addEventListener('popstate', () => {
      setTimeout(onPageChange, 500);
    });
  }

  async function onPageChange() {
    currentPage = detectPage();
    console.log('[TikTok Seller Pro] Current page:', currentPage);

    switch (currentPage) {
      case 'orderList':
        await processOrderList();
        break;
      case 'productList':
        await processProductList();
        break;
      case 'dashboard':
        await processDashboard();
        break;
    }
  }

  // ============================================================
  // Initialize
  // ============================================================

  await loadSettings();
  await loadRemoteSelectors(); // Load community-learned selectors
  setupRouteObserver();
  await onPageChange();

  console.log('[TikTok Seller Pro] Initialized successfully (adaptive DOM enabled)');
})();
