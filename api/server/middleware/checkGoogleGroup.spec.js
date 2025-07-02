const { logger } = require('@librechat/data-schemas');
const { checkGroupMembership } = require('~/strategies/googleStrategy');
const verifyGoogleGroupMembership = require('./checkGoogleGroup');

jest.mock('~/strategies/googleStrategy', () => ({
  checkGroupMembership: jest.fn(),
}));

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('verifyGoogleGroupMembership', () => {
  const originalGoogleWorkspaceGroup = process.env.GOOGLE_WORKSPACE_GROUP;
  let req;
  let res;
  let next;

  beforeEach(() => {
    process.env.GOOGLE_WORKSPACE_GROUP = 'librechatadmins@wengo.com';
    req = {
      user: { email: 'user@wengo.com' },
      authInfo: { accessToken: 'access-token' },
    };
    res = { redirect: jest.fn() };
    next = jest.fn();
  });

  afterAll(() => {
    if (originalGoogleWorkspaceGroup == null) {
      delete process.env.GOOGLE_WORKSPACE_GROUP;
      return;
    }

    process.env.GOOGLE_WORKSPACE_GROUP = originalGoogleWorkspaceGroup;
  });

  it('passes through without checking when no Workspace group is configured', async () => {
    delete process.env.GOOGLE_WORKSPACE_GROUP;

    await verifyGoogleGroupMembership(req, res, next);

    expect(checkGroupMembership).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('redirects to login when Passport did not forward an access token', async () => {
    req.authInfo = {};

    await verifyGoogleGroupMembership(req, res, next);

    expect(checkGroupMembership).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(expect.stringMatching(/\/login\?error=auth_error$/));
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('calls next and logs through the shared logger when the user is a member', async () => {
    checkGroupMembership.mockResolvedValue(true);

    await verifyGoogleGroupMembership(req, res, next);

    expect(checkGroupMembership).toHaveBeenCalledWith('access-token', 'user@wengo.com');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('user@wengo.com'));
  });

  it('redirects with group_access_denied when the user is not a member', async () => {
    checkGroupMembership.mockResolvedValue(false);

    await verifyGoogleGroupMembership(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringMatching(/\/login\?error=group_access_denied$/),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('user@wengo.com'));
  });

  it('redirects with internal_error and logs the cause when the membership check throws', async () => {
    const apiError = new Error('Cloud Identity unavailable');
    checkGroupMembership.mockRejectedValue(apiError);

    await verifyGoogleGroupMembership(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringMatching(/\/login\?error=internal_error$/),
    );
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), apiError);
  });
});
