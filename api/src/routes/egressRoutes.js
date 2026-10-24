const express = require('express');
const router = express.Router();
const { exportPatientData, getAuditLogs } = require('../controllers/egressController');

router.post('/export', exportPatientData);
router.get('/audit-logs', getAuditLogs);

module.exports = router;