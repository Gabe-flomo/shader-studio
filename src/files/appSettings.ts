/**
 * appSettings.ts — the app's own preferences (theme, shortcuts, panel sizes,
 * camera, where things are saved…) as the Files page shows them: a readable
 * name and a category per storage key, instead of the raw key.
 *
 * Known keys are listed here; anything else Shader Studio owns that isn't a
 * saved thing lands under "Other" with a name made from its key. Resetting one
 * removes its key, so the app falls back to its default. Keys marked `data`
 * hold things you made or installed (saved looks, presentation themes,
 * installed node packs, a sign-in): Reset all leaves them, one-by-one reset
 * still offers them.
 *
 * Pure: no storage access. The inventory (inventory.ts) builds the App
 * settings group from it; profile ZIPs and backups carry the keys as before.
 */

export type SettingCategory =
  | 'appearance' | 'studio' | 'play' | 'finish' | 'present' | 'devices' | 'editors' | 'saving' | 'windows' | 'sharing' | 'app' | 'other';

export const SETTING_CATEGORIES: ReadonlyArray<{ id: SettingCategory; label: string }> = [
  { id: 'appearance', label: 'Appearance and keys' },
  { id: 'studio', label: 'Studio' },
  { id: 'play', label: 'Play' },
  { id: 'finish', label: 'Finish and looks' },
  { id: 'present', label: 'Present' },
  { id: 'devices', label: 'Camera, MIDI, OSC and audio' },
  { id: 'editors', label: 'Code editors' },
  { id: 'saving', label: 'Folders and saving' },
  { id: 'windows', label: 'Windows' },
  { id: 'sharing', label: 'Sharing and account' },
  { id: 'app', label: 'App' },
  { id: 'other', label: 'Other' },
];

export interface SettingInfo {
  label: string;
  category: SettingCategory;
  /** What resetting it does, when that isn't obvious. */
  hint?: string;
  /** Holds things you made or installed: left alone by Reset all. */
  data?: boolean;
}

const S = (label: string, category: SettingCategory, extra: Omit<SettingInfo, 'label' | 'category'> = {}): SettingInfo => ({ label, category, ...extra });

