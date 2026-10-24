import { api, requireUser } from '@/lib/api';
import NotificationList from '@/components/NotificationList';

export const metadata = { title: 'Notifications · WorkBuddy' };

export default async function NotificationsPage() {
  const [, data] = await Promise.all([requireUser(), api('/api/notifications?limit=50')]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Leave requests and decisions that need your attention or that you should know about.</p>
        </div>
      </div>

      <div className="stack">
        <NotificationList items={data.items} unreadCount={data.unreadCount} />
      </div>
    </>
  );
}
