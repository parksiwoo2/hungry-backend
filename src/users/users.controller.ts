import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Patch,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { UpdateUserDto } from './dto/users.dto';
import { SessionService } from './session.service';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionService,
  ) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  async me(@Req() request: Request) {
    return this.users.profile(await this.sessions.userId(request));
  }

  @Patch('me')
  async update(@Req() request: Request, @Body() input: UpdateUserDto) {
    const id = await this.sessions.userId(request);
    if (!Object.keys(input).length)
      throw new BadRequestException('수정할 필드가 필요합니다.');
    return this.users.update(id, input);
  }

  @Delete('me')
  @HttpCode(204)
  async remove(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.users.remove(await this.sessions.userId(request));
    this.sessions.clear(response);
  }
}
