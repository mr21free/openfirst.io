// A fixed-position scrim/modal doesn't stop iOS Safari from scrolling the
// page underneath a touch drag — iOS sometimes scrolls the <html> element
// even when <body> has overflow: hidden, so both get locked. Reference
// counted so one dialog opening another (e.g. Export -> the review-reminder
// follow-up) doesn't unlock the page when the first one unmounts.
let count = 0;
let saved = null;

export function lockBodyScroll() {
  if (count === 0) {
    saved = [document.documentElement.style.overflow, document.body.style.overflow];
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count--;
    if (count === 0) {
      [document.documentElement.style.overflow, document.body.style.overflow] = saved;
      saved = null;
    }
  };
}