/** Exact keys. */
const KNOWN: Record<string, SettingInfo> = {
  // Appearance and keys
  'shader-studio:theme': S('Theme', 'appearance', { hint: 'Light or dark; the default is light' }),
  'shader-studio:settings:theme': S('Theme (older setting)', 'appearance'),
  'shader-studio:shortcuts': S('Keyboard shortcuts', 'appearance', { hint: 'Your changed shortcuts go back to the built-in ones' }),
  // Studio
  'shader-studio:minimap': S('Graph minimap', 'studio'),
  'shader-studio:settings:outline': S('Graph outline', 'studio'),
  'shader-studio:settings:outlinePos': S('Graph outline position', 'studio'),
  'shader-studio:settings:previewAspect': S('Preview shape', 'studio'),
  'shader-studio:settings:libraryOpen': S('Library panel open', 'studio'),
  'shader-studio:settings:recentColors': S('Recent colours', 'studio'),
  'shader-studio:phoneSplit:studio': S('Split view on a phone (Studio)', 'studio'),
  'codePanel_height': S('Code panel height', 'studio'),
  'nodepalette_favorites': S('Favourite nodes', 'studio'),
  'shader-studio:settings:starterRecipesOff': S('Starter recipes turned off', 'studio', { hint: 'Every node with starter recipes offers them again when added' }),
  'playfield:suggestions:strip': S('Suggestions under the selected node', 'studio', { hint: 'Shows the suggestions again' }),
  'playfield:structure:strip': S('Flow strip above the graph', 'studio', { hint: 'Shows the flow strip again' }),
  'playfield:structure:tags': S('Stage tags on cards', 'studio'),
  'playfield:structure:notices': S('Order notices', 'studio', { hint: 'Order notices come back on' }),
  'playfield:structure:dismissed': S('Order notices marked as intended', 'studio', { hint: 'Every graph shows its order notices again' }),
  'playfield:structure:builderStripFolded': S('Builder windows: flow strip folded', 'windows'),
  'playfield:suggestions:learning': S('Suggestions: what they learned from your graphs', 'studio', { hint: 'Reset learning: suggestions forget your graphs and wiring and start again from the examples. Graphs saved before now are not read again; it stays on this device.' }),
  // Play
  'shader-studio:play:split': S('Split view', 'play'),
  'shader-studio:play:panel': S('Open panel', 'play'),
  'shader-studio:play:guides': S('Guides', 'play'),
  'shader-studio:play:folded': S('Folded cards', 'play'),
  'shader-studio:play:drawerHeight': S('Drawer height', 'play'),
  'shader-studio:play:addLayerOpen': S('Add layer list open', 'play'),
  'shader-studio:play:openFolders': S('Open folders', 'play'),
  'shader-studio:play:notesOpen': S('Notes card open', 'play'),
  'shader-studio:play:readers-peak': S('Audio readers: peak hold', 'play'),
  'shader-studio:phoneSplit:play': S('Split view on a phone (Play)', 'play'),
  'shader-studio:performance-rolling': S('Rolling performance takes', 'play', { data: true }),
  // Finish and looks
  'shader-studio:finish-looks': S('Saved looks', 'finish', { data: true }),
  'shader-studio:taste': S('Your taste (what Surprise and Evolve learned you like)', 'studio', { data: true, hint: 'Ratings, picks and the per-stage table; Reset forgets them all' }),
  'shader-studio:finish-presets': S('Finish stack presets', 'finish', { data: true }),
  'shader-studio:finish-effects': S('Your Finish effects', 'finish', { data: true }),
  // Present
  'shader-studio:settings:linkedOpen': S('Opening a linked presentation', 'present', { hint: 'Asks again next time' }),
  'shader-studio:settings:lastPresentation': S('Last open presentation', 'present'),
  'shader-studio-present:themes': S('Presentation themes', 'present', { data: true }),
  // Devices
  'shader-studio:cameraDevice': S('Camera', 'devices'),
  'shader-studio:cameraResolution': S('Camera resolution', 'devices'),
  'shader-studio:midiSound': S('MIDI sound', 'devices'),
  'shader-studio:osc:port': S('OSC port', 'devices'),
  'shader-studio:osc:udpPort': S('OSC UDP port', 'devices'),
  'shader-studio:audio:plugins': S('Audio Unit plugins', 'devices', { hint: 'Every installed plugin is offered again, and none is marked New' }),
  'shader-studio:audio:engine': S('Audio engine output and volume', 'devices', { hint: 'The system output, full volume, not muted' }),
  'shader-studio:settings:keepTrackerModels': S('Keep tracking models on this device', 'devices', { hint: 'Back to on: models are kept in Cache Storage' }),
  'shader-studio:settings:warmupTracker:hands': S('Warm up hand tracking on open', 'devices'),
  'shader-studio:settings:warmupTracker:face': S('Warm up face tracking on open', 'devices'),
  'shader-studio:settings:warmupTracker:pose': S('Warm up body tracking on open', 'devices'),
  'shader-studio:settings:useImageModel': S('Use the image model', 'devices', { hint: 'Back to the default: on once it’s downloaded (always on in the desktop app)' }),
  'shader-studio:settings:imageModelDownloaded': S('Image model downloaded', 'devices', { hint: 'Forgets that it was downloaded; this browser may still keep the files' }),
  'shader-studio:settings:useExplainModel': S('Use the explanation model', 'devices', { hint: 'Back to the default: on once it’s downloaded' }),
  'shader-studio:settings:explainModelDownloaded': S('Explanation model downloaded', 'devices', { hint: 'Forgets that it was downloaded; this browser may still keep the files' }),
  // Code editors
  'shader-studio:glsl-editor': S('GLSL page: the open code', 'editors'),
  'glsl-editor:open-shader': S('GLSL page: the open shader', 'editors'),
  'glsl-editor:groups-open': S('GLSL page: open groups', 'editors'),
  'shader-studio:convert:code': S('Convert: the pasted shader', 'editors'),
  'shader-studio:convert:source': S('Convert: where the shader came from', 'editors'),
  'shader-studio:convert:pane': S('Convert: open pane', 'editors'),
  'shader-studio:convert:optimised': S('Convert: optimised view', 'editors'),
  // Folders and saving
  'shader-studio:settings:recordings': S('Where recordings are saved', 'saving'),
  'shader-studio:settings:backupDir': S('Backup folder', 'saving'),
  'shader-studio:settings:graphDir': S('Graph export folder', 'saving'),
  'shader-studio:settings:groupPresetDir': S('Group preset export folder', 'saving'),
  'shader-studio:settings:exprDir': S('Expression export folder', 'saving'),
  'shader-studio:settings:customFnDir': S('Custom function export folder', 'saving'),
  'shader-studio:settings:filesKeepVersions': S('Clean up: versions to keep', 'saving'),
  'shader-studio:settings:storageLimit': S('Storage limit', 'saving', { hint: 'Back to 10 GB' }),
  'shader-studio:settings:autosave': S('Autosave', 'saving', { hint: 'Back to every 5 minutes' }),
  // Windows
  'playfield:builderWindow': S('Builder window', 'windows'),
  'playfield:history-window': S('History window', 'windows'),
  'playfield:piano-roll-window': S('Piano roll window', 'windows'),
  // Sharing and account
  'shader-studio:settings:trustedAuthors': S('Trusted authors', 'sharing', { data: true }),
  'shader-studio:settings:packAuthor': S('Node pack author name', 'sharing'),
  'shader-studio-nodepacks:installed': S('Installed node packs', 'sharing', { data: true }),
  'playfield:gate-session': S('Sign-in session', 'sharing', { data: true, hint: 'Signs you out' }),
  // App
  'playfield:activity-log': S('Activity log', 'app', { data: true }),
  'playfield:whats-new-seen': S('What’s new: last seen', 'app'),
  'playfield:whats-new-toasted': S('What’s new: last shown', 'app'),
  'shader-studio:session': S('Crash recovery: this session', 'app', { hint: 'The next launch won’t offer to recover this session' }),
  // Not app settings (they stay in the Settings section), named for installs and downloads.
  'shader-studio:kaggle': S('Kaggle sign-in', 'sharing', { data: true }),
  'shader-studio:discover:learned-roles': S('Learned parameter roles', 'other', { data: true }),
  'assetbrowser_folders': S('Folders', 'other', { data: true }),
};

