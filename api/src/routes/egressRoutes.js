const express = require('express');
const router = express.Router();
const { exportPatientData, getAuditLogs, verifyChain } = require('../controllers/egressController');

router.post('/export', exportPatientData);
router.get('/audit-logs', getAuditLogs);
router.get('/audit/verify', verifyChain);

module.exports = router;