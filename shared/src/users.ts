import { z } from 'zod';
import { passwordSchema } from './auth';

export const ROLES = ['agent', 'supervisor', 'admin'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const ROLE_LABELS: Record<Role, string> = {
  agent: '客服',
  supervisor: '主管',
  admin: '管理员',
};

/** 角色等级：高等级自动拥有低等级的全部权限 */
export const ROLE_RANK: Record<Role, number> = {
  agent: 1,
  supervisor: 2,
  admin: 3,
};

export function hasRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('邮箱格式不正确'),
  name: z.string().trim().min(1, '请输入姓名').max(64),
  role: roleSchema,
  password: passwordSchema,
});
export type CreateUserRequest = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
    /** 管理员重置密码；用户下次登录需修改 */
    password: passwordSchema.optional(),
  })
  .strict();
export type UpdateUserRequest = z.infer<typeof updateUserSchema>;
