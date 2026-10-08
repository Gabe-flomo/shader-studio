/**
 * TastePage — "Your taste" in full (docs/taste.md "The Taste page"), a view of the Files page (reached from
 * Files, App settings and the Do bar's taste panel; lazy-loaded). Everything is local and deterministic.
 *
 *   Profile       a plain-language summary made from the model with templates, by layer (primary, open)
 *   What it learned   likes and dislikes by kind, each with its trace; the stage table; favourite sources;
 *                 how sure; imported learning not on this install
 *   Signal log    every lesson, filterable by kind; an entry opens its item or seed
 *   How things look   the local image model (status, toggle), the liked-look centroids, the most-liked looks
 *   Your steering the context box (parsed into chips), pins, and the dials — kept apart from what was learned
 *   Model internals   the raw weights, counts and constants, a "score this graph" tester, Export / Import / Reset
 */
import { useMemo } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { useTaste } from '../../taste/store';
import { favouriteSources, groupedLikes, KIND_TITLES, modelSureness, summarise } from '../../taste/summary';
import { stageTops } from '../../taste/model';
import { hasSteering, steeringWeights } from '../../taste/steering';
import { logCounts } from '../../taste/log';
import { itemsOf } from '../../taste/portable';
import { Card, Pill, Section, SurePill } from './tasteUi';
import { plural } from './tasteWords';
import { TasteFeatureRow } from './TasteFeatureRow';
import { TasteLogView } from './TasteLogView';
import { TasteSteering } from './TasteSteering';
import { TasteInternals } from './TasteInternals';
import { TasteLooks, useImageModelLine } from './TasteLooks';
import { canOpenRef, openRef } from './tasteNav';

const STAGE_ORDER = ['space', 'field', 'picture', 'light', 'colour', 'post'];

