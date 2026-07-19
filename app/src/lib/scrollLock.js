// A fixed-position scrim/modal doesn't stop iOS Safari from scrolling the
// page underneath a touch drag — iOS sometimes scrolls the <html> element
// even when <body> has overflow: hidden, so both get locked. Reference
// counted so one dialog opening another (e.g. Export -> the review-reminder
// follow-up) doesn't unlock the page when the first one unmounts.
//
// overflow: hidden alone still leaves Safari's screen-edge "swipe back"
// gesture live — that's a native UIKit gesture recognizer sitting below the
// page's own scrolling, not something overflow or overscroll-behavior can
// touch. touch-action tells it to back off. pan-y (not none) so a dialog's
// own scrollable body (e.g. Drawer's overflow-y: auto) can still scroll —
// touch-action on an ancestor restricts descendants too, and we only need
// to kill horizontal panning, which is what the edge-swipe gesture reads.
// Scoped to the lock, not a permanent global rule, so it doesn't disable
// the mobile bottom action bar's own horizontal scroll the rest of the time.
let count = 0;
let saved = null;

export function lockBodyScroll() {
  if (count === 0) {
    saved = [document.documentElement.style.overflow, document.body.style.overflow, document.body.style.touchAction];
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'pan-y';
  }
  count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count--;
    if (count === 0) {
      [document.documentElement.style.overflow, document.body.style.overflow, document.body.style.touchAction] = saved;
      saved = null;
    }
  };
}
