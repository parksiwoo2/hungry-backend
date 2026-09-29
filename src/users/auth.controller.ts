import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LoginDto, SignupDto } from './dto/users.dto';
import { SessionService } from './session.service';
import { UsersService } from './users.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionService,
  ) {}

  @Post('signup')
  signup(@Body() input: SignupDto) {
    return this.users.create(input);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.users.findByEmail(input.email);
    await this.sessions.create(user.id, request, response);
    return this.users.profile(user.id);
  }

  @Post('logout')
  @HttpCode(204)
  logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.sessions.destroy(request, response);
  }
}
