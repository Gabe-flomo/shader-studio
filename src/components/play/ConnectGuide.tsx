/**
 * ConnectGuide — first-time setup for getting outside signals into Play:
 * Ableton over MIDI, Ableton over OSC, Ableton's sound as live audio, and a
 * hardware MIDI controller. Step-by-step for macOS and Windows. The same text
 * lives in docs/connecting-ableton.md.
 */
import { useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Modal } from '../ui/Modal';
import { Segmented } from '../ui/Choice';
import { Button } from '../ui/Button';
import { toast } from '../ui/toastStore';

type Topic = 'which' | 'midi' | 'osc' | 'audio' | 'controller';
type Platform = 'mac' | 'win';

const isDesktopApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function ConnectGuide({ onClose }: { onClose: () => void }) {
  const [topic, setTopic] = useState<Topic>('which');
  const [os, setOs] = useState<Platform>(isMac ? 'mac' : 'win');
  return (
    <Modal title="Connect your gear" subtitle="Ableton, a MIDI controller, OSC or live audio, step by step" icon="bidir" onClose={onClose} width={660} height={660}>
      <div style={{ padding: '12px 20px 20px' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <Segmented
          size="sm"
          ariaLabel="Topic"
          value={topic}
          onChange={setTopic}
          options={[
            { value: 'which', label: 'Which one?' },
            { value: 'midi', label: 'Ableton · MIDI' },
            { value: 'osc', label: 'Ableton · OSC' },
            { value: 'audio', label: 'Ableton · Audio' },
            { value: 'controller', label: 'Controller' },
          ]}
        />
        <span style={{ flex: 1 }} />
        {topic !== 'which' && <Segmented size="sm" ariaLabel="Computer" value={os} onChange={setOs} options={[{ value: 'mac', label: 'Mac' }, { value: 'win', label: 'Windows' }]} />}
      </div>
      {topic === 'which' && <Which onPick={setTopic} />}
      {topic === 'midi' && <AbletonMidi os={os} />}
      {topic === 'osc' && <AbletonOsc os={os} />}
      {topic === 'audio' && <AbletonAudio os={os} />}
      {topic === 'controller' && <Controller os={os} />}
      </div>
    </Modal>
  );
}

// ── Building blocks ──────────────────────────────────────────────────────────

function P({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <p style={{ margin: '0 0 10px', color: tk.text.secondary, font: `13px/1.55 ${fontFamily.ui}` }}>{children}</p>;
}

function Steps({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <ol style={{ margin: '0 0 12px', paddingLeft: 22, color: tk.text.secondary, font: `13px/1.6 ${fontFamily.ui}`, display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</ol>;
}

function H({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <div style={{ margin: '14px 0 6px', color: tk.text.primary, font: `650 13px ${fontFamily.ui}` }}>{children}</div>;
}

function B({ children }: { children: ReactNode }) {
  return <b style={{ fontWeight: 650 }}>{children}</b>;
}

function Code({ children }: { children: string }) {
  const tk = useTokens();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle' }}>
      <code style={{ padding: '1px 6px', borderRadius: 5, background: tk.bg.field, color: tk.text.primary, font: `12px ${fontFamily.mono}` }}>{children}</code>
      <Button size="sm" variant="ghost" style={{ height: 22, padding: '0 6px', fontSize: 11 }} onClick={() => { void navigator.clipboard?.writeText(children).then(() => toast.success('Copied')); }}>Copy</Button>
    </span>
  );
}

function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const tk = useTokens();
  const c = tone === 'warn' ? tk.status.warning : tk.accent.base;
  return <div style={{ margin: '8px 0 12px', padding: '8px 12px', borderRadius: radius.md, background: alpha(c, 0.1), color: tone === 'warn' ? tk.status.warningText : tk.accent.text, font: `12.5px/1.5 ${fontFamily.ui}` }}>{children}</div>;
}

function InShaderStudio({ children }: { children: ReactNode }) {
  return (
    <>
      <H>In Playfield</H>
      <Steps>{children}</Steps>
    </>
  );
}

// ── Topics ───────────────────────────────────────────────────────────────────

function Which({ onPick }: { onPick: (t: Topic) => void }) {
  const tk = useTokens();
  const row = (t: Topic, title: string, what: string, best: string, needs: string) => (
    <button type="button" onClick={() => onPick(t)} style={{ textAlign: 'left', border: 0, cursor: 'pointer', padding: '10px 12px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ color: tk.text.primary, font: `650 13px ${fontFamily.ui}` }}>{title}</span>
      <span style={{ color: tk.text.secondary, font: `12.5px/1.5 ${fontFamily.ui}` }}><b>Sends:</b> {what}</span>
      <span style={{ color: tk.text.secondary, font: `12.5px/1.5 ${fontFamily.ui}` }}><b>Best for:</b> {best}</span>
      <span style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>Needs: {needs}</span>
    </button>
  );
  return (
    <>
      <P>MIDI, OSC and audio carry different things. MIDI is notes and knobs, not sound. Audio is the sound itself, turned into loudness per band. You can use all three at once.</P>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {row('midi', 'Ableton → MIDI', 'notes (which, how hard), knobs as CC 0–127, pitch bend', 'hitting notes to fire envelopes; drawing CC automation', 'a free virtual MIDI port (built into macOS; loopMIDI on Windows), Chrome or Edge')}
        {row('osc', 'Ableton → OSC', 'any number from any knob or fader in Live, at full resolution', 'mapping many Live parameters, smooth sweeps, TouchOSC on a phone', isDesktopApp ? 'Max for Live (Suite) with the free Connection Kit; the app listens with one click' : 'Max for Live (Suite) with the free Connection Kit, and the small bridge (one download, one command)')}
        {row('audio', 'Ableton → Audio', 'the actual sound: level, bass, low-mid, high-mid, treble, plus hits', 'visuals that react to the music; kick-driven flashes', 'a free virtual audio cable (BlackHole on Mac, VB-CABLE on Windows), or just a microphone')}
        {row('controller', 'A MIDI controller', 'the keys, knobs and pads of any USB MIDI controller', 'playing the visuals by hand', 'Chrome or Edge; no Ableton needed')}
      </div>
    </>
  );
}

function AbletonMidi({ os }: { os: Platform }) {
  return (
    <>
      <P>Ableton sends MIDI to a <B>virtual MIDI port</B>, a cable that exists only in software. Playfield listens to that port. Nothing needs to be plugged in.</P>
      <H>1 · Make the virtual port</H>
      {os === 'mac' ? (
        <Steps>
          <li>Open <B>Audio MIDI Setup</B> (Applications → Utilities).</li>
          <li>Menu <B>Window → Show MIDI Studio</B>.</li>
          <li>Double-click <B>IAC Driver</B>, tick <B>Device is online</B>, click Apply. You now have a port called <B>IAC Driver Bus 1</B>.</li>
        </Steps>
      ) : (
        <Steps>
          <li>Install <B>loopMIDI</B> (free, by Tobias Erichsen: tobias-erichsen.de/software/loopmidi.html).</li>
          <li>Open it and click <B>+</B>. A port called <B>loopMIDI Port</B> appears. Leave loopMIDI running.</li>
        </Steps>
      )}
      <H>2 · Send MIDI out of Ableton</H>
      <Steps>
        <li>Ableton → <B>Settings</B> (Preferences in older versions) → <B>Link, Tempo &amp; MIDI</B>.</li>
        <li>Under <B>MIDI Ports</B>, find <B>Out: {os === 'mac' ? 'IAC Driver (Bus 1)' : 'loopMIDI Port'}</B> and switch <B>Track</B> on.</li>
        <li>Make a <B>MIDI track</B>. In its I/O section set <B>MIDI To</B> to <B>{os === 'mac' ? 'IAC Driver (Bus 1)' : 'loopMIDI Port'}</B> and the channel to <B>Ch. 1</B>.</li>
        <li>Put a MIDI clip on it and press play: its notes now go to Playfield. To play live through Ableton, record-arm the track (or set Monitor to In).</li>
        <li><B>Knobs:</B> in the clip, open <B>Envelopes</B>, pick <B>MIDI Ctrl</B> and a controller (e.g. 1-Modulation), and draw a curve. That sends CC 1.</li>
      </Steps>
      <Note>A track sending to the virtual port has no instrument, so it's silent. To hear the part as well, make a second MIDI track with an instrument, set its <B>MIDI From</B> to the first track and its Monitor to <B>In</B>.</Note>
      <InShaderStudio>
        <li>Open Playfield in <B>Chrome or Edge</B>. Safari has no Web MIDI. Firefox asks you to install a site permission first.</li>
        <li>Play page → Mappings → <B>Learn</B>, then play a note or move the CC in Ableton. The browser asks to use MIDI devices: allow.</li>
        <li>A note gives a velocity source. For a hit that fades, choose source <B>Trigger</B>, then <B>On: MIDI note</B>, press the row's Learn and hit the note, and pick <B>Envelope</B>.</li>
        <li>Keep tempo in step with a <B>Clock</B> source (or Trigger → Beat) at Ableton's BPM. MIDI clock sync isn't supported yet.</li>
      </InShaderStudio>
    </>
  );
}

function AbletonOsc({ os }: { os: Platform }) {
  return (
    <>
      <P>OSC sends plain numbers over the network, so any knob in Live can drive any control at full resolution.</P>
      <H>1 · Let Playfield listen</H>
      {isDesktopApp ? (
        <Steps>
          <li>In the desktop app there's nothing to install. On an OSC mapping row, click <B>Start listening</B>. The app now takes OSC on <B>UDP port 9000</B>.</li>
          <li>Sending from a phone? Tick <B>Phones too</B> so other devices on your network can reach it.</li>
        </Steps>
      ) : (
        <Steps>
          <li>Browsers can't receive OSC themselves, so a tiny <B>bridge</B> passes it on. (The desktop app doesn't need one: it has a Start listening button.)</li>
          <li>Install <B>Node.js</B> 18 or newer (nodejs.org) if you don't have it.</li>
          <li>On an OSC mapping row, click <B>Download bridge</B>. Then open Terminal (Mac) or PowerShell (Windows) in the folder it saved to and run <Code>node shader-studio-osc-bridge.mjs</Code>. Working from the shader-studio source instead? <Code>npm run osc-bridge</Code> does the same.</li>
          <li>Leave it running. It listens for OSC on <B>port 9000</B>, and the row's dot turns green. Add <Code>--verbose</Code> to see every message.</li>
        </Steps>
      )}
      <H>2 · Send OSC from Ableton</H>
      <Steps>
        <li>You need <B>Max for Live</B> (included in Suite) and Ableton's free <B>Connection Kit</B> pack (Live's Browser → Packs; install it from ableton.com/packs if it's missing).</li>
        <li>Drag <B>OSC Send</B> from Connection Kit onto any track.</li>
        <li>Set the host to <B>127.0.0.1</B> and the port to <B>9000</B>.</li>
        <li>On a row, click <B>Map</B>, then click the knob or fader in Live you want to send. Give the row a short name: that becomes its OSC address.</li>
      </Steps>
      <Note>Labels differ a little between Live versions. What matters is the host 127.0.0.1, the port 9000, and a mapped parameter.</Note>
      <H>From a phone instead (TouchOSC and similar)</H>
      <Steps>
        <li>{isDesktopApp ? <>Tick <B>Phones too</B> on the OSC row.</> : <>Start the bridge with <Code>node shader-studio-osc-bridge.mjs --lan</Code> so it accepts other devices.</>}</li>
        <li>Find your computer's address: {os === 'mac' ? <Code>ipconfig getifaddr en0</Code> : <>run <Code>ipconfig</Code> and read <B>IPv4 Address</B></>}.</li>
        <li>In the app, set the OSC host to that address and the send port to <B>9000</B>.</li>
      </Steps>
      <InShaderStudio>
        <li>Add a mapping and set its source to <B>OSC</B>. The dot turns green when {isDesktopApp ? 'the app is listening' : 'the bridge is connected (click Connect if it isn’t)'}.</li>
        <li>Press the row's <B>Learn</B> and move the knob in Ableton: the address fills in by itself.</li>
        <li>Ableton sends 0–1, which is the default range. For other senders, set the two numbers to their minimum and maximum.</li>
        <li>For a button, choose <B>Trigger</B> → <B>On: OSC message</B>: a value above 0.5 is a press.</li>
      </InShaderStudio>
    </>
  );
}

function AbletonAudio({ os }: { os: Platform }) {
  return (
    <>
      <P>To make the visuals react to the <B>sound</B> itself, send Ableton's output into a <B>virtual audio cable</B> and let Playfield listen to it like a microphone. Playfield only analyses it and never plays it, so there's no echo.</P>
      <H>1 · Install a virtual audio cable</H>
      {os === 'mac' ? (
        <Steps>
          <li>Install <B>BlackHole 2ch</B> (free: existential.audio/blackhole, or <Code>brew install blackhole-2ch</Code>).</li>
          <li>So you can still hear the music: open <B>Audio MIDI Setup</B>, click <B>+</B> at the bottom left, choose <B>Create Multi-Output Device</B>, and tick your speakers or headphones and <B>BlackHole 2ch</B>. Turn on <B>Drift Correction</B> for BlackHole.</li>
        </Steps>
      ) : (
        <Steps>
          <li>Install <B>VB-CABLE</B> (free: vb-audio.com/Cable) and restart.</li>
          <li>So you can still hear the music: Windows Sound settings → <B>More sound settings</B> → <B>Recording</B> → <B>CABLE Output</B> → Properties → <B>Listen</B>. Tick <B>Listen to this device</B> and choose your speakers or headphones.</li>
        </Steps>
      )}
      <H>2 · Point Ableton at it</H>
      <Steps>
        {os === 'mac' ? (
          <li>Ableton → Settings → <B>Audio</B> → <B>Audio Output Device</B>: choose the <B>Multi-Output Device</B>.</li>
        ) : (
          <>
            <li>Ableton → Settings → <B>Audio</B> → <B>Driver Type</B>: <B>MME/DirectX</B>. With ASIO, Ableton can only use your interface.</li>
            <li><B>Audio Output Device</B>: <B>CABLE Input</B>.</li>
          </>
        )}
        <li>Play something. It still comes out of your speakers.</li>
      </Steps>
      <InShaderStudio>
        <li>Add a mapping and set its source to <B>Live audio in</B>. Click <B>Listen</B> and allow the microphone. Browsers ask this for any audio input, including a virtual cable.</li>
        <li>In the input menu next to the dot, choose <B>{os === 'mac' ? 'BlackHole 2ch' : 'CABLE Output'}</B>.</li>
        <li>Pick a band: <B>Level</B> (overall loudness), <B>Bass</B> (kick, bass line), <B>Low-mid</B>, <B>High-mid</B>, or <B>Treble</B> (hats, air). Turn <B>gain</B> up if it barely moves.</li>
        <li>For flashes on the kick, choose <B>Trigger</B> → <B>On: Audio hit</B> → band <B>Bass</B> → mode <B>Envelope</B>. Nudge the threshold until it fires on the kick only.</li>
      </InShaderStudio>
      <Note>No extra software? Pick your <B>microphone</B> as the input and point it at your speakers. It works, just less cleanly. Expect about 20–50 ms of delay either way.</Note>
      <Note tone="warn">The Audio Input <B>node</B> in the Studio plays sound files. Live input lives here on the Play page for now.</Note>
    </>
  );
}

function Controller({ os }: { os: Platform }) {
  return (
    <>
      <P>Any class-compliant USB MIDI controller (keys, pads, knob boxes) works directly. You don't need Ableton.</P>
      <InShaderStudio>
        <li>Plug the controller in, then open Playfield in <B>Chrome or Edge</B>.</li>
        <li>Play page → Mappings → <B>Learn</B>, then turn a knob or hit a pad. Allow MIDI when the browser asks.</li>
        <li>Knobs give CC sources, keys give velocity, the wheel gives pitch bend. For pads, use <B>Trigger</B> → <B>On: MIDI note</B> with an <B>Envelope</B>, <B>Toggle</B> or <B>Step</B>.</li>
        <li>No controller handy? Add a <B>MIDI Input</B> node in the Studio and turn on its keyboard stand-in: two octaves on your QWERTY keys.</li>
      </InShaderStudio>
      {os === 'win' ? (
        <Note tone="warn">On Windows, some controller drivers let only one app use the device. If Learn hears nothing while Ableton is open, turn off that controller's Track and Remote switches in Ableton's MIDI settings, or close Ableton.</Note>
      ) : (
        <Note>On a Mac, Ableton and the browser can share a controller at the same time.</Note>
      )}
    </>
  );
}
