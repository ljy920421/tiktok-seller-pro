/**
 * TikTok Shop Fee Calculator
 * Based on 2026 fee structure for US/UK/EU markets
 * Reference: https://seller-us.tiktok.com/university/essay?knowledge_id=6747273381791534
 */

const FeeCalculator = (() => {
  // Fee rates by region (2026)
  const FEE_RATES = {
    US: {
      referralRate: 0.06,        // 6% standard referral fee
      referralRateNew: 0.03,     // 3% for first 30 days
      paymentFeeRate: 0.0102,    // 1.02% payment processing
      refundAdminRate: 0.20,     // 20% of referral fee on refunds
      refundAdminCap: 5.00,      // $5 cap per SKU
    },
    UK: {
      referralRate: 0.09,        // 9% since Sep 2024
      referralRateNew: 0.045,    // 50% discount for new sellers
      paymentFeeRate: 0.012,     // ~1.2%
      refundAdminRate: 0.20,
      refundAdminCap: 4.00,      // £4 cap
    },
    EU: {
      referralRate: 0.09,        // 9% since Jan 2026
      referralRateNew: 0.045,
      paymentFeeRate: 0.012,
      refundAdminRate: 0.20,
      refundAdminCap: 5.00,      // €5 cap
    }
  };

  // FBT (Fulfilled by TikTok) shipping rates - US 2026
  const FBT_RATES_US = [
    { maxWeight: 0.5, rate1: 3.58, rate2: 3.22, rate3: 3.00, rate4plus: 2.86 },
    { maxWeight: 1.0, rate1: 4.15, rate2: 3.74, rate3: 3.48, rate4plus: 3.32 },
    { maxWeight: 2.0, rate1: 5.20, rate2: 4.68, rate3: 4.36, rate4plus: 4.16 },
    { maxWeight: 5.0, rate1: 6.80, rate2: 6.12, rate3: 5.70, rate4plus: 5.44 },
    { maxWeight: 10.0, rate1: 9.50, rate2: 8.55, rate3: 7.96, rate4plus: 7.60 },
    { maxWeight: 20.0, rate1: 13.00, rate2: 11.70, rate3: 10.92, rate4plus: 10.40 },
  ];

  /**
   * Calculate all fees for an order
   * @param {Object} params
   * @param {number} params.itemPrice - Item price (before tax/shipping)
   * @param {number} params.quantity - Number of items
   * @param {number} params.cogs - Cost of goods sold per unit
   * @param {number} params.shippingCost - Shipping cost (0 if FBT)
   * @param {number} params.adSpend - Advertising cost allocated to this order
   * @param {string} params.region - 'US', 'UK', or 'EU'
   * @param {boolean} params.isNewSeller - Whether seller is in first 30 days
   * @param {number} params.affiliateRate - Affiliate/creator commission rate (0-1)
   * @param {number} params.platformDiscount - Platform discount amount
   * @returns {Object} Detailed fee breakdown and profit
   */
  function calculate(params) {
    const {
      itemPrice = 0,
      quantity = 1,
      cogs = 0,
      shippingCost = 0,
      adSpend = 0,
      region = 'US',
      isNewSeller = false,
      affiliateRate = 0,
      platformDiscount = 0
    } = params;

    const rates = FEE_RATES[region] || FEE_RATES.US;
    const totalRevenue = itemPrice * quantity;
    const taxableAmount = totalRevenue + platformDiscount; // Fee base

    // 1. Referral fee
    const referralRate = isNewSeller ? rates.referralRateNew : rates.referralRate;
    const referralFee = round(taxableAmount * referralRate);

    // 2. Payment processing fee
    const paymentFee = round(totalRevenue * rates.paymentFeeRate);

    // 3. Affiliate commission
    const affiliateFee = round(totalRevenue * affiliateRate);

    // 4. COGS
    const totalCogs = round(cogs * quantity);

    // 5. Total fees
    const totalFees = round(referralFee + paymentFee + affiliateFee + shippingCost + adSpend);

    // 6. Net profit
    const netProfit = round(totalRevenue - totalFees - totalCogs);

    // 7. Profit margin
    const profitMargin = totalRevenue > 0 ? round((netProfit / totalRevenue) * 100, 1) : 0;

    return {
      // Revenue
      totalRevenue,
      itemPrice,
      quantity,

      // Fees breakdown
      referralFee,
      referralRate,
      paymentFee,
      paymentFeeRate: rates.paymentFeeRate,
      affiliateFee,
      affiliateRate,
      shippingCost,
      adSpend,
      totalFees,

      // Cost
      cogsPerUnit: cogs,
      totalCogs,

      // Profit
      netProfit,
      profitMargin,
      isProfitable: netProfit > 0,

      // Meta
      region,
      isNewSeller
    };
  }

  /**
   * Quick profit calculation from order total (simplified)
   * Used when only order total is visible on the page
   * @param {number} orderTotal - Total order amount
   * @param {number} totalCogs - Total COGS for this order
   * @param {string} region - Market region
   * @param {boolean} isNewSeller
   * @returns {Object} Simplified profit info
   */
  function quickCalculate(orderTotal, totalCogs = 0, region = 'US', isNewSeller = false) {
    const rates = FEE_RATES[region] || FEE_RATES.US;
    const referralRate = isNewSeller ? rates.referralRateNew : rates.referralRate;

    const referralFee = round(orderTotal * referralRate);
    const paymentFee = round(orderTotal * rates.paymentFeeRate);
    const totalFees = round(referralFee + paymentFee);
    const netProfit = round(orderTotal - totalFees - totalCogs);
    const profitMargin = orderTotal > 0 ? round((netProfit / orderTotal) * 100, 1) : 0;

    return {
      orderTotal,
      referralFee,
      paymentFee,
      totalFees,
      totalCogs,
      netProfit,
      profitMargin,
      isProfitable: netProfit > 0
    };
  }

  /**
   * Get FBT shipping cost estimate
   * @param {number} weightLbs - Product weight in pounds
   * @param {number} unitsPerOrder - Number of units in order
   * @returns {number} Estimated shipping cost per unit
   */
  function getFbtCost(weightLbs, unitsPerOrder = 1) {
    const tier = FBT_RATES_US.find(t => weightLbs <= t.maxWeight) ||
                 FBT_RATES_US[FBT_RATES_US.length - 1];

    if (unitsPerOrder >= 4) return tier.rate4plus;
    if (unitsPerOrder === 3) return tier.rate3;
    if (unitsPerOrder === 2) return tier.rate2;
    return tier.rate1;
  }

  /**
   * Format currency
   * @param {number} amount
   * @param {string} region
   * @returns {string}
   */
  function formatCurrency(amount, region = 'US') {
    const symbols = { US: '$', UK: '£', EU: '€' };
    const symbol = symbols[region] || '$';
    const sign = amount < 0 ? '-' : '';
    return `${sign}${symbol}${Math.abs(amount).toFixed(2)}`;
  }

  /**
   * Format percentage
   * @param {number} value
   * @returns {string}
   */
  function formatPercent(value) {
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  }

  /**
   * Round to specified decimal places
   */
  function round(value, decimals = 2) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  /**
   * Get fee rates for a region
   */
  function getRates(region = 'US') {
    return { ...FEE_RATES[region] || FEE_RATES.US };
  }

  return {
    calculate,
    quickCalculate,
    getFbtCost,
    formatCurrency,
    formatPercent,
    getRates,
    FEE_RATES
  };
})();

// Export for both module and content script contexts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FeeCalculator;
}
