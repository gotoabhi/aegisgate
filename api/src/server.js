const express = require('express');
const cors = require('cors');
require('dotenv').config();

const egressRoutes = require('./routes/egressRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/v1/egress', egressRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`AegisGate Egress Gateway listening on port ${PORT}`);
});