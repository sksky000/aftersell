import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { changePasswordSchema, PASSWORD_MIN_LENGTH, type UserDto } from '@aftersell/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/auth';
import { api, messageOf } from '@/lib/api';

export default function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const { setUser } = useAuth();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '请检查输入');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      setUser(await api.post<UserDto>('/auth/change-password', parsed.data));
      setCurrent('');
      setNew('');
      setConfirm('');
      toast.success('密码已修改，其他设备上的登录已失效');
      onDone?.();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-4 max-w-sm" onSubmit={(e) => void onSubmit(e)}>
      <div className="space-y-2">
        <Label htmlFor="cur">当前密码</Label>
        <Input id="cur" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new">新密码（至少 {PASSWORD_MIN_LENGTH} 位）</Label>
        <Input id="new" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">确认新密码</Label>
        <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <Button type="submit" disabled={submitting}>
        {submitting && <Spinner className="size-4" />}
        修改密码
      </Button>
    </form>
  );
}