/** Key families (the first match wins). */
const PREFIXES: ReadonlyArray<{ prefix: string; info: (tail: string) => SettingInfo }> = [
  { prefix: 'shader-studio:present:sampleStill:', info: () => S('Sample still (cached picture)', 'present') },
  { prefix: 'shader-studio:finish', info: t => S(`Finish: ${words(t)}`, 'finish') },
  { prefix: 'shader-studio:play:', info: t => S(sentence(t), 'play') },
  { prefix: 'shader-studio:osc:', info: t => S(`OSC ${words(t)}`, 'devices') },
  { prefix: 'shader-studio:midi', info: t => S(`MIDI ${words(t)}`, 'devices') },
  { prefix: 'shader-studio:camera', info: t => S(`Camera ${words(t)}`, 'devices') },
  { prefix: 'shader-studio:convert:', info: t => S(`Convert: ${words(t)}`, 'editors') },
  { prefix: 'glsl-editor:', info: t => S(`GLSL page: ${words(t)}`, 'editors') },
  { prefix: 'shader-studio-present', info: t => S(`Present: ${words(t)}`, 'present') },
  { prefix: 'shader-studio:present:', info: t => S(`Present: ${words(t)}`, 'present') },
];

function words(tail: string): string {
  return tail.replace(/[:_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
}
function sentence(tail: string): string {
  const w = words(tail);
  return w ? w[0].toUpperCase() + w.slice(1) : tail;
}

/** A readable name made from the key: "shader-studio:settings:fooBar" → "Foo bar". */
export function labelFromKey(key: string): string {
  const tail = key.replace(/^shader-studio(-[a-z]+)?:(settings:)?|^playfield:|^glsl-editor:/, '');
  const w = sentence(tail);
  return w || key;
}

/** What a stored preference is: its name, category and whether Reset all leaves it. */
export function describeSetting(key: string): SettingInfo {
  const known = KNOWN[key];
  if (known) return known;
  for (const p of PREFIXES) if (key.startsWith(p.prefix)) return p.info(key.slice(p.prefix.length));
  return S(labelFromKey(key), 'other');
}

/** The readable name of a stored key (installs and downloads list them). */
export const settingLabel = (key: string): string => describeSetting(key).label;

export interface SettingEntry { key: string; size: number }

/** Entries grouped by category, in the categories' order, each sorted by name. Empty categories are left out. */
export function groupSettings<T extends SettingEntry>(entries: T[]): Array<{ id: SettingCategory; label: string; items: Array<T & { info: SettingInfo }> }> {
  const by = new Map<SettingCategory, Array<T & { info: SettingInfo }>>();
  for (const e of entries) {
    const info = describeSetting(e.key);
    const l = by.get(info.category) ?? [];
    l.push({ ...e, info });
    by.set(info.category, l);
  }
  return SETTING_CATEGORIES.filter(c => by.has(c.id)).map(c => ({
    id: c.id, label: c.label,
    items: by.get(c.id)!.sort((a, b) => a.info.label.localeCompare(b.info.label)),
  }));
}

/** The keys Reset all removes: everything except what holds things you made or installed. */
export function resetAllKeys(keys: Iterable<string>): string[] {
  return [...keys].filter(k => !describeSetting(k).data);
}
