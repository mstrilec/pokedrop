import type { Metadata } from 'next';
import { NotificationCentre } from '@/components/notifications/notification-centre';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return <NotificationCentre />;
}
