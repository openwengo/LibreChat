const { logger } = require('@librechat/data-schemas');
const { cloudidentity_v1, auth } = require('@googleapis/cloudidentity');

const GOOGLE_BASE_SCOPES = ['openid', 'profile', 'email'];
const GOOGLE_GROUPS_SCOPE = 'https://www.googleapis.com/auth/cloud-identity.groups.readonly';

const escapeCelString = (value) => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const getGoogleScopes = () => {
  if (!process.env.GOOGLE_WORKSPACE_GROUP) {
    return [...GOOGLE_BASE_SCOPES];
  }

  return [...GOOGLE_BASE_SCOPES, GOOGLE_GROUPS_SCOPE];
};

const createCloudIdentityClient = (accessToken) => {
  const oauthClient = new auth.OAuth2();
  oauthClient.setCredentials({ access_token: accessToken });
  return new cloudidentity_v1.Cloudidentity({ auth: oauthClient });
};

const resolveGroupName = async (cloudIdentityClient, groupEmail) => {
  if (groupEmail.startsWith('groups/')) {
    return groupEmail;
  }

  const { data } = await cloudIdentityClient.groups.lookup({ 'groupKey.id': groupEmail });
  return data.name ?? null;
};

const checkGroupMembership = async (accessToken, userEmail) => {
  const groupEmail = process.env.GOOGLE_WORKSPACE_GROUP?.trim();

  if (!groupEmail) {
    return true;
  }

  if (!accessToken || !userEmail) {
    return false;
  }

  try {
    const cloudIdentityClient = createCloudIdentityClient(accessToken);
    const groupName = await resolveGroupName(cloudIdentityClient, groupEmail);

    if (!groupName) {
      logger.warn(`[GoogleStrategy] Google Workspace group not found: ${groupEmail}`);
      return false;
    }

    const { data } = await cloudIdentityClient.groups.memberships.checkTransitiveMembership({
      parent: groupName,
      query: `member_key_id == '${escapeCelString(userEmail)}'`,
    });

    return data.hasMembership === true;
  } catch (error) {
    logger.error('[GoogleStrategy] Failed to verify Google Workspace group membership', error);
    throw error;
  }
};

module.exports = { getGoogleScopes, checkGroupMembership };
