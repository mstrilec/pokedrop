import {
  MarkAllReadSchema,
  type NotificationListQuerySchema,
  NotificationPageSchema,
  UnreadCountSchema,
} from '@pokedrop/shared';
import { z } from 'zod';
import { get, patch } from '../core';

export type NotificationParams = z.input<typeof NotificationListQuerySchema>;

export const unreadCount = () => get('/notifications/unread-count', UnreadCountSchema);

export const notifications = (params: NotificationParams = {}) =>
  get('/notifications', NotificationPageSchema, params);

/** 204, no body. */
export const markNotificationRead = (id: string) =>
  patch(`/notifications/${id}/read`, z.undefined());

export const markAllNotificationsRead = () => patch('/notifications/read-all', MarkAllReadSchema);
