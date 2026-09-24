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

/** Result toast for "Import a GLSL shader": the node was created and wired, with the converter's notes as the message. */
export function reportGlslImport(result: FileResult & { notes?: string[]; label?: string }): boolean {
  if (!reportFileResult(result, { failTitle: 'Couldn’t import that shader' })) return false;
  toast.success(`“${result.label ?? 'Shader'}” is now a node`, {
    message: result.notes?.length ? result.notes.join(' ') : 'Wired UV → shader → Output. Edit its GLSL from the node’s ✦ button, or add sliders in Builder.',
  });
  return true;
}
