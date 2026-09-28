/**
 * Pure rules for the Record dialog's layout and defaults, kept out of the component so they
 * can be tested without a canvas.
 */

/**
 * "Preview" exports the canvas at the size it is shown. Below this short side (a phone's
 * preview panel is ~160×280) that picture is too small to be useful, so the dialog opens on
 * 720p instead and marks Preview as tiny.
 */
export const USEFUL_PREVIEW_SHORT_SIDE = 480;

/** Is the preview, at this size, too small to be a sensible export? */
export function previewTiny(width: number, height: number): boolean {
  return Math.min(width, height) < USEFUL_PREVIEW_SHORT_SIDE;
}

/** The resolution the dialog opens on: the preview as shown, or 720p when that would be tiny. */
export function defaultResolutionId(previewWidth: number, previewHeight: number): 'preview' | '720' {
  return previewTiny(previewWidth, previewHeight) ? '720' : 'preview';
}

/**
 * Does a choice row wrap onto more lines? Always for 7+ options (the shape row's rule since
 * the shape layer editor got one); on a phone for any row, since none of the dialog's rows
 * with sizes under the labels fits 343px on one line.
 */
export function choiceRowWraps(optionCount: number, phone: boolean): boolean {
  return phone || optionCount >= 7;
}
