# TikTok Seller Center DOM 调研结果

> 调研日期：2026-04-03

## 技术架构
- **框架**：React SPA（客户端路由，动态加载）
- **CSS**：可能使用CSS Modules或CSS-in-JS
- **认证**：基于Cookie，content script可通过document.cookie访问

## 已知URL模式
| 页面 | URL模式 |
|------|---------|
| Dashboard | `/homepage` |
| 数据概览 | `/compass/data-overview` |
| 订单列表 | 未公开（需逆向，可能是 `/order` 或 `/orders`） |
| 订单详情 | 未公开（可能是 `/order/detail/{id}`） |
| 商品列表 | 未公开（可能是 `/product` 或 `/products`） |
| 商品编辑 | 未公开（可能是 `/product/edit/{id}`） |

## 订单页面可见数据
- Order ID
- Order Status（6种异常状态）
- Shipping/Fulfillment Status
- Buyer Information
- Product details
- Created/Order Date
- 支持卡片视图/表格视图切换

## Order API字段（15个）
`id`, `currency`, `sub_total`, `shipping_cost`, `total_tax`, `total_amount`, 
`fulfillment_status`, `payment_method`, `customer`, `shipping_address`, 
`tracking`, `line_items`, `note`, `created_at`, `updated_at`

## Content Script注入注意事项
1. **SPA路由**：URL变化不触发传统页面加载，需MutationObserver
2. **React虚拟DOM**：直接DOM操作可能被React重新渲染覆盖
3. **CSP限制**：Manifest V3有更严格的安全策略
4. **时序问题**：需等React组件渲染完成后再注入

## 已验证的竞品方案
- TikTok Seller Dashboard Enhancer：Manifest V3 + Content Script叠加，Pro $12/月
- EchoTik：快捷按钮 + 90天趋势数据

## 需要后续逆向的内容
- [ ] 订单列表页精确URL和DOM选择器
- [ ] 商品列表页精确URL和DOM选择器
- [ ] Dashboard页面主内容区选择器
- [ ] 价格字段的class命名规则
