/**
 * ThemeSettings — the Style panel's Theme section (types/presentTheme.ts has
 * the model): the built-in themes and yours as small live previews, light or
 * dark, then the settings a theme decides and you can change (colours,
 * corners, column width, spacing), each with a way back to the theme's, and
 * "Save as my theme" (present/userThemes.ts). Fonts and text size are in the
 * Typography section below, which resets to the theme's the same way.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useThemeStore, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { ColorSwatch } from '../ui/ColorPicker';
import { Icon } from '../ui/Icon';
import { RulerSlider } from '../ui/RulerSlider';
import { askText } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import {
  COLUMN_RANGE, fromHex, RADIUS_RANGE, SPACING_RANGE, THEME_COLOUR_LABELS, THEME_IDS, THEMES, themeChanged, themeLook,
  type PresentTheme, type ThemeColourKey, type ThemeLook, type ThemeMode,
} from '../../types/presentTheme';
import { fontStack, type PresentTypography, type RGB } from '../../types/presentationStyle';
import { deleteUserTheme, freeThemeName, listUserThemes, saveUserTheme, USER_THEMES_CHANGED, type UserTheme } from '../../present/userThemes';
import { Row, Section } from './InspectorParts';
import { usePresentTheme } from './presentLook';
import { usePresentation } from './presentationStore';
import { applyUserTheme, patchTheme, pickTheme, resetAllToTheme } from './styleActions';

function useUserThemes(): UserTheme[] {
  const [list, setList] = useState<UserTheme[]>(listUserThemes);
  useEffect(() => {
    const read = () => setList(listUserThemes());
    window.addEventListener(USER_THEMES_CHANGED, read);
    window.addEventListener('storage', read);
    return () => { window.removeEventListener(USER_THEMES_CHANGED, read); window.removeEventListener('storage', read); };
  }, []);
  return list;
}

/** A tiny page in a theme: a nav line, a headline in its heading font, text, a card and a button. */
function ThemePreview({ look, typography }: { look: ThemeLook; typography?: PresentTypography }) {
  const p = look.palette, s = look.spec;
  const heading = typography?.heading ? fontStack(typography.heading) : s.headingFont;
  const body = typography?.body ? fontStack(typography.body) : s.bodyFont;
  const bar = (w: string, c: string, h = 3): CSSProperties => ({ display: 'block', width: w, height: h, borderRadius: 2, background: c });
  return (
    <span aria-hidden style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 5, height: 78, padding: '8px 9px', borderRadius: 7, overflow: 'hidden', background: p.background, boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.1)}`, textAlign: 'left' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {s.number === 'pill'
          ? <span style={{ padding: '1px 5px', borderRadius: 99, background: p.wash, color: p.heading, font: `700 6px ${body}`, letterSpacing: '0.08em' }}>01</span>
          : <span style={{ color: s.number === 'meta' ? p.muted : p.accent, font: `700 6.5px ${body}` }}>{s.number === 'meta' ? 'Step 1 of 6' : '01 / 06'}</span>}
      </span>
      <span style={{ color: p.heading, font: `${Math.min(800, s.headingWeight)} ${Math.round(13 * Math.min(1.25, s.titleScale))}px/1 ${heading}`, letterSpacing: `${s.tracking}em`, whiteSpace: 'nowrap' }}>Aa Headline</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, width: s.column < 800 ? '64%' : '82%' }}>
        <span style={bar('100%', alpha(p.text, 0.55))} /><span style={bar('78%', alpha(p.text, 0.55))} />
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 'auto' }}>
        <span style={{ width: 22, height: 12, borderRadius: s.button === 'pill' ? 99 : 3, background: p.button }} />
        <span style={{ ...bar('18px', p.link, 2) }} />
      </span>
      <span style={{ position: 'absolute', right: 8, bottom: 8, width: 30, height: 24, borderRadius: Math.max(3, look.radius / 3), background: s.tiles ? p.surface : alpha(p.accent, 0.18), boxShadow: `inset 0 0 0 1px ${alpha(p.text, 0.08)}` }} />
    </span>
  );
}

function ThemeCard({ label, sub, on, look, typography, onPick, onDelete }: {
  label: string; sub?: string; on: boolean; look: ThemeLook; typography?: PresentTypography; onPick: () => void; onDelete?: () => void;
}) {
  const tk = useTokens();
  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      <button type="button" role="radio" aria-checked={on} onClick={onPick} title={look.spec.hint}
        style={{
          display: 'flex', flexDirection: 'column', gap: 5, width: '100%', padding: 4, border: 0, borderRadius: radius.md + 2, cursor: 'pointer', textAlign: 'left',
          background: on ? alpha(tk.accent.base, 0.1) : 'transparent', boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.subtle}`,
        }}>
        <ThemePreview look={look} typography={typography} />
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, padding: '0 3px 2px', minWidth: 0 }}>
          <span style={{ flex: 1, minWidth: 0, color: on ? tk.text.primary : tk.text.secondary, font: `${on ? 650 : 560} 11.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          {sub && <span style={{ color: tk.text.faint, font: `500 10.5px ${fontFamily.ui}`, flexShrink: 0 }}>{sub}</span>}
        </span>
      </button>
      {onDelete && (
        <IconButton icon="close" size="sm" label={`Delete “${label}”`} onClick={onDelete}
          style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, background: alpha('#0b0b10', 0.55), color: '#fff' }} />
      )}
    </div>
  );
}

/** A reset link for one setting, shown only when it's been changed. */
function ResetTo({ on, onClick, what }: { on: boolean; onClick: () => void; what: string }) {
  const tk = useTokens();
  if (!on) return null;
  return (
    <button type="button" onClick={onClick} title={`Back to the theme’s ${what}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 6px', border: 0, borderRadius: 6, cursor: 'pointer', background: 'transparent', color: tk.accent.text, font: `600 11px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>
      <Icon name="undo" size={11} />Reset to theme
    </button>
  );
}

