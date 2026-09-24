import type { FileResult } from '../../utils/fileIO';
import { toast } from '../ui/toastStore';

/**
 * Surface a store file operation's result: an error toast with the reason on failure, an
 * optional success toast, and nothing when the user cancelled. Returns whether it succeeded.
 */
export function reportFileResult(result: FileResult, messages: { failTitle: string; success?: string }): boolean {
  if (result.ok) {
    if (messages.success) toast.success(messages.success);
    return true;
  }
  if (!result.cancelled) toast.error(messages.failTitle, { message: result.error });
  return false;
}
