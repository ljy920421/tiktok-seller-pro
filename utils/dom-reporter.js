/**
 * TikTok Seller Pro - DOM Structure Reporter
 *
 * Anonymously reports successful DOM selector matches to the backend.
 * This allows crowdsourced learning of the correct DOM structure
 * across different TikTok Seller Center versions and regions.
 *
 * Privacy:
 * - Only collects DOM selector paths (CSS selectors)
 * - Never collects user data, prices, order info, or personal data
 * - Users can opt-out via extension settings
 * - Rate limited to max 1 report per page per session
 */

const DOMReporter = (function() {
  'use strict';

  // Backend API endpoint (Cloudflare Worker)
  const API_URL = 'https://tsp-dom-api.wllj980501.workers.dev';

  // Track what we've already reported this session to avoid duplicates
  const reportedPages = new Set();

  // Queue reports and batch send
  let reportQueue = [];
  let flushTimer = null;

  /**
   * Generate an anonymous session fingerprint
   * NOT a user fingerprint - just to group reports from the same session
   */
  function getSessionId() {
    let sid = sessionStorage.getItem('tsp_session_id');
    if (!sid) {
      sid = 'ses_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
      sessionStorage.setItem('tsp_session_id', sid);
    }
    return sid;
  }

  /**
   * Detect the TikTok Seller Center region from URL
   */
  function detectRegion() {
    const host = window.location.hostname;
    if (host.includes('seller-us')) return 'US';
    if (host.includes('seller-uk')) return 'UK';
    if (host.includes('seller.tiktok')) return 'GLOBAL';
    return 'UNKNOWN';
  }

  /**
   * Collect page metadata (non-personal)
   */
  function getPageMeta() {
    return {
      region: detectRegion(),
      path: window.location.pathname,
      lang: document.documentElement.lang || navigator.language,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Report a successful selector match
   *
   * @param {Object} probeResult - Result from DOMDetector.probe()
   *   { matched, selectors, method, pageType, confidence }
   */
  function report(probeResult) {
    if (!probeResult || !probeResult.matched) return;

    // Deduplicate: only report each page type once per session
    const key = probeResult.pageType + ':' + probeResult.method;
    if (reportedPages.has(key)) return;
    reportedPages.add(key);

    const payload = {
      sessionId: getSessionId(),
      page: getPageMeta(),
      probe: {
        pageType: probeResult.pageType,
        method: probeResult.method,
        selectors: probeResult.selectors,
        confidence: probeResult.confidence || 1.0,
        matchCount: probeResult.matchCount || 0
      },
      extensionVersion: (function() { try { return chrome.runtime.getManifest().version; } catch(e) { return '1.0.0'; } })()
    };

    reportQueue.push(payload);

    // Batch flush after 3 seconds
    if (!flushTimer) {
      flushTimer = setTimeout(flush, 3000);
    }
  }

  /**
   * Send queued reports to backend
   */
  async function flush() {
    flushTimer = null;
    if (reportQueue.length === 0) return;

    const batch = reportQueue.splice(0);

    try {
      const resp = await fetch(API_URL + '/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reports: batch })
      });

      if (!resp.ok) {
        console.warn('[TikTok Seller Pro] DOM report failed:', resp.status);
        // Re-queue on failure (but don't retry more than once)
      } else {
        console.log(`[TikTok Seller Pro] Reported ${batch.length} DOM structure(s)`);
      }
    } catch (e) {
      // Network error - silently ignore, this is non-critical
      console.debug('[TikTok Seller Pro] DOM report network error (non-critical)');
    }
  }

  /**
   * Fetch the latest community-validated selectors from the backend
   * Returns cached selectors or null if not available
   */
  async function fetchLatestSelectors() {
    try {
      const resp = await fetch(API_URL + '/api/selectors?region=' + detectRegion(), {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });

      if (!resp.ok) return null;

      const data = await resp.json();
      if (data && data.selectors) {
        // Cache locally for offline use
        try {
          await chrome.storage.local.set({ cachedSelectors: data.selectors, selectorsFetchedAt: Date.now() });
        } catch (e) { /* storage not available in some contexts */ }
        return data.selectors;
      }
    } catch (e) {
      // Fallback to cached version
      try {
        const cached = await chrome.storage.local.get(['cachedSelectors', 'selectorsFetchedAt']);
        if (cached.cachedSelectors) {
          // Use cache if less than 7 days old
          const age = Date.now() - (cached.selectorsFetchedAt || 0);
          if (age < 7 * 24 * 60 * 60 * 1000) {
            return cached.cachedSelectors;
          }
        }
      } catch (e2) { /* no cache available */ }
    }
    return null;
  }

  // Public API
  return {
    report,
    flush,
    fetchLatestSelectors,
    getSessionId,
    detectRegion
  };
})();

if (typeof window !== 'undefined') {
  window.DOMReporter = DOMReporter;
}
