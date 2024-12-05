/**
 * Process a list of extra headers and return an object with replaced variables
 * @param {string[]} headersList - List of headers in format "name:value"
 * @param {Object} user - The user object containing id and email
 * @returns {Object} An object with header names as keys and processed values
 */
function processExtraHeaders(headersList, user) {
  const headers = {};

  headersList.forEach(headerString => {
    const [headerName, headerValue] = headerString.split(':').map(s => s.trim());
    const processedValue = headerValue
      .replace('{user_id}', user.id)
      .replace('{user_email}', user.email || '');
    headers[headerName] = processedValue;
  });

  return headers;
}

module.exports = {
  processExtraHeaders
};
