const router = require('express').Router();
const { setup, setupStatus, login, refresh, me, changePassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.get('/setup-status', setupStatus);
router.post('/setup', setup);
router.post('/login', login);
router.get('/me', authenticate, me);
router.post('/refresh', authenticate, refresh);
router.post('/change-password', authenticate, changePassword);

module.exports = router;
