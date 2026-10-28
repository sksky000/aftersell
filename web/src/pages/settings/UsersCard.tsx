import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { KeyRound, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import {
  createUserSchema,
  PASSWORD_MIN_LENGTH,
  ROLE_LABELS,
  ROLES,
  updateUserSchema,
  type Role,
  type UpdateUserRequest,
  type UserDto,
} from '@aftersell/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/auth';
import { api, messageOf } from '@/lib/api';

function RoleSelect({ value, onChange, disabled }: { value: Role; onChange: (r: Role) => void; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)} disabled={disabled}>
      <SelectTrigger className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            {ROLE_LABELS[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function UsersCard() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<UserDto | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await api.get<UserDto[]>('/users'));
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (u: UserDto, patch: UpdateUserRequest) => {
    const parsed = updateUserSchema.safeParse(patch);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? '请检查输入');
      return false;
    }
    try {
      const next = await api.patch<UserDto>(`/users/${u.id}`, parsed.data);
      setUsers((list) => list.map((x) => (x.id === next.id ? next : x)));
      return true;
    } catch (err) {
      toast.error(messageOf(err));
      return false;
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>用户</CardTitle>
          <CardDescription className="mt-1.5">
            客服：处理邮件；主管：另可查看配置；管理员：另可修改邮箱配置、管理用户。新用户和重置密码的用户首次登录须改密。
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <UserPlus className="size-4" /> 新建用户
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Spinner className="size-4" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>姓名</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>启用</TableHead>
                <TableHead>最近登录</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const self = u.id === me?.id;
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      {u.name}
                      {u.mustChangePassword && (
                        <Badge variant="outline" className="ml-2">
                          待改密
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <RoleSelect value={u.role} disabled={self} onChange={(role) => void update(u, { role })} />
                    </TableCell>
                    <TableCell>
                      <Switch checked={u.isActive} disabled={self} onCheckedChange={(isActive) => void update(u, { isActive })} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-CN') : '—'}
                    </TableCell>
                    <TableCell>
                      {!self && (
                        <Button variant="ghost" size="sm" onClick={() => setResetting(u)}>
                          <KeyRound className="size-4" /> 重置密码
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <CreateUserDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(u) => {
          setUsers((list) => [...list, u]);
          setCreating(false);
        }}
      />
      <ResetPasswordDialog
        user={resetting}
        onClose={() => setResetting(null)}
        onSubmit={async (password) => {
          if (resetting && (await update(resetting, { password }))) {
            toast.success('密码已重置，请把新密码告知对方，对方登录后须修改');
            setResetting(null);
          }
        }}
      />
    </Card>
  );
}

function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (u: UserDto) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('agent');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setRole('agent');
      setPassword('');
    }
  }, [open]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = createUserSchema.safeParse({ name, email, role, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? '请检查输入');
      return;
    }
    setSubmitting(true);
    try {
      onCreated(await api.post<UserDto>('/users', parsed.data));
      toast.success('用户已创建，请把初始密码告知对方');
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建用户</DialogTitle>
        </DialogHeader>
        <form id="create-user" className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
          <div className="space-y-2">
            <Label htmlFor="cu-name">姓名</Label>
            <Input id="cu-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cu-email">登录邮箱</Label>
            <Input id="cu-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>角色</Label>
            <RoleSelect value={role} onChange={setRole} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cu-pw">初始密码（至少 {PASSWORD_MIN_LENGTH} 位）</Label>
            <Input id="cu-pw" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="create-user" disabled={submitting}>
            {submitting && <Spinner className="size-4" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
  onSubmit,
}: {
  user: UserDto | null;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => setPassword(''), [user]);

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重置 {user?.name} 的密码</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rp-pw">新密码（至少 {PASSWORD_MIN_LENGTH} 位）</Label>
          <Input id="rp-pw" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="text-xs text-muted-foreground">重置后对方所有设备上的登录立即失效。</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              await onSubmit(password);
              setSubmitting(false);
            }}
          >
            {submitting && <Spinner className="size-4" />}
            重置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
