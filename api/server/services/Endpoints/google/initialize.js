const { EModelEndpoint, AuthKeys } = require('librechat-data-provider');
const { getUserKey, checkUserKeyExpiry } = require('~/server/services/UserService');
const { processExtraHeaders } = require('~/server/utils/headerUtil');
const { getLLMConfig } = require('~/server/services/Endpoints/google/llm');
const { isEnabled } = require('~/server/utils');
const { GoogleClient } = require('~/app');

const initializeClient = async ({ req, res, endpointOption, overrideModel, optionsOnly }) => {
  const { GOOGLE_KEY, GOOGLE_REVERSE_PROXY, GOOGLE_AUTH_HEADER, PROXY, GOOGLE_EXTRA_HEADERS } = process.env;
  const isUserProvided = GOOGLE_KEY === 'user_provided';
  const { key: expiresAt } = req.body;

  let userKey = null;
  if (expiresAt && isUserProvided) {
    checkUserKeyExpiry(expiresAt, EModelEndpoint.google);
    userKey = await getUserKey({ userId: req.user.id, name: EModelEndpoint.google });
  }

  let serviceKey = {};
  try {
    serviceKey = require('~/data/auth.json');
  } catch (e) {
    // Do nothing
  }

  const credentials = isUserProvided
    ? userKey
    : {
      [AuthKeys.GOOGLE_SERVICE_KEY]: serviceKey,
      [AuthKeys.GOOGLE_API_KEY]: GOOGLE_KEY,
    };

  let clientOptions = {};

  /** @type {undefined | TBaseEndpoint} */
  const allConfig = req.app.locals.all;
  /** @type {undefined | TBaseEndpoint} */
  const googleConfig = req.app.locals[EModelEndpoint.google];

  if (googleConfig) {
    clientOptions.streamRate = googleConfig.streamRate;
    clientOptions.titleModel = googleConfig.titleModel;
  }

  if (allConfig) {
    clientOptions.streamRate = allConfig.streamRate;
  }

  if (GOOGLE_EXTRA_HEADERS) {
    const headersList = GOOGLE_EXTRA_HEADERS.split(',').map(h => h.trim());
    clientOptions.customHeaders = processExtraHeaders(headersList, req.user);
  }

  clientOptions = {
    req,
    res,
    reverseProxyUrl: GOOGLE_REVERSE_PROXY ?? null,
    authHeader: isEnabled(GOOGLE_AUTH_HEADER) ?? null,
    proxy: PROXY ?? null,
    ...clientOptions,
    ...endpointOption,
  };

  if (optionsOnly) {
    clientOptions = Object.assign(
      {
        modelOptions: endpointOption.model_parameters,
      },
      clientOptions,
    );
    if (overrideModel) {
      clientOptions.modelOptions.model = overrideModel;
    }
    return getLLMConfig(credentials, clientOptions);
  }

  const client = new GoogleClient(credentials, clientOptions);

  return {
    client,
    credentials,
  };
};

module.exports = initializeClient;
