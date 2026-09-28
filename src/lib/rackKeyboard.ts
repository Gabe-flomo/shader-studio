/**
 * rackKeyboard.ts — the computer keyboard playing one Audio engine rack, the
 * way a DAW's musical typing does (docs/audio-engine.md, "Computer keyboard").
 *
 * The record says which rack has it (`rack.keyboard`, at most one; the
 * card's toggle turns the others off). The host (lib/audioEngineHost.ts)
 * passes that rack here whenever the record changes, and while the Play page
 * shows, this module takes the keyboard (lib/keyboardClaim.ts): every plain
 * key is swallowed before the app's shortcuts and the Play page's key
 * mappings see it; ⌘/⌃/⌥ combos and typing in fields are left alone.
 *
 *   A W S E D F T G Y H U J K O L P ; '   C C# D D# E F F# G G# A A# B C C# D D# E F (from the octave)
 *   Z / X   octave down / up      C / V   velocity down / up     Shift   sustain
 *   Esc     gives the keyboard back
 *
 * Notes go through the host's `input` (so a take records them). It lets go
 * of the keyboard when the rack is removed, the page leaves Play, Esc is
 * pressed or the top bar's pill is clicked: those write `keyboard: false`
 * into the record through `release`, so the toggle on the card follows.
 */
import { create } from 'zustand';
import { claimKeyboard, isTypingTarget, releaseKeyboardClaim } from './keyboardClaim';

/** Semitones from the octave's C, per key code (Ableton's layout, with the upper row's extras). */
export const RACK_KEYS: Readonly<Record<string, number>> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15,
  Semicolon: 16, Quote: 17,
};
export const RACK_KEYBOARD_HINT = 'A–K white keys from C, W E T Y U black; O L P ; \' carry on. Z/X octave, C/V velocity, Shift sustain, Esc gives the keyboard back.';

const VELOCITY_STEP = 16;

export interface RackKeyboardUi {
  /** The rack playing from the keyboard now ('' for none). */
  rackId: string;
  rackName: string;
  /** Octave of the A key's C: 4 → C4 (60). */
  octave: number;
  /** 1..127 for the next note. */
  velocity: number;
  /** Shift held: released keys keep sounding until Shift goes up. */
  sustain: boolean;
  /** Notes sounding now (for the card's keys). */
  held: number[];
}

export const useRackKeyboard = create<RackKeyboardUi>(() => ({ rackId: '', rackName: '', octave: 4, velocity: 100, sustain: false, held: [] }));

/** What a key press needs to look like here (a KeyboardEvent, or a plain object in tests). */
export interface KeyLike {
  code: string;
  key?: string;
  repeat?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
  preventDefault(): void;
  stopImmediatePropagation?(): void;
  stopPropagation?(): void;
}

export class RackKeyboard {
  private send: (rackId: string, bytes: number[]) => void = () => {};
  private release: (rackId: string) => void = () => {};
  private onPage = false;
  private listening = false;
  private target = { id: '', name: '' };
  /** The rack id the keyboard claim is held under ('' while not listening). */
  private claimed = '';
  /** key code → note sounding for it. */
  private down = new Map<string, number>();
  /** Notes whose keys are up but Shift holds. */
  private sustained = new Set<number>();
  private octave = 4;
  private velocity = 100;

  /** The host wires `send` (notes to a rack); the app wires `release` (writes keyboard: false into the record). */
  configure(o: { send?: (rackId: string, bytes: number[]) => void; release?: (rackId: string) => void }): void {
    if (o.send) this.send = o.send;
    if (o.release) this.release = o.release;
  }

  /** The rack the record gives the keyboard to ('' for none), from the host whenever the record changes. */
  setTarget(rackId: string, rackName = ''): void {
    if (rackId === this.target.id && rackName === this.target.name) return;
    if (rackId !== this.target.id) this.silence();
    this.target = { id: rackId, name: rackName };
    this.sync();
  }

  /** The Play page is showing. Leaving it gives the keyboard back (and says so in the record). */
  setPage(on: boolean): void {
    if (on === this.onPage) return;
    this.onPage = on;
    if (!on && this.target.id) this.release(this.target.id);
    this.sync();
  }

  /** Which rack plays from the keyboard right now ('' for none). */
  active(): string {
    return this.listening ? this.target.id : '';
  }

  /** Esc, or the top bar's pill: let go of the notes and the keyboard, and tell the record. */
  releaseNow(): void {
    const id = this.target.id;
    this.silence();
    this.target = { id: '', name: '' };
    this.sync();
    if (id) this.release(id);
  }