function ColourSetting({ k, look, theme }: { k: ThemeColourKey; look: ThemeLook; theme: PresentTheme | undefined }) {
  const tk = useTokens();
  const set = theme?.colours?.[k];
  const shown: Record<ThemeColourKey, string> = { background: look.palette.background, surface: look.palette.surface, text: look.palette.text, accent: look.palette.accent, link: look.palette.link };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 30 }}>
      <span style={{ flex: 1, minWidth: 0, color: tk.text.secondary, font: `600 12px ${fontFamily.ui}` }}>{THEME_COLOUR_LABELS[k]}</span>
      <ResetTo on={!!set} what={THEME_COLOUR_LABELS[k].toLowerCase()} onClick={() => patchTheme({ colours: { [k]: undefined } })} />
      <ColorSwatch size="sm" showHex={false} label={THEME_COLOUR_LABELS[k]} value={set ?? fromHex(shown[k])} onChange={c => patchTheme({ colours: { [k]: c as RGB } })} />
    </div>
  );
}

const MODE_OPTIONS: Array<{ value: ThemeMode; label: string; title: string }> = [
  { value: 'light', label: 'Light', title: 'The theme’s light colours' },
  { value: 'dark', label: 'Dark', title: 'The theme’s dark colours' },
  { value: 'auto', label: 'Match', title: 'Light or dark with the app here; in an exported page, with the reader’s system' },
];

