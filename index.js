require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple in-memory store (we'll upgrade later)
const sessions = {};

// ─── HOME ───────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('Chargeback Manager is running!');
});

// ─── INSTALL / AUTH ─────────────────────────────────────
app.get('/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop');

  const scopes = 'read_orders,write_orders';
  const redirectUri = `${process.env.APP_URL}/auth/callback`;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${scopes}&redirect_uri=${redirectUri}`;

  res.redirect(installUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { shop, code, hmac } = req.query;

  // Verify HMAC
  const params = Object.keys(req.query)
    .filter(k => k !== 'hmac')
    .sort()
    .map(k => `${k}=${req.query[k]}`)
    .join('&');
  const digest = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(params).digest('hex');
  if (digest !== hmac) return res.status(400).send('HMAC validation failed');

  // Exchange code for token
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code
    })
  });
  const { access_token } = await tokenRes.json();
  sessions[shop] = access_token;

  res.redirect(`/dashboard?shop=${shop}`);
});

// ─── DASHBOARD ──────────────────────────────────────────
app.get('/dashboard', async (req, res) => {
  const { shop } = req.query;
  const token = sessions[shop];
  if (!token) return res.redirect(`/auth?shop=${shop}`);

  // Fetch disputes (chargebacks)
  const disputeRes = await fetch(`https://${shop}/admin/api/2024-01/shopify_payments/disputes.json`, {
    headers: { 'X-Shopify-Access-Token': token }
  });
  const { disputes } = await disputeRes.json();

  const rows = (disputes || []).map(d => `
    <tr>
      <td>${d.id}</td>
      <td>$${(d.amount / 1).toFixed(2)}</td>
      <td><span class="badge ${d.status}">${d.status}</span></td>
      <td>${d.reason || '-'}</td>
      <td>${new Date(d.initiated_at).toLocaleDateString()}</td>
      <td>${d.evidence_due_by ? new Date(d.evidence_due_by).toLocaleDateString() : '-'}</td>
    </tr>
  `).join('');

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Chargeback Manager</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f6f6f7; color: #202223; }
        .header { background: #fff; border-bottom: 1px solid #e1e3e5; padding: 16px 32px; display: flex; align-items: center; gap: 12px; }
        .header h1 { font-size: 20px; font-weight: 600; }
        .header .shop { font-size: 14px; color: #6d7175; }
        .container { max-width: 1100px; margin: 32px auto; padding: 0 24px; }
        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 28px; }
        .stat-card { background: #fff; border-radius: 8px; padding: 20px; border: 1px solid #e1e3e5; }
        .stat-card .label { font-size: 13px; color: #6d7175; margin-bottom: 8px; }
        .stat-card .value { font-size: 28px; font-weight: 700; }
        .stat-card.red .value { color: #d72c0d; }
        .stat-card.yellow .value { color: #b98900; }
        .stat-card.green .value { color: #008060; }
        .table-card { background: #fff; border-radius: 8px; border: 1px solid #e1e3e5; overflow: hidden; }
        .table-card h2 { padding: 16px 20px; font-size: 16px; border-bottom: 1px solid #e1e3e5; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 12px 16px; font-size: 12px; color: #6d7175; text-transform: uppercase; background: #f6f6f7; border-bottom: 1px solid #e1e3e5; }
        td { padding: 14px 16px; font-size: 14px; border-bottom: 1px solid #f1f2f3; }
        tr:last-child td { border-bottom: none; }
        .badge { padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 500; }
        .badge.needs_response { background: #fff4e4; color: #b98900; }
        .badge.under_review { background: #e3f1df; color: #008060; }
        .badge.won { background: #e3f1df; color: #008060; }
        .badge.lost { background: #fff4f4; color: #d72c0d; }
        .badge.accepted { background: #f1f2f3; color: #6d7175; }
        .empty { text-align: center; padding: 60px; color: #6d7175; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h1>⚡ Chargeback Manager</h1>
          <div class="shop">${shop}</div>
        </div>
      </div>
      <div class="container">
        <div class="stats">
          <div class="stat-card red">
            <div class="label">Total Chargebacks</div>
            <div class="value">${(disputes || []).length}</div>
          </div>
          <div class="stat-card yellow">
            <div class="label">Needs Response</div>
            <div class="value">${(disputes || []).filter(d => d.status === 'needs_response').length}</div>
          </div>
          <div class="stat-card green">
            <div class="label">Won</div>
            <div class="value">${(disputes || []).filter(d => d.status === 'won').length}</div>
          </div>
          <div class="stat-card red">
            <div class="label">Lost</div>
            <div class="value">${(disputes || []).filter(d => d.status === 'lost').length}</div>
          </div>
        </div>
        <div class="table-card">
          <h2>All Chargebacks</h2>
          ${(disputes || []).length === 0 ? '<div class="empty">🎉 No chargebacks found!</div>' : `
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Date</th>
                <th>Due By</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>`}
        </div>
      </div>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
