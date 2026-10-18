/**
 * True while a modal window is open over the app (ui/Modal, ui/Sheet: `aria-modal="true"`). The graph's own keys
 * (Delete removing the selected nodes) wait while one is: the selection is behind it, out of sight, and the window's
 * Delete means something of its own (the Audio Source window's: the selected band).
 */
export const modalOpen = (doc: Pick<Document, 'querySelector'> = document): boolean => !!doc.querySelector('[aria-modal="true"]');
