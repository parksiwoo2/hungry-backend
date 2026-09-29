import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { DataSource } from 'typeorm';
import { SessionService } from './session.service';

describe('PostgreSQL sessions', () => {
  const query = jest.fn<Promise<{ user_id: string }[]>, [string, unknown[]?]>();
  const db = {
    query,
    transaction: (
      callback: (manager: { query: typeof query }) => Promise<void>,
    ) => callback({ query }),
  };
  const response = {
    cookie: jest.fn<void, [string, string, unknown]>(),
    clearCookie: jest.fn(),
  };
  const service = new SessionService(
    db as unknown as DataSource,
    new ConfigService({ SESSION_COOKIE_SECURE: 'true' }),
  );
  const request = (token?: string) =>
    ({
      headers: { cookie: token ? `hungry.sid=${token}` : undefined },
    }) as Request;
  const hash = (token: string) =>
    createHash('sha256').update(token).digest('hex');

  beforeEach(() => jest.resetAllMocks());

  it('rotates the old session and only stores the new token hash', async () => {
    const old = 'a'.repeat(64);
    await service.create(
      'user-id',
      request(old),
      response as unknown as Response,
    );
    const token = response.cookie.mock.calls[0][1];
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(token).not.toBe(old);
    expect(query).toHaveBeenCalledWith(
      'DELETE FROM user_sessions WHERE token_hash = $1',
      [hash(old)],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_sessions'),
      [hash(token), 'user-id', expect.any(Date)],
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'hungry.sid',
      token,
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 604800000,
      }),
    );
  });

  it('rejects absent, forged, and expired sessions', async () => {
    await expect(service.userId(request())).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service.userId(request('bad-token'))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(query).not.toHaveBeenCalled();
    query.mockResolvedValueOnce([]);
    await expect(service.userId(request('a'.repeat(64)))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(query.mock.calls[0][0]).toContain('expires_at > now()');
  });

  it('resolves the user from the session rather than request body', async () => {
    query.mockResolvedValueOnce([{ user_id: 'actual-user' }]);
    expect(await service.userId(request('a'.repeat(64)))).toBe('actual-user');
  });

  it('revokes the stored token and clears the cookie on logout', async () => {
    const token = 'b'.repeat(64);
    await service.destroy(request(token), response as unknown as Response);
    expect(query).toHaveBeenCalledWith(
      'DELETE FROM user_sessions WHERE token_hash = $1',
      [hash(token)],
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      'hungry.sid',
      expect.objectContaining({ path: '/', httpOnly: true }),
    );
  });
});