export function ThemeSettings({ compact }: { compact: boolean }) {
  const tk = useTokens();
  const theme = usePresentation(s => s.doc?.style?.theme);
  const typography = usePresentation(s => s.doc?.style?.typography);
  const look = usePresentTheme();
  const appDark = useThemeStore(s => s.mode) === 'dark';
  const mine = useUserThemes();
  const id = theme?.id ?? 'classic';
  const spec = THEMES[id];
  const changed = themeChanged(theme) || !!typography;

  const save = async () => {
    const n = await askText('Save as my theme', { label: 'Name', initial: freeThemeName(theme?.saved?.name ?? `My ${spec.label.toLowerCase()}`), confirmLabel: 'Save' });
    if (!n) return;
    try {
      const u = saveUserTheme(n, theme ?? { id: 'classic' }, typography);
      usePresentation.getState().update(p => ({ ...p, style: { ...p.style, theme: { ...(p.style?.theme ?? { id: 'classic' }), saved: { id: u.id, name: u.name } } } }));
      toast.success(`Saved “${u.name}”`, { message: 'It’s with the themes here, for any presentation.' });
    } catch (e) { toast.error('Couldn’t save the theme', { message: e instanceof Error ? e.message : String(e) }); }
  };
  const remove = (u: UserTheme) => {
    const undo = deleteUserTheme(u.id);
    if (undo) toast.info(`Deleted “${u.name}”`, { message: 'Presentations using it keep their look.', action: { label: 'Undo', onClick: undo } });
  };
  const useMine = async (u: UserTheme) => { if (await applyUserTheme(u)) toast.success(`Theme: ${u.name}`); };

  return (
    <Section title="Theme" extra={changed ? <Button size="sm" variant="ghost" icon="undo" onClick={() => void resetAllToTheme()} title="Drop every setting changed by hand: colours, corners, width, spacing, fonts, text size" style={{ height: 24 }}>Reset all</Button> : undefined}>
      <div role="radiogroup" aria-label="Theme" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
        {THEME_IDS.map(t => (
          <ThemeCard key={t} label={THEMES[t].label} on={id === t && !theme?.saved} look={themeLook(id === t ? { id: t, mode: theme?.mode } : { id: t }, appDark)}
            onPick={() => { if (id !== t || theme?.saved || themeChanged(theme)) pickTheme(t); }} />
        ))}
        {mine.map(u => (
          <ThemeCard key={u.id} label={u.name} sub="Yours" on={theme?.saved?.id === u.id} look={themeLook(u.theme, appDark)} typography={u.typography}
            onPick={() => void useMine(u)} onDelete={() => remove(u)} />
        ))}
      </div>
      <div style={{ color: tk.text.faint, font: `500 11.5px/1.45 ${fontFamily.ui}` }}>
        {theme?.saved ? `From your theme “${theme.saved.name}”, on ${spec.label}` : spec.hint}. Backgrounds set per step stay on top.
      </div>
      <Row label="Colours" extra={<ResetTo on={!!theme?.mode} what="light or dark" onClick={() => patchTheme({ mode: undefined })} />}>
        <Segmented fill size="sm" ariaLabel="Light or dark" value={theme?.mode ?? spec.mode} options={MODE_OPTIONS} onChange={m => patchTheme({ mode: m === spec.mode ? undefined : m })} />
      </Row>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {(['background', 'surface', 'text', 'accent', 'link'] as const).map(k => <ColourSetting key={k} k={k} look={look} theme={theme} />)}
      </div>
      <Row label="Corner radius" extra={<><ResetTo on={theme?.radius !== undefined} what="corners" onClick={() => patchTheme({ radius: undefined })} /><Val>{look.radius}px</Val></>}>
        <RulerSlider ariaLabel="Corner radius" value={look.radius} min={RADIUS_RANGE[0]} max={RADIUS_RANGE[1]} step={1} integer defaultValue={spec.radius} touch={compact}
          onChange={v => patchTheme({ radius: Math.round(v) === spec.radius ? undefined : Math.round(v) })} />
      </Row>
      <Row label="Column width" hint="The reading column in Edit and Scroll, and in exported pages. Slides stay at least as wide as they were." extra={<><ResetTo on={theme?.column !== undefined} what="column width" onClick={() => patchTheme({ column: undefined })} /><Val>{look.column}px</Val></>}>
        <RulerSlider ariaLabel="Column width" value={look.column} min={COLUMN_RANGE[0]} max={COLUMN_RANGE[1]} step={10} integer defaultValue={spec.column} touch={compact}
          onChange={v => { const c = Math.round(v / 10) * 10; patchTheme({ column: c === spec.column ? undefined : c }); }} />
      </Row>
      <Row label="Spacing" extra={<><ResetTo on={theme?.spacing !== undefined} what="spacing" onClick={() => patchTheme({ spacing: undefined })} /><Val>{Math.round(look.spacing * 100)}%</Val></>}>
        <RulerSlider ariaLabel="Spacing" value={Math.round(look.spacing * 100)} min={SPACING_RANGE[0] * 100} max={SPACING_RANGE[1] * 100} step={1} integer defaultValue={Math.round(spec.spacing * 100)} touch={compact}
          onChange={v => { const sp = Math.round(v) / 100; patchTheme({ spacing: Math.abs(sp - spec.spacing) < 0.005 ? undefined : sp }); }} />
      </Row>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" icon="save" onClick={() => void save()} title="Keep this theme, its changes and the fonts, to use on any presentation">Save as my theme</Button>
      </div>
    </Section>
  );
}

function Val({ children }: { children: React.ReactNode }) {
  const tk = useTokens();
  return <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}` }}>{children}</span>;
}
