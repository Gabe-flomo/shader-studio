/**
 * liveSendNames.ts — the names of Live sends (Playfield Send instances), for code that must stay
 * light (play/readerControls.ts names its control group "Audio readers · Live · Drums"). lib/liveSend.ts
 * keeps this up to date; with nothing known an ID reads as "Send 4821".
 */

/** The reader input for a send: `send:<id>`. */
export const sendReaderInput = (id: number): string => `send:${id}`;

/** The Pairing ID a reader input listens to, or null. */
export function sendIdOfInput(input: string): number | null {
  const m = /^send:(\d{1,4})$/.exec(input);
  return m ? Number(m[1]) : null;
}

let labelOf: (id: number) => string = id => `Send ${id}`;

/** lib/liveSend.ts registers its naming (track from the Live connector, a name set here, the plug-in's). */
export function setSendLabeller(fn: (id: number) => string): void { labelOf = fn; }

/** "Drums" (or "Send 4821"). */
export function sendLabel(id: number): string { return labelOf(id); }
