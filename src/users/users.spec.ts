import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import type { Repository } from 'typeorm';
import { LoginDto, SignupDto, UpdateUserDto } from './dto/users.dto';
import { MaskingIcon, User } from './entities/user.entity';
import { UsersService } from './users.service';

describe('User DTO validation', () => {
  it('normalizes valid signup and login input', async () => {
    const signup = plainToInstance(SignupDto, {
      email: ' SIEU.PARK@gmail.com ',
      nickName: ' 몽이 ',
    });
    const login = plainToInstance(LoginDto, {
      email: ' SIEU.PARK@gmail.com ',
    });

    expect(await validate(signup)).toHaveLength(0);
    expect(await validate(login)).toHaveLength(0);
    expect(signup.email).toBe('sieu.park@gmail.com');
    expect(signup.nickName).toBe('몽이');
    expect(login.email).toBe('sieu.park@gmail.com');
  });

  it('rejects malformed and unexpected signup input', async () => {
    const input = plainToInstance(SignupDto, {
      email: 'bad email',
      nickName: ' ',
      id: 'other-user',
    });
    const errors = await validate(input, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['email', 'nickName', 'id']),
    );
  });

  it('requires a valid password with NOTE or CALCU', async () => {
    const missing = plainToInstance(UpdateUserDto, {
      maskingIcon: MaskingIcon.NOTE,
    });
    const short = plainToInstance(UpdateUserDto, {
      maskingIcon: MaskingIcon.CALCU,
      secretPassword: '123',
    });
    const none = plainToInstance(UpdateUserDto, {
      maskingIcon: MaskingIcon.NONE,
    });

    expect(await validate(missing)).not.toHaveLength(0);
    expect(await validate(short)).not.toHaveLength(0);
    expect(await validate(none)).toHaveLength(0);
  });
});

describe('UsersService', () => {
  const getOne = jest.fn();
  const query = {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne,
  };
  const repository = {
    update: jest.fn<Promise<void>, [string, Partial<User>]>(),
    createQueryBuilder: () => query,
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const service = new UsersService(repository as unknown as Repository<User>);

  beforeEach(() => jest.clearAllMocks());

  it('never returns password hash and stores a verifiable salted hash', async () => {
    getOne.mockResolvedValue({
      id: 'id',
      email: 'a@b.com',
      nickName: '몽이',
      maskingIcon: MaskingIcon.NOTE,
      secretPasswordHash: 'hidden',
    });
    const result = await service.update('id', {
      maskingIcon: 'NOTE',
      secretPassword: '1234@12',
    });
    const changes = repository.update.mock.calls[0][1] as {
      maskingIcon: string;
      secretPasswordHash: string;
    };
    expect(changes.maskingIcon).toBe(MaskingIcon.NOTE);
    const [algorithm, salt, hash] = changes.secretPasswordHash.split(':');
    expect(algorithm).toBe('scrypt');
    const derived = (await promisify(scrypt)('1234@12', salt, 64)) as Buffer;
    expect(hash).toBe(derived.toString('hex'));
    expect(result.hasSecretPassword).toBe(true);
    expect(result).not.toHaveProperty('secretPassword');
    expect(result).not.toHaveProperty('secretPasswordHash');
  });
  it('translates unique constraint violations into HTTP 409', async () => {
    repository.update.mockRejectedValueOnce({ code: '23505' });
    await expect(service.update('id', { nickName: 'taken' })).rejects.toThrow(
      ConflictException,
    );
  });
  it('requires a secret password when enabling a masking icon', async () => {
    await expect(
      service.update('id', { maskingIcon: MaskingIcon.NOTE }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.update('id', { maskingIcon: MaskingIcon.CALCU }),
    ).rejects.toThrow(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('allows maskingIcon NONE without a secret password', async () => {
    getOne.mockResolvedValue({
      id: 'id',
      email: 'a@b.com',
      nickName: '몽이',
      maskingIcon: 'NONE',
      secretPasswordHash: null,
    });
    await service.update('id', { maskingIcon: MaskingIcon.NONE });
    expect(repository.update).toHaveBeenCalledWith('id', {
      maskingIcon: 'NONE',
    });
  });
  it('rejects login for unknown email', async () => {
    repository.findOneBy.mockResolvedValue(null);
    await expect(service.findByEmail('missing@example.com')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
