const { getConvo } = require('~/models');

// Middleware to validate conversationId and user relationship
const validateMessageReq = async (req, res, next) => {
  let conversationId = req.params.conversationId || req.body.conversationId;

  if (conversationId === 'new') {
    return res.status(200).send([]);
  }

  if (!conversationId && req.body.message) {
    conversationId = req.body.message.conversationId;
  }

  const conversation = await getConvo(req.user, conversationId);

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  // Only check ownership if user is not an admin
  const { SystemRoles } = require('librechat-data-provider');
  if (req.user.role !== SystemRoles.ADMIN && conversation.user !== req.user.id) {
    return res.status(403).json({ error: 'User not authorized for this conversation' });
  }

  next();
};

module.exports = validateMessageReq;