  setOctave(o: number): void { this.octave = Math.max(0, Math.min(8, Math.round(o))); this.publish(); }
  setVelocity(v: number): void { this.velocity = Math.max(1, Math.min(127, Math.round(v))); this.publish(); }

  private sync(): void {
    const want = this.onPage && !!this.target.id;
    if (want && !this.listening) {
      this.listening = true;
      if (typeof window !== 'undefined') {
        window.addEventListener('keydown', this.onKeyDown, true);
        window.addEventListener('keyup', this.onKeyUp, true);
        window.addEventListener('blur', this.onBlur);
      }
    } else if (!want && this.listening) {
      this.listening = false;
      this.silence();
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', this.onKeyDown, true);
        window.removeEventListener('keyup', this.onKeyUp, true);
        window.removeEventListener('blur', this.onBlur);
      }
    }
    // The claim follows the rack that listens (and goes when none does).
    const claim = this.listening ? this.target.id : '';
    if (claim !== this.claimed) {
      if (this.claimed) releaseKeyboardClaim(this.claimed);
      if (claim) claimKeyboard(claim);
      this.claimed = claim;
    }
    this.publish();
  }

  private publish(): void {
    const on = this.listening;
    useRackKeyboard.setState({
      rackId: on ? this.target.id : '',
      rackName: on ? this.target.name : '',
      octave: this.octave,
      velocity: this.velocity,
      sustain: on && this.sustaining,
      held: on ? [...new Set([...this.down.values(), ...this.sustained])].sort((a, b) => a - b) : [],
    });
  }

  private sustaining = false;

  /** Every note off (keys let go, the rack changing, leaving). */
  private silence(): void {
    const id = this.target.id;
    for (const note of new Set([...this.down.values(), ...this.sustained])) if (id) this.send(id, [0x80, note, 0]);
    this.down.clear();
    this.sustained.clear();
    this.sustaining = false;
    this.publish();
  }

  private consume(e: KeyLike): void {
    e.preventDefault();
    // Later listeners on window (the shortcuts, the Play engine) never see it.
    if (e.stopImmediatePropagation) e.stopImmediatePropagation(); else e.stopPropagation?.();
  }

  /** A key going down while the rack has the keyboard (public for tests). */
  handleKeyDown(e: KeyLike): void {
    if (!this.listening || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
    if (e.code === 'Escape') { this.consume(e); this.releaseNow(); return; }
    if (e.code === 'Tab') return; // keyboard access to the page stays
    this.consume(e);
    if (e.repeat) return;
    switch (e.code) {
      case 'ShiftLeft': case 'ShiftRight': this.sustaining = true; this.publish(); return;
      case 'KeyZ': this.setOctave(this.octave - 1); return;
      case 'KeyX': this.setOctave(this.octave + 1); return;
      case 'KeyC': this.setVelocity(this.velocity - VELOCITY_STEP); return;
      case 'KeyV': this.setVelocity(this.velocity + VELOCITY_STEP); return;
    }
    const offset = RACK_KEYS[e.code];
    if (offset === undefined || this.down.has(e.code)) return;
    const note = (this.octave + 1) * 12 + offset;
    if (note > 127) return;
    // The same note from another key (or sustained): sound it again cleanly.
    if (this.sustained.has(note)) { this.sustained.delete(note); this.send(this.target.id, [0x80, note, 0]); }
    this.down.set(e.code, note);
    this.send(this.target.id, [0x90, note, this.velocity]);
    this.publish();
  }

  handleKeyUp(e: KeyLike): void {
    if (!this.listening) return;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.sustaining = false;
      for (const note of this.sustained) this.send(this.target.id, [0x80, note, 0]);
      this.sustained.clear();
      this.publish();
      return;
    }
    const note = this.down.get(e.code);
    if (note === undefined) return;
    this.consume(e);
    this.down.delete(e.code);
    if (this.sustaining) this.sustained.add(note);
    else if (![...this.down.values()].includes(note)) this.send(this.target.id, [0x80, note, 0]);
    this.publish();
  }

  private onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private onKeyUp = (e: KeyboardEvent) => this.handleKeyUp(e);
  private onBlur = () => { this.silence(); };

  /** For tests: forget everything. */
  resetForTests(): void {
    this.setPage(false);
    this.target = { id: '', name: '' };
    this.sync();
    this.octave = 4; this.velocity = 100;
    this.send = () => {}; this.release = () => {};
    this.publish();
  }
}

export const rackKeyboard = new RackKeyboard();
