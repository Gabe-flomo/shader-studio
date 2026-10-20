/**
 * finish.ts — what every builder's Done does: close the builder window and go back to the graph,
 * framed on the nodes the builder made, so the result is the first thing you see.
 *
 * Shared by the 2D and 3D Scene Builders, the Grid Rules editor, the Agent Rules editor, the
 * Agent Builder (through the close handler BuilderWindowsHost gives it) and the Expression
 * Builder's Add to graph. Nothing to frame (a builder closed before it made anything) just closes.
 *
 * The builders that build on demand (2D, 3D and Grid scenes) go through doneBuilding: Done builds
 * (or rebuilds) first and closes only when that worked, so Done never drops edits. Their ✕ and Esc
 * go through closeBuilding: unbuilt edits ask Build / Discard / Keep editing. (Grid Rules, Agent
 * Rules, the Agent Builder and the Splat builder write into the graph as you edit.)
 */
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { toast } from '../components/ui/toastStore';
import { askChoice } from '../components/ui/dialogStore';
import { commitSceneDraft, sceneDraftDiscarding, sceneDraftOpen } from './sceneDraft';

/** How long the window takes to go before the canvas is measured and framed. */
const FRAME_DELAY_MS = 80;

/** The ids among `ids` that exist at the graph's top level. */
export function topLevelIdsOf(ids: ReadonlyArray<string | null | undefined>): string[] {
  const nodes = useNodeGraphStore.getState().nodes;
  const want = new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0));
  return nodes.filter(n => want.has(n.id)).map(n => n.id);
}

/** Frame (zoom to fit) these nodes on the graph canvas, after the builder window has gone. */
export function frameNodes(ids: ReadonlyArray<string | null | undefined>): void {
  const keep = topLevelIdsOf(ids);
  if (!keep.length) return;
  const st = useNodeGraphStore.getState();
  // Builders build at the top level: show that level, not a group the user happened to be inside.
  if (st.activeGroupPath.length) st.exitToRoot();
  setTimeout(() => useNodeGraphStore.getState()._fitViewCallback?.(keep), FRAME_DELAY_MS);
}

/**
 * The whole graph framed (never zoomed in past 100%), once what just changed has been laid out: after
 * a builder's Build (it stays open, the graph behind it is ready when it closes) or a Do… run.
 */
export function fitGraphSoon(delay = FRAME_DELAY_MS): void {
  setTimeout(() => useNodeGraphStore.getState()._fitViewCallback?.(undefined, { maxZoom: 1 }), delay);
}

/** Combine's say over a builder's Done (combine/actions.ts): true when it took the build (the session stays open). */
type DoneHook = (close: () => void, ids: ReadonlyArray<string | null | undefined>) => boolean;
let doneHook: DoneHook | null = null;
export function setBuilderDoneHook(h: DoneHook | null): void { doneHook = h; }

/**
 * A builder's Done: close it (`close`), then frame what it made (`ids`). In a Scene builder session this is what puts
 * the scene in the graph, as one undo step (builders/sceneDraft.ts).
 */
export function finishBuilder(close: () => void, ids: ReadonlyArray<string | null | undefined> = []): void {
  // A builder Combine opened (New…, Edit product) or "Add to this…": its Done goes back to Combine, the session open.
  if (doneHook?.(close, ids)) return;
  close();
  commitSceneDraft();
  frameNodes(ids);
}

/** A builder that builds into the graph when asked (Build, Done), not as you edit. */
export interface BuildingBuilder {
  /** What it makes, for the messages: "2D scene". */
  label: string;
  /** Whether Done has to build first: edits not built yet, or nothing built at all. */
  needsBuild: () => boolean;
  /** Whether closing now would leave edits the graph doesn't have (the close prompt). */
  unbuiltEdits: () => boolean;
  /** Build (or rebuild) into the graph. False or null: cancelled, stay open. Throws: it failed. */
  build: () => boolean | string | null | Promise<boolean | string | null>;
  close: () => void;
  /** The nodes to frame once closed (asked after the build). */
  ids: () => ReadonlyArray<string | null | undefined>;
  /** "Discard": forget the kept draft (builders/drafts.ts). */
  discard?: () => void;
}

/**
 * Done: build (or rebuild) into the graph when there is anything to build, then close and frame it.
 * A build that fails or is cancelled keeps the window open with the edits, and says why. True when closed.
 */
export async function doneBuilding(b: BuildingBuilder): Promise<boolean> {
  if (b.needsBuild() && !(await buildStaying(b))) return false;
  finishBuilder(b.close, b.ids());
  return true;
}

/** Build: build (or rebuild) and keep the window open. A failure says why. True when it built. */
export async function buildStaying(b: Pick<BuildingBuilder, 'label' | 'build'>): Promise<boolean> {
  try {
    const made = await b.build();
    const built = made !== false && made !== null;
    // Not in a Scene builder session: there the graph behind is your graph until Done (sceneDraft.ts).
    if (built && !sceneDraftOpen()) fitGraphSoon();
    return built;
  } catch (err) {
    toast.error(`Couldn't build the ${b.label}`, {
      message: 'The builder stays open with your edits, so nothing is lost. Change what went wrong and build again.',
      details: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    return false;
  }
}

/**
 * ✕ or Esc: with edits the graph doesn't have, ask Build (and close) / Discard / Keep editing; else
 * just close. True when the window closed.
 */
export async function closeBuilding(b: BuildingBuilder): Promise<boolean> {
  // The Scene builder already asked "Discard this scene?" (sceneDraft.ts closeSceneWindow): close, and forget the kept draft.
  if (sceneDraftDiscarding()) { b.close(); b.discard?.(); return true; }
  if (!b.unbuiltEdits()) { b.close(); return true; }
  const choice = await askChoice(`Build your changes to the ${b.label}?`, [
    { id: 'keep', label: 'Keep editing', variant: 'ghost' },
    { id: 'discard', label: 'Discard', variant: 'danger' },
    { id: 'build', label: 'Build', variant: 'primary' },
  ], { message: "You changed it since it was last built, and the graph doesn't have those edits yet. Build puts them in the graph and closes; Discard closes without them." });
  if (choice === 'build') return doneBuilding(b);
  if (choice === 'discard') { b.close(); b.discard?.(); return true; }
  return false;
}

