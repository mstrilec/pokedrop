import { UnreadCountSchema } from '@pokedrop/shared';
import { get } from '../core';

export const unreadCount = () => get('/notifications/unread-count', UnreadCountSchema);
