require('dotenv').config();
const express = require('express');
const app = express();

app.use(express.json());

// Home page
app.get('/', (req, res) => {
  res.send('Chargeback Manager is running!');
});

// Shopify OAuth start
app.get('/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');
  
  const redirectUri = `${process.env.APP_URL}/auth/callback`;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=read_orders,write_orders&redirect_uri=${redirectUri}`;
  
  res.redirect(installUrl);
});

// Shopify OAuth callback
app.get('/auth/callback', (req, res) => {
  res.send('Auth successful! App installed.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
