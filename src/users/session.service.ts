import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';

@Injectable()
export class SessionService {
  private readonly cookieName = 'hungry.sid';
  private readonly lifetime = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  private token(request: Request): string | undefined {
    return request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${this.cookieName}=`))
      ?.slice(this.cookieName.length + 1);
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private options() {
    return {
      httpOnly: true,
      secure: this.config.get<string>('SESSION_COOKIE_SECURE') === 'true',
      sameSite: 'lax' as const,
      path: '/',
    };
  }

  async create(userId: string, request: Request, response: Response) {
    const token = randomBytes(32).toString('hex');
    const oldToken = this.token(request);
    await this.db.transaction(async (manager) => {
      await manager.query(
        'DELETE FROM user_sessions WHERE expires_at <= now()',
      );
      if (oldToken)
        await manager.query('DELETE FROM user_sessions WHERE token_hash = $1', [
          this.hash(oldToken),
        ]);
      await manager.query(
        'INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
        [this.hash(token), userId, new Date(Date.now() + this.lifetime)],
      );
    });
    response.cookie(this.cookieName, token, {
      ...this.options(),
      maxAge: this.lifetime,
    });
  }

  async userId(request: Request): Promise<string> {
    const token = this.token(request);
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new UnauthorizedException('로그인이 필요합니다.');
    const rows = await this.db.query<{ user_id: string }[]>(
      'SELECT user_id FROM user_sessions WHERE token_hash = $1 AND expires_at > now()',
      [this.hash(token)],
    );
    if (!rows[0]) throw new UnauthorizedException('세션이 만료되었습니다.');
    return rows[0].user_id;
  }

  async destroy(request: Request, response: Response) {
    const token = this.token(request);
    if (token)
      await this.db.query('DELETE FROM user_sessions WHERE token_hash = $1', [
        this.hash(token),
      ]);
    this.clear(response);
  }

  clear(response: Response) {
    response.clearCookie(this.cookieName, this.options());
  }
}
