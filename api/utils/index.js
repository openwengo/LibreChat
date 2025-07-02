const tokenHelpers = require('./tokens');
const deriveBaseURL = require('./deriveBaseURL');
const extractBaseURL = require('./extractBaseURL');
const findMessageContent = require('./findMessageContent');
const replaceSpecialVars = require('./replaceSpecialVars');

module.exports = {
  deriveBaseURL,
  extractBaseURL,
  ...tokenHelpers,
  findMessageContent,
  replaceSpecialVars
};
