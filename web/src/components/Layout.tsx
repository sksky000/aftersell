import { NavLink, Outlet } from 'react-router-dom';
import { Inbox, LogOut, Settings } from 'lucide-react';
import { ROLE_LABELS } from '@aftersell/shared';
import { useAuth } from '@/auth';

const NAV_ITEMS = [
  { to: '/inbox', label: '邮件看板', icon: Inbox },
  { to: '/settings', label: '设置', icon: Settings },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="w-screen h-screen flex">
      <aside className="w-56 shrink-0 h-full flex flex-col border-r border-border bg-sidebar">
        <div className="px-5 py-5">
          <div className="text-base font-semibold text-foreground">售后邮件审核</div>
          <div className="text-xs text-muted-foreground mt-1">分类 · 审核 · 回复</div>
        </div>
        <nav className="px-2 space-y-1 mt-2 flex-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive ? 'font-medium text-foreground bg-black/5' : 'text-muted-foreground hover:text-foreground'
                }`
              }
            >
              <item.icon className="size-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        {user && (
          <div className="border-t border-border px-4 py-3 text-sm">
            <div className="font-medium truncate">{user.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {user.email} · {ROLE_LABELS[user.role]}
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <LogOut className="size-3.5" /> 退出登录
            </button>
          </div>
        )}
      </aside>
      <main className="flex-1 min-w-0 h-full overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
