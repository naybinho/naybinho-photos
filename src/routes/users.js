const router = require('express').Router();
const { listUsers, createUser, getUser, updateUser, deleteUser, getUserStats } = require('../controllers/userController');
const { authenticate, requireAdmin } = require('../middleware/auth');

// All user routes require auth
router.use(authenticate);

router.get('/', requireAdmin, listUsers);
router.post('/', requireAdmin, createUser);
router.get('/:id', getUser);
router.patch('/:id', updateUser);
router.delete('/:id', requireAdmin, deleteUser);
router.get('/:id/stats', getUserStats);

module.exports = router;
