import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import { useAuth } from '@/auth';
import MailConfigCard from './MailConfigCard';
import MailRoutingCard from './MailRoutingCard';
import LlmSettingsCard from './LlmSettingsCard';
import UsersCard from './UsersCard';

export default function SettingsPage() {
  const { can } = useAuth();
  const tabs = [
    can('supervisor') && {
      key: 'mail',
      label: '邮箱',
      content: (
        <div className="space-y-6">
          <MailConfigCard />
          <MailRoutingCard />
        </div>
      ),
    },
    can('supervisor') && { key: 'llm', label: '模型', content: <LlmSettingsCard /> },
    can('admin') && { key: 'users', label: '用户管理', content: <UsersCard /> },
    { key: 'account', label: '我的账号', content: <ChangePasswordForm /> },
  ].filter(Boolean) as { key: string; label: string; content: React.ReactNode }[];
  const [tab, setTab] = useState(tabs[0].key);

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-lg font-semibold mb-6">设置</h1>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-6">
            {t.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
