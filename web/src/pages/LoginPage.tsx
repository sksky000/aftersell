import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { loginSchema, type FeishuLoginInfo } from '@aftersell/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/auth';
import { api, messageOf } from '@/lib/api';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [params] = useSearchParams();
  // 飞书登录失败时后端带着 ?error= 跳回来
  const [error, setError] = useState<string | null>(params.get('error'));
  const [submitting, setSubmitting] = useState(false);
  const [feishu, setFeishu] = useState(false);

  useEffect(() => {
    api
      .get<FeishuLoginInfo>('/auth/feishu/info')
      .then((r) => setFeishu(r.enabled))
      .catch(() => setFeishu(false));
  }, []);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '请检查输入');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login(parsed.data);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>售后邮件审核台</CardTitle>
          <CardDescription>使用分配给你的账号登录</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <div className="text-sm text-destructive">{error}</div>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Spinner className="size-4" />}
              登录
            </Button>
          </form>
          {feishu && (
            <>
              <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />或<div className="h-px flex-1 bg-border" />
              </div>
              <Button variant="outline" className="w-full" onClick={() => (window.location.href = '/api/auth/feishu/login')}>
                飞书登录
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
