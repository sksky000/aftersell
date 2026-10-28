import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserRequest,
  type UpdateUserRequest,
  type UserDto,
} from '@aftersell/shared';
import { ZodBody } from '../common/zod-body';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { UsersService } from './users.service';

@Controller('users')
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<UserDto[]> {
    return this.users.list();
  }

  @Post()
  create(@ZodBody(createUserSchema) dto: CreateUserRequest): Promise<UserDto> {
    return this.users.create(dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateUserSchema) dto: UpdateUserRequest,
  ): Promise<UserDto> {
    return this.users.update(actor.id, id, dto);
  }
}
