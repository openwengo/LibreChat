const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { cloudidentity_v1, auth } = require('@googleapis/cloudidentity');
const socialLogin = require('./socialLogin');
const { logger } = require('~/config');

const GOOGLE_BASE_SCOPES = ['openid', 'profile', 'email'];
const GOOGLE_GROUPS_SCOPE = 'https://www.googleapis.com/auth/cloud-identity.groups.readonly';

const escapeCelString = (value) => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const getGoogleScopes = () => {
  if (!process.env.GOOGLE_WORKSPACE_GROUP) {
    return [...GOOGLE_BASE_SCOPES];
  }

  return [...GOOGLE_BASE_SCOPES, GOOGLE_GROUPS_SCOPE];
};

const getProfileDetails = ({ profile }) => ({
  email: profile.emails[0].value,
  id: profile.id,
  avatarUrl: profile.photos[0].value,
  username: profile.name.givenName,
  name: `${profile.name.givenName}${profile.name.familyName ? ` ${profile.name.familyName}` : ''}`,
  emailVerified: profile.emails[0].verified,
});

const googleLogin = socialLogin('google', getProfileDetails);
const googleAdminLogin = socialLogin('google', getProfileDetails, { existingUsersOnly: true });

const withAccessTokenAuthInfo =
  (loginHandler) => (accessToken, refreshToken, params, profile, cb) => {
    return loginHandler(accessToken, refreshToken, params, profile, (err, user, info) => {
      if (err || !user) {
        return cb(err, user, info);
      }

      return cb(null, user, { ...info, accessToken });
    });
  };

const getGoogleConfig = (callbackURL) => ({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL,
  proxy: true,
});

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

const googleStrategy = () =>
  new GoogleStrategy(
    getGoogleConfig(`${process.env.DOMAIN_SERVER}${process.env.GOOGLE_CALLBACK_URL}`),
    withAccessTokenAuthInfo(googleLogin),
  );

const googleAdminStrategy = () =>
  new GoogleStrategy(
    getGoogleConfig(`${process.env.DOMAIN_SERVER}/api/admin/oauth/google/callback`),
    googleAdminLogin,
  );

module.exports = googleStrategy;
module.exports.googleAdminLogin = googleAdminStrategy;
module.exports.getGoogleScopes = getGoogleScopes;
module.exports.checkGroupMembership = checkGroupMembership;
