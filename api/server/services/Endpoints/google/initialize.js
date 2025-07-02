const path = require('path');
const { EModelEndpoint, AuthKeys } = require('librechat-data-provider');
const { getGoogleConfig, isEnabled, loadServiceKey } = require('@librechat/api');
const { getUserKey, checkUserKeyExpiry } = require('~/server/services/UserService');
const { processExtraHeaders } = require('~/server/utils/headerUtil');
const { GoogleClient } = require('~/app');

const initializeClient = async ({
  req,
  res,
  endpointOption,
  overrideModel,
  optionsOnly,
  extraHeaders,
}) => {
  const { GOOGLE_KEY, GOOGLE_REVERSE_PROXY, GOOGLE_AUTH_HEADER, PROXY, GOOGLE_EXTRA_HEADERS } =
    process.env;
  const isUserProvided = GOOGLE_KEY === 'user_provided';
  const { key: expiresAt } = req.body;

  let userKey = null;
  if (expiresAt && isUserProvided) {
    checkUserKeyExpiry(expiresAt, EModelEndpoint.google);
    userKey = await getUserKey({ userId: req.user.id, name: EModelEndpoint.google });
  }

  let serviceKey = {};

  /** Check if GOOGLE_KEY is provided at all (including 'user_provided') */
  const isGoogleKeyProvided =
    (GOOGLE_KEY && GOOGLE_KEY.trim() !== '') || (isUserProvided && userKey != null);

  if (!isGoogleKeyProvided) {
    /** Only attempt to load service key if GOOGLE_KEY is not provided */
    try {
      const serviceKeyPath =
        process.env.GOOGLE_SERVICE_KEY_FILE ||
        path.join(__dirname, '../../../..', 'data', 'auth.json');
      serviceKey = await loadServiceKey(serviceKeyPath);
      if (!serviceKey) {
        serviceKey = {};
      }
    } catch (_e) {
      // Service key loading failed, but that's okay if not required
      serviceKey = {};
    }
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

  // Handle extra headers from environment variable or passed parameter
  let combinedExtraHeaders = {};
  if (GOOGLE_EXTRA_HEADERS) {
    const headersList = GOOGLE_EXTRA_HEADERS.split(',').map((h) => h.trim());
    combinedExtraHeaders = {
      ...combinedExtraHeaders,
      ...processExtraHeaders(headersList, req.user),
    };
  }
  if (extraHeaders) {
    combinedExtraHeaders = { ...combinedExtraHeaders, ...extraHeaders };
  }

  if (Object.keys(combinedExtraHeaders).length > 0) {
    clientOptions.customHeaders = combinedExtraHeaders;
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
        modelOptions: endpointOption?.model_parameters ?? {},
      },
      clientOptions,
    );
    if (overrideModel) {
      clientOptions.modelOptions.model = overrideModel;
    }

    const googleConfig = getGoogleConfig(credentials, clientOptions);

    googleConfig.llmConfig.customHeaders = {
      ...googleConfig.llmConfig.customHeaders,
      ...clientOptions.customHeaders,
    };

    return googleConfig;
  }

  const client = new GoogleClient(credentials, clientOptions);

  return {
    client,
    credentials,
  };
};

module.exports = initializeClient;
