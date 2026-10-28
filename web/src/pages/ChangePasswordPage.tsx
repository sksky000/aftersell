import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import { useAuth } from '@/auth';

/** 初始密码 / 管理员重置后的强制改密页 */
export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>请先修改密码</CardTitle>
          <CardDescription>这是初始密码或管理员重置过的密码，修改后才能继续使用。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChangePasswordForm onDone={() => navigate('/', { replace: true })} />
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => void logout()}>
            退出登录
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
