/**
 * TikTok Seller Pro - Smart DOM Detector
 *
 * When predefined selectors fail, this module uses heuristics to find
 * the correct DOM elements (price cells, order rows, product rows, etc.)
 *
 * Strategy:
 * 1. Try predefined selectors first (fast path)
 * 2. If fail, use heuristic probing (smart path)
 * 3. Report successful selectors back to server for crowdsourced learning
 */

const DOMDetector = (function() {
  'use strict';

  // Price pattern: matches $12.34, £99.99, €5.00, etc.
  const PRICE_REGEX = /^[\s]*[$£€]\s*\d{1,}[,.]?\d{0,2}\s*$/;
  // Broader price pattern for content that contains prices among other text
  const PRICE_CONTAINS_REGEX = /[$£€]\s*\d{1,}[,.]?\d{0,2}/;

  /**
   * Generate a unique CSS selector path for an element
   */
  function getSelectorPath(el) {
    if (!el || el === document.body) return 'body';
    const parts = [];
    let current = el;
    while (current && current !== document.body && parts.length < 6) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector += '#' + CSS.escape(current.id);
        parts.unshift(selector);
        break;
      }
      // Use meaningful class names (skip React-generated hashes)
      const classes = Array.from(current.classList || [])
        .filter(c => !c.match(/^[a-z]{5,8}$/i) && !c.match(/^css-/) && c.length < 40)
        .slice(0, 2);
      if (classes.length) {
        selector += '.' + classes.map(c => CSS.escape(c)).join('.');
      }
      // Add nth-child if needed for uniqueness
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-child(${index})`;
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  /**
   * Find elements that look like price cells using heuristics
   */
  function findPriceElements(container) {
    container = container || document.body;
    const candidates = [];

    // Strategy 1: Find elements with text matching price patterns
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function(node) {
          // Skip our own elements
          if (node.classList && (
            node.classList.contains('tsp-profit-badge') ||
            node.classList.contains('tsp-dashboard-bar') ||
            node.classList.contains('tsp-modal-overlay')
          )) return NodeFilter.FILTER_REJECT;
          // Check leaf-ish nodes (no child elements with prices)
          const text = node.textContent.trim();
          if (text.length > 0 && text.length < 20 && PRICE_REGEX.test(text)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      candidates.push({
        element: node,
        text: node.textContent.trim(),
        selector: getSelectorPath(node),
        confidence: 0.8
      });
    }

    // Strategy 2: Look for elements with price-related class/attribute names
    const priceSelectors = [
      '[class*="price"]', '[class*="Price"]',
      '[class*="amount"]', '[class*="Amount"]',
      '[class*="total"]', '[class*="Total"]',
      '[class*="cost"]', '[class*="Cost"]',
      '[data-testid*="price"]', '[data-testid*="amount"]'
    ];

    for (const sel of priceSelectors) {
      try {
        container.querySelectorAll(sel).forEach(el => {
          if (PRICE_CONTAINS_REGEX.test(el.textContent)) {
            // Check if not already found
            if (!candidates.find(c => c.element === el)) {
              candidates.push({
                element: el,
                text: el.textContent.trim(),
                selector: getSelectorPath(el),
                confidence: 0.9
              });
            }
          }
        });
      } catch (e) { /* invalid selector, skip */ }
    }

    return candidates;
  }

  /**
   * Find elements that look like table rows containing orders
   */
  function findOrderRows(container) {
    container = container || document.body;
    const results = [];

    // Strategy 1: Standard table rows
    const tables = container.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tbody tr');
      if (rows.length > 0) {
        // Verify these rows contain prices
        let priceRowCount = 0;
        rows.forEach(row => {
          if (PRICE_CONTAINS_REGEX.test(row.textContent)) priceRowCount++;
        });
        if (priceRowCount >= rows.length * 0.5) {
          results.push({
            type: 'table',
            tableSelector: getSelectorPath(table),
            rowSelector: getSelectorPath(table) + ' > tbody > tr',
            rowCount: rows.length,
            confidence: 0.95
          });
        }
      }
    }

    // Strategy 2: List-based layouts (div-based tables)
    const listSelectors = [
      '[class*="order-list"]', '[class*="OrderList"]', '[class*="orderList"]',
      '[class*="order-table"]', '[class*="OrderTable"]',
      '[class*="list-content"]', '[class*="ListContent"]'
    ];

    for (const sel of listSelectors) {
      try {
        container.querySelectorAll(sel).forEach(listEl => {
          // Find repeated child structures that contain prices
          const children = Array.from(listEl.children);
          if (children.length >= 2) {
            let priceCount = 0;
            children.forEach(child => {
              if (PRICE_CONTAINS_REGEX.test(child.textContent)) priceCount++;
            });
            if (priceCount >= children.length * 0.5) {
              results.push({
                type: 'div-list',
                containerSelector: getSelectorPath(listEl),
                rowSelector: getSelectorPath(listEl) + ' > ' + children[0].tagName.toLowerCase(),
                rowCount: children.length,
                confidence: 0.7
              });
            }
          }
        });
      } catch (e) { /* skip */ }
    }

    return results;
  }

  /**
   * Find product rows similarly
   */
  function findProductRows(container) {
    container = container || document.body;
    const results = [];

    // Look for tables or lists with product-like content (prices + images/names)
    const tables = container.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tbody tr');
      if (rows.length > 0) {
        let hasImages = false;
        let hasPrices = false;
        rows.forEach(row => {
          if (row.querySelector('img, [class*="img"], [class*="image"], [class*="photo"]')) hasImages = true;
          if (PRICE_CONTAINS_REGEX.test(row.textContent)) hasPrices = true;
        });
        if (hasPrices) {
          results.push({
            type: 'table',
            tableSelector: getSelectorPath(table),
            rowSelector: getSelectorPath(table) + ' > tbody > tr',
            rowCount: rows.length,
            hasImages,
            confidence: hasImages ? 0.9 : 0.7
          });
        }
      }
    }

    return results;
  }

  /**
   * Auto-detect page type from URL and content
   */
  function detectPageType() {
    const url = window.location.href;
    const path = window.location.pathname;

    // URL-based detection
    if (/order/i.test(path)) return 'orderList';
    if (/product/i.test(path)) return 'productList';
    if (/homepage|dashboard|overview/i.test(path) || path === '/') return 'dashboard';

    // Content-based detection (fallback)
    const pageText = document.title + ' ' + (document.querySelector('h1, h2')?.textContent || '');
    if (/order/i.test(pageText)) return 'orderList';
    if (/product/i.test(pageText)) return 'productList';
    if (/dashboard|overview/i.test(pageText)) return 'dashboard';

    return 'unknown';
  }

  /**
   * Attempt to match with predefined selectors, fall back to heuristic detection
   * Returns: { matched: bool, selectors: {...}, method: 'predefined'|'heuristic' }
   */
  function probe(predefinedSelectors, pageType) {
    const result = {
      matched: false,
      selectors: {},
      method: 'none',
      pageType: pageType || detectPageType(),
      detectedAt: new Date().toISOString(),
      url: window.location.pathname
    };

    // Try predefined selectors first
    if (predefinedSelectors) {
      const rowSel = predefinedSelectors.row;
      const priceSel = predefinedSelectors.priceCell;
      if (rowSel && priceSel) {
        const rows = document.querySelectorAll(rowSel);
        if (rows.length > 0) {
          let priceMatches = 0;
          rows.forEach(r => {
            const p = r.querySelector(priceSel);
            if (p && PRICE_CONTAINS_REGEX.test(p.textContent)) priceMatches++;
          });
          if (priceMatches > 0) {
            result.matched = true;
            result.selectors = { ...predefinedSelectors };
            result.method = 'predefined';
            result.matchCount = priceMatches;
            return result;
          }
        }
      }
    }

    // Heuristic detection
    console.log('[TikTok Seller Pro] Predefined selectors failed, trying heuristic detection...');

    if (result.pageType === 'orderList') {
      const orderResults = findOrderRows();
      if (orderResults.length > 0) {
        const best = orderResults.sort((a, b) => b.confidence - a.confidence)[0];
        const priceEls = findPriceElements(document.querySelector(best.tableSelector || best.containerSelector));
        result.matched = true;
        result.method = 'heuristic';
        result.selectors = {
          row: best.rowSelector,
          priceCell: priceEls.length > 0 ? priceEls[0].selector : null,
          table: best.tableSelector || best.containerSelector
        };
        result.confidence = best.confidence;
      }
    } else if (result.pageType === 'productList') {
      const productResults = findProductRows();
      if (productResults.length > 0) {
        const best = productResults.sort((a, b) => b.confidence - a.confidence)[0];
        const priceEls = findPriceElements(document.querySelector(best.tableSelector || best.containerSelector));
        result.matched = true;
        result.method = 'heuristic';
        result.selectors = {
          row: best.rowSelector,
          priceCell: priceEls.length > 0 ? priceEls[0].selector : null,
          table: best.tableSelector
        };
        result.confidence = best.confidence;
      }
    }

    return result;
  }

  // Public API
  return {
    probe,
    findPriceElements,
    findOrderRows,
    findProductRows,
    detectPageType,
    getSelectorPath
  };
})();

// Export for content script
if (typeof window !== 'undefined') {
  window.DOMDetector = DOMDetector;
}
