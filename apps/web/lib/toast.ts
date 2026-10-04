import { toast } from 'sonner';
import { ApiError } from '@/lib/api/core';
import { isPublicPath } from '@/lib/routes';

export function apiErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  if (error.kind === 'network') return 'Can’t reach PokéDrop. Check your connection and try again.';
  if (error.kind === 'contract' || error.statusCode >= 500) {
    return 'Something went wrong on our side. Try again in a moment.';
  }
  if (error.statusCode === 429) return 'Too many requests. Wait a moment and try again.';
  // Better Auth's own 401s (a wrong password) carry a sentence for people; ours mean no session.
  if (error.statusCode === 401 && error.kind === 'api') return 'Sign in to continue.';
  return error.message;
}

export function toastApiError(error: unknown): void {
  // On a protected page a 401 is already on its way to the sign-in page.
  if (error instanceof ApiError && error.statusCode === 401 && !isPublicPath(location.pathname)) {
    return;
  }
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  toast.error(apiErrorMessage(error), requestId ? { description: `Request ID ${requestId}` } : {});
}

type ToastAction = { label: string; onClick: () => void };

export function toastSuccess(message: string, action?: ToastAction): void {
  toast.success(message, action ? { action } : {});
}

export function toastInfo(message: string, action?: ToastAction): void {
  toast.info(message, action ? { action } : {});
}
