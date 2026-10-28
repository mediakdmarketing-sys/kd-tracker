import { api } from '@/lib/api';
import AnnouncementManager from './AnnouncementManager';

export const metadata = { title: 'Announcements · WorkBuddy' };

export default async function AnnouncementsPage() {
  const [me, list] = await Promise.all([api('/api/auth/me'), api('/api/super/announcements')]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Announcements</h1>
          <p>A banner shown at the top of every page for everyone signed in to any company: maintenance, new features.</p>
        </div>
      </div>
      <AnnouncementManager list={list} canEdit={me.platformRole === 'owner'} />
    </>
  );
}
