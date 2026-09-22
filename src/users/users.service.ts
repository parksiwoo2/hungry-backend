import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { Repository } from 'typeorm';
import { SignupDto, UpdateUserDto } from './dto/users.dto';
import { MaskingIcon, User } from './entities/user.entity';

const deriveKey = promisify(scrypt);

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async create(input: SignupDto) {
    try {
      const user = await this.users.save(
        this.users.create({ email: input.email, nickName: input.nickName }),
      );
      return this.profile(user.id);
    } catch (error) {
      this.rethrow(error);
    }
  }

  async findByEmail(email: string) {
    const user = await this.users.findOneBy({ email });
    if (!user) throw new UnauthorizedException('등록된 이메일이 아닙니다.');
    return user;
  }

  async profile(id: string) {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.secretPasswordHash')
      .where('user.id = :id', { id })
      .getOne();
    if (!user) throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    return {
      id: user.id,
      email: user.email,
      nickName: user.nickName,
      maskingIcon: user.maskingIcon,
      hasSecretPassword: Boolean(user.secretPasswordHash),
    };
  }

  async update(id: string, input: UpdateUserDto) {
    const changes: Partial<User> = {};
    if (input.email !== undefined) changes.email = input.email;
    if (input.nickName !== undefined) changes.nickName = input.nickName;
    if (input.maskingIcon !== undefined) {
      changes.maskingIcon = input.maskingIcon;
      if (
        changes.maskingIcon !== MaskingIcon.NONE &&
        input.secretPassword === undefined
      ) {
        throw new BadRequestException(
          'maskingIcon을 NOTE 또는 CALCU로 변경할 때 secretPassword가 필요합니다.',
        );
      }
    }
    if (input.secretPassword !== undefined) {
      const salt = randomBytes(16).toString('hex');
      const hash = (await deriveKey(input.secretPassword, salt, 64)) as Buffer;
      changes.secretPasswordHash = `scrypt:${salt}:${hash.toString('hex')}`;
    }
    try {
      await this.users.update(id, changes);
    } catch (error) {
      this.rethrow(error);
    }
    return this.profile(id);
  }

  remove(id: string) {
    return this.users.delete(id);
  }

  private rethrow(error: unknown): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    ) {
      throw new ConflictException('이미 사용 중인 email 또는 nickName입니다.');
    }
    throw error;
  }
}
