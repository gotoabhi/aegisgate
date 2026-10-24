require('dotenv').config();
const express = require('express');
const egressRoutes = require('./routes/egressRoutes');
const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json({ limit: '2mb' }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'healthy', database: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', database: 'disconnected' });
  }
});

app.use('/api/v1/egress', egressRoutes);

const server = app.listen(PORT, () => {
  console.log(`AegisGate compliance engine listening on port ${PORT}`);
});

const gracefulShutdown = () => {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);