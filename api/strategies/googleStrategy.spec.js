const mockSetCredentials = jest.fn();
const mockLookup = jest.fn();
const mockCheckTransitiveMembership = jest.fn();
const mockCloudidentity = jest.fn(() => ({
  groups: {
    lookup: mockLookup,
    memberships: {
      checkTransitiveMembership: mockCheckTransitiveMembership,
    },
  },
}));
const mockOAuth2 = jest.fn(() => ({
  setCredentials: mockSetCredentials,
}));

jest.mock('@googleapis/cloudidentity', () => ({
  auth: {
    OAuth2: mockOAuth2,
  },
  cloudidentity_v1: {
    Cloudidentity: mockCloudidentity,
  },
}));

jest.mock('./socialLogin', () => jest.fn(() => jest.fn()));

jest.mock('~/config', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { checkGroupMembership, getGoogleScopes } = require('./googleStrategy');

describe('googleStrategy Workspace group checks', () => {
  const originalGoogleWorkspaceGroup = process.env.GOOGLE_WORKSPACE_GROUP;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GOOGLE_WORKSPACE_GROUP;
    mockLookup.mockResolvedValue({ data: { name: 'groups/admins' } });
    mockCheckTransitiveMembership.mockResolvedValue({ data: { hasMembership: true } });
  });

  afterAll(() => {
    if (originalGoogleWorkspaceGroup == null) {
      delete process.env.GOOGLE_WORKSPACE_GROUP;
      return;
    }

    process.env.GOOGLE_WORKSPACE_GROUP = originalGoogleWorkspaceGroup;
  });

  it('only requests Cloud Identity scope when a Workspace group is configured', () => {
    expect(getGoogleScopes()).toEqual(['openid', 'profile', 'email']);

    process.env.GOOGLE_WORKSPACE_GROUP = 'librechatadmins@wengo.com';

    expect(getGoogleScopes()).toEqual([
      'openid',
      'profile',
      'email',
      'https://www.googleapis.com/auth/cloud-identity.groups.readonly',
    ]);
  });

  it('looks up the group by email before checking transitive membership', async () => {
    process.env.GOOGLE_WORKSPACE_GROUP = 'librechatadmins@wengo.com';

    await expect(checkGroupMembership('access-token', 'user@wengo.com')).resolves.toBe(true);

    expect(mockSetCredentials).toHaveBeenCalledWith({ access_token: 'access-token' });
    expect(mockLookup).toHaveBeenCalledWith({ 'groupKey.id': 'librechatadmins@wengo.com' });
    expect(mockCheckTransitiveMembership).toHaveBeenCalledWith({
      parent: 'groups/admins',
      query: "member_key_id == 'user@wengo.com'",
    });
  });

  it('accepts a direct Cloud Identity group resource name', async () => {
    process.env.GOOGLE_WORKSPACE_GROUP = 'groups/admins';

    await expect(checkGroupMembership('access-token', 'user@wengo.com')).resolves.toBe(true);

    expect(mockLookup).not.toHaveBeenCalled();
    expect(mockCheckTransitiveMembership).toHaveBeenCalledWith({
      parent: 'groups/admins',
      query: "member_key_id == 'user@wengo.com'",
    });
  });
});
