/**
 * TikTok Seller Pro - Cloudflare Worker Backend
 *
 * Endpoints:
 *   POST /api/report     — Receive DOM structure reports from extensions
 *   GET  /api/selectors   — Return the best-known selectors for a region
 *   GET  /api/stats       — Public stats (total reports, regions, etc.)
 *
 * Storage: Cloudflare KV (TSP_KV binding)
 *
 * Deploy:
 *   1. npm install -g wrangler
 *   2. wrangler login
 *   3. wrangler kv:namespace create "TSP_KV"
 *   4. Update wrangler.toml with KV namespace ID
 *   5. wrangler deploy
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === '/api/report' && request.method === 'POST') {
        return await handleReport(request, env, corsHeaders);
      }

      if (path === '/api/selectors' && request.method === 'GET') {
        return await handleGetSelectors(url, env, corsHeaders);
      }

      if (path === '/api/stats' && request.method === 'GET') {
        return await handleGetStats(env, corsHeaders);
      }

      return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
    } catch (e) {
      return jsonResponse({ error: 'Internal error' }, 500, corsHeaders);
    }
  }
};

/**
 * Handle DOM structure reports from extensions
 */
async function handleReport(request, env, corsHeaders) {
  const body = await request.json();

  if (!body.reports || !Array.isArray(body.reports)) {
    return jsonResponse({ error: 'Invalid payload' }, 400, corsHeaders);
  }

  // Rate limit: max 50 reports per request
  const reports = body.reports.slice(0, 50);

  for (const report of reports) {
    if (!report.probe || !report.probe.pageType || !report.probe.selectors) continue;

    const region = report.page?.region || 'UNKNOWN';
    const pageType = report.probe.pageType;
    const method = report.probe.method;
    const selectors = report.probe.selectors;

    // Key: region:pageType (e.g., "US:orderList")
    const key = `selectors:${region}:${pageType}`;

    // Get existing data for this key
    let existing = await env.TSP_KV.get(key, 'json') || {
      candidates: [],
      totalReports: 0,
      lastUpdated: null
    };

    existing.totalReports++;
    existing.lastUpdated = new Date().toISOString();

    // Find or create candidate for this selector set
    const selectorStr = JSON.stringify(selectors);
    let candidate = existing.candidates.find(c => JSON.stringify(c.selectors) === selectorStr);

    if (candidate) {
      candidate.count++;
      candidate.lastSeen = new Date().toISOString();
      candidate.confidence = Math.max(candidate.confidence, report.probe.confidence || 0);
    } else {
      existing.candidates.push({
        selectors: selectors,
        count: 1,
        method: method,
        confidence: report.probe.confidence || 0,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      });
    }

    // Keep only top 10 candidates by count
    existing.candidates.sort((a, b) => b.count - a.count);
    existing.candidates = existing.candidates.slice(0, 10);

    await env.TSP_KV.put(key, JSON.stringify(existing));

    // Update global stats
    let stats = await env.TSP_KV.get('stats:global', 'json') || { totalReports: 0, regions: {}, lastReport: null };
    stats.totalReports++;
    stats.regions[region] = (stats.regions[region] || 0) + 1;
    stats.lastReport = new Date().toISOString();
    await env.TSP_KV.put('stats:global', JSON.stringify(stats));
  }

  return jsonResponse({ ok: true, processed: reports.length }, 200, corsHeaders);
}

/**
 * Return the best selectors for a given region
 */
async function handleGetSelectors(url, env, corsHeaders) {
  const region = url.searchParams.get('region') || 'US';

  const pageTypes = ['orderList', 'productList', 'dashboard'];
  const result = {};

  for (const pageType of pageTypes) {
    const key = `selectors:${region}:${pageType}`;
    const data = await env.TSP_KV.get(key, 'json');

    if (data && data.candidates && data.candidates.length > 0) {
      // Return the most-reported selector set
      const best = data.candidates[0];
      result[pageType] = {
        selectors: best.selectors,
        confidence: best.confidence,
        reportCount: best.count,
        totalReports: data.totalReports,
        lastUpdated: data.lastUpdated
      };
    }
  }

  // Also check GLOBAL as fallback
  if (region !== 'GLOBAL') {
    for (const pageType of pageTypes) {
      if (result[pageType]) continue; // Already have region-specific
      const key = `selectors:GLOBAL:${pageType}`;
      const data = await env.TSP_KV.get(key, 'json');
      if (data && data.candidates && data.candidates.length > 0) {
        const best = data.candidates[0];
        result[pageType] = {
          selectors: best.selectors,
          confidence: best.confidence,
          reportCount: best.count,
          totalReports: data.totalReports,
          lastUpdated: data.lastUpdated,
          fallbackRegion: 'GLOBAL'
        };
      }
    }
  }

  return jsonResponse({ selectors: result, region }, 200, corsHeaders);
}

/**
 * Public stats endpoint
 */
async function handleGetStats(env, corsHeaders) {
  const stats = await env.TSP_KV.get('stats:global', 'json') || { totalReports: 0, regions: {} };
  return jsonResponse(stats, 200, corsHeaders);
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}
