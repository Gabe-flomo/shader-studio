/**
 * quickPinContext.ts — lets a builder take any of its sliders as a Quick control (the 2D Scene Builder:
 * sceneBuilder2d/quick.ts). Where a builder provides it, every BuilderSlider gets a small pin (shown on hover) and
 * "Add to quick controls" in its right-click menu, under the Play menu. Elsewhere sliders are as they were.
 */
import { createContext } from 'react';

export interface QuickPinRequest {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  integer?: boolean;
  onChange: (v: number) => void;
  /** The slider's Play lookup (a builder may tag it with the role and param names it reads). */
  lazyParam?: () => { nodeId: string; key: string } | { missing: string };
}

export interface QuickPinApi {
  pin: (req: QuickPinRequest) => void;
}

export const QuickPinContext = createContext<QuickPinApi | null>(null);