export default function TastePage({ compact = false }: { compact?: boolean }) {
  const tk = useTokens();
  const model = useTaste(s => s.model);
  const local = useTaste(s => s.local);
  const prior = useTaste(s => s.prior);
  const dormant = useTaste(s => s.dormant);
  const log = useTaste(s => s.log);
  const steering = useTaste(s => s.steering);
  const summary = useMemo(() => summarise(model, steering), [model, steering]);
  const localSummary = useMemo(() => (prior.from ? summarise(local) : null), [local, prior.from]);
  const sure = modelSureness(model);
  const groups = useMemo(() => groupedLikes(model, 6), [model]);
  const fav = useMemo(() => favouriteSources(model, 6), [model]);
  const sw = useMemo(() => steeringWeights(steering), [steering]);
  const likes = groups.reduce((s, g) => s + g.likes.length, 0), dislikes = groups.reduce((s, g) => s + g.dislikes.length, 0);
  const counts = logCounts(log);
  const localSignals = Object.values(local.signals).reduce((s, v) => s + (v ?? 0), 0);
  const priorSignals = Object.values(prior.signals).reduce((s, v) => s + (v ?? 0), 0);
  const dormantItems = itemsOf(dormant);
  const stages = Object.entries(model.stages)
    .map(([stage, row]) => ({ stage, top: Object.entries(row).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4), total: Object.values(row).reduce((s, v) => s + v, 0) }))
    .filter(s => s.top.length).sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  const tops = stageTops(model, 1);
  const muted = { fontSize: 12, color: tk.text.muted, lineHeight: 1.5 } as const;
  const steerCount = Object.keys(sw).length;
  const modelLine = useImageModelLine();

  return (
    <div data-taste-page style={{ display: 'flex', flexDirection: 'column', gap: compact ? 14 : 18, padding: compact ? '14px 12px 40px' : '22px 28px 60px', maxWidth: 980, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ width: compact ? 36 : 42, height: compact ? 36 : 42, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tk.bg.hover, color: tk.status.success }}>
          <Icon name="thumbUp" size={19} />
        </span>
        <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h1 style={{ margin: 0, font: `650 ${compact ? 17 : 20}px ${fontFamily.ui}`, letterSpacing: '-0.015em', color: tk.text.primary }}>Your taste</h1>
          <span style={muted}>What Surprise, Deep and Evolve learned you like, where each preference came from, and your own steering on top. A small local model: nothing leaves this device, and no cloud AI is asked anything (the optional image model runs here too).</span>
        </div>
        <HowSure value={sure.confidence} word={sure.word} signals={sure.signals} />
      </div>

      <Section id="summary" title="Profile" primary icon="info" summary={`${sure.word} · ${plural(sure.signals, 'signal')}`}>
        <Card>
          <p data-taste-summary style={{ margin: 0, font: `14px/1.6 ${fontFamily.ui}`, color: tk.text.primary }}>
            {summary.sentences.map((x, i) => (
              <span key={i} style={{ marginRight: 4 }}>
                {x.text}{' '}
                {x.steer ? <Pill tone="warn">your steering</Pill> : summary.sentences.length > 1 || sure.signals ? <SurePill sure={x.sure} /> : null}{' '}
              </span>
            ))}
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }} data-taste-layers>
            <Pill tone="good" title="Learned from what you did on this install">This install: {plural(localSignals, 'signal')}</Pill>
            {prior.from
              ? <Pill tone="accent" title={prior.from.summary || undefined}>Imported profile: {prior.from.label} ({plural(priorSignals, 'signal')})</Pill>
              : <Pill title="Import a .playfield-taste file (Model internals) to start from another install's profile">No imported profile</Pill>}
            <Pill tone="warn">Your steering: {steerCount ? plural(steerCount, 'feature') : 'none'}</Pill>
            {dormantItems.length > 0 && <Pill title="Imported learning about graphs and shaders that aren't on this install; it wakes up if they appear">{plural(dormantItems.length, 'item')} not on this install</Pill>}
          </div>
          {localSummary && localSummary.sentences[0]?.text && (
            <p style={{ ...muted, margin: '10px 0 0' }}><b style={{ fontWeight: 600 }}>From this install alone:</b> {localSummary.sentences.map(x => x.text).join(' ')}</p>
          )}
        </Card>
      </Section>

      <Section id="learned" title="What it learned" icon="spark" summary={likes || dislikes ? `${plural(likes, 'like')}, ${plural(dislikes, 'dislike')} across ${plural(groups.length, 'kind')}` : 'nothing yet'}>
        <Card pad={12} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!groups.length && <span style={muted}>Nothing learned yet. Play a few rounds of Evolve (the Do bar), keep or undo surprises, or like and dislike graphs, shaders, palettes and techniques.</span>}
          {groups.map(g => (
            <div key={g.kind} data-taste-group={g.kind} style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.07em', textTransform: 'uppercase', color: tk.text.faint, padding: '0 4px 4px' }}>{KIND_TITLES[g.kind]}</span>
              {g.likes.map(r => <TasteFeatureRow key={r.key} k={r.key} />)}
              {g.dislikes.map(r => <TasteFeatureRow key={r.key} k={r.key} />)}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, fontSize: 11, color: tk.text.faint, flexWrap: 'wrap' }}>
            <Legend colour={tk.accent.base} label="imported profile" /><Legend colour={tk.status.success} label="this install" /><Legend colour={tk.status.warning} label="your steering" />
            <span>Open a row to see where it came from.</span>
          </div>
        </Card>
        {stages.length > 0 && (
          <Card pad={12}>
            <span style={{ font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Per stage: what you reach for</span>
            <div data-taste-stages style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '90px 1fr', gap: '8px 12px', marginTop: 10 }}>
              {stages.map(s => (
                <div key={s.stage} style={{ display: 'contents' }}>
                  <span style={{ font: `600 11px ${fontFamily.ui}`, color: tk.text.faint, textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: 2 }}>{s.stage}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {s.top.map(([c, v]) => (
                      <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <span style={{ width: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.secondary }}>{c}</span>
                        <span style={{ flex: 1, maxWidth: 220, height: 7, borderRadius: 4, background: tk.bg.field, overflow: 'hidden' }}>
                          <span style={{ display: 'block', height: '100%', width: `${(100 * v) / s.total}%`, background: tk.accent.base, borderRadius: 4 }} />
                        </span>
                        <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.muted, width: 34, textAlign: 'right' }}>{Math.round((100 * v) / s.total)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {tops.length > 0 && <span style={{ ...muted, display: 'block', marginTop: 8 }}>P(choice | stage), add-one smoothed; picks and likes add evidence, the loser’s choices lose a little.</span>}
          </Card>
        )}
        <Card pad={12}>
          <span style={{ font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Favourite sources</span>
          {fav.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }} data-taste-sources>
              {fav.map(f => (
                <button key={f.id} type="button" onClick={() => { void openRef({ item: f.id, label: f.label }); }} disabled={!canOpenRef({ item: f.id })}
                  style={{ display: 'flex', gap: 10, alignItems: 'center', border: 0, background: 'none', padding: '3px 0', cursor: 'pointer', textAlign: 'left', color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</span>
                  {f.rating > 0 && <Pill tone="good">liked</Pill>}
                  <span style={{ font: `500 11.5px ${fontFamily.mono}`, color: tk.text.muted }} title="How much more often Surprise uses it as a source">{f.weight.toFixed(2)}×</span>
                </button>
              ))}
            </div>
          ) : <span style={{ ...muted, display: 'block', marginTop: 4 }}>None yet: like a saved graph, an example or a shader, and Surprise uses it more as a source.</span>}
        </Card>
        {dormantItems.length > 0 && (
          <Card pad={12}>
            <span style={{ font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Not on this install</span>
            <span style={{ ...muted, display: 'block', margin: '2px 0 6px' }}>Imported learning about these is kept, dormant. If one appears here (the same name, or the same graph or code under another name), it wakes up.</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-taste-dormant>
              {dormantItems.map(id => <Pill key={id} title={id}>{dormant.items[id]?.label ?? id} {dormant.w[`src:${id}`] ? `(${dormant.w[`src:${id}`] > 0 ? '+' : '−'}${Math.abs(dormant.w[`src:${id}`]).toFixed(2)})` : ''}</Pill>)}
            </div>
          </Card>
        )}
      </Section>

      <Section id="looks" title="How things look" icon="eye" summary={`${modelLine}${model.look ? ` · ${model.look.likeW.toFixed(1)} liked, ${model.look.dislikeW.toFixed(1)} disliked looks` : ''}`}>
        <TasteLooks />
      </Section>

      <Section id="log" title="Signal log" icon="history" summary={log.entries.length ? `${plural(log.entries.length, 'signal')} · ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}` : 'empty'}>
        <TasteLogView />
      </Section>

      <Section id="steering" title="Your steering" icon="sliders"
        summary={`${hasSteering(steering) ? `${plural(steering.chips.filter(c => !c.off).length, 'chip')}, ${plural(Object.keys(steering.pins).length, 'pin')}` : 'none'} · exploration ${Math.round(steering.explore * 100)}% · lean ${Math.round(steering.lean * 100)}%${steering.nudge ? '' : ' · Do bar nudge off'}`}>
        <TasteSteering />
      </Section>

      <Section id="internals" title="Model internals" icon="code" summary={`${plural(Object.keys(model.w).length, 'weight')} · version 2 · embedder ${model.look?.embedder ?? model.embedder ?? 'none'}`}>
        <TasteInternals compact={compact} />
      </Section>
    </div>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 6, borderRadius: 2, background: colour }} />{label}</span>;
}

/** The "how sure" indicator: a small meter and a word. */
function HowSure({ value, word, signals }: { value: number; word: string; signals: number }) {
  const tk = useTokens();
  return (
    <div data-taste-sure title={`Confidence ${Math.round(value * 100)}%: grows with signals (n / (n + 10))`} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140, padding: '6px 10px', borderRadius: radius.md, background: tk.bg.subtle }}>
      <span style={{ font: `600 11px ${fontFamily.ui}`, color: tk.text.muted }}>How sure: <span style={{ color: tk.text.primary }}>{word}</span></span>
      <span style={{ height: 6, borderRadius: 3, background: tk.bg.field, overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.round(value * 100)}%`, background: tk.status.success }} />
      </span>
      <span style={{ fontSize: 10.5, color: tk.text.faint }}>{plural(signals, 'signal')}</span>
    </div>
  );
}
