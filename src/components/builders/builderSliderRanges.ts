/**
 * builderSliderRanges.ts — the ranges builder sliders were widened to by typing past their end
 * (BuilderSlider `rangeKey`), kept while the app runs: a tab switch or a folded card remounts the
 * slider, and the wider range should still be there.
 */
export const widenedRanges = new Map<string, { min: number; max: number }>();

/** Forget the remembered ranges (tests). */
export const resetBuilderSliderRanges = () => widenedRanges.clear();
