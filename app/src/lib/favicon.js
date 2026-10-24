/*
  Browser-tab "working" indicator: pulses the tab favicon whenever a local
  save (IndexedDB or the on-disk plan file) starts, so it stays visible even
  when the tab isn't focused.

  Trigger-once-per-cycle model: any tracked save starts the animation
  immediately; it always runs for exactly one full pulse and then stops,
  whether or not the save itself is still in flight by then. A save that
  starts while the icon is already mid-cycle doesn't restart or extend it —
  it's not a distinct visual event on top of the one already playing.

  index.html declares two icon links — image/svg+xml and image/png — and
  browsers that support SVG favicons (Chrome included) render the tab icon
  from the SVG one, ignoring the PNG. So the SVG link gets a real eased
  fade+scale animation (generated as inline data URIs, one pass through
  SVG_STEPS frames) since that's what's actually visible; the PNG link is
  just along for browsers that fall back to it, and gets a plain two-frame
  dip in sync with the SVG's dip window.
*/

const SVG_STEPS = 14;
const FRAME_MS = 60;

const LOGO_PATHS =
  '<polygon points="6.00,20.27 6.00,94.00 79.73,94.00" fill="#3C6FB2"/>' +
  '<polygon points="20.27,6.00 94.00,6.00 94.00,79.73" fill="#3C6FB2"/>';

const PNG_HREFS = { normal: '/favicon-32.png', blink: '/favicon-blink.png' };

// One sine envelope (0 at both ends, 1 at the midpoint) drives both the
// opacity dip and the scale dip in lockstep, so the icon reads as a single
// smooth breath in and out rather than a jump between two fixed frames.
const svgFrames = [];
const pngFrames = [];
for (let i = 0; i < SVG_STEPS; i++) {
  const t = i / (SVG_STEPS - 1);
  const envelope = Math.sin(Math.PI * t);
  const opacity = (1 - 0.85 * envelope).toFixed(3);
  const scale = (1 - 0.3 * envelope).toFixed(3);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" fill="none">` +
    `<g transform="translate(50,50) scale(${scale}) translate(-50,-50)" opacity="${opacity}">${LOGO_PATHS}</g></svg>`;
  svgFrames.push('data:image/svg+xml,' + encodeURIComponent(svg));
  pngFrames.push(envelope > 0.5 ? PNG_HREFS.blink : PNG_HREFS.normal);
}

let running = false;
let blinkInterval = null;
let frameIndex = 0;

function iconLinks() {
  return [...document.querySelectorAll('link[rel="icon"]')];
}

// Some browsers cache the rendered tab icon by the <link> node's identity and
// don't repaint the tab strip on a plain `.href =` write. Cloning each node and
// swapping it into the DOM forces every browser to treat it as a genuinely new
// icon resource.
function drawFrame(i) {
  for (const old of iconLinks()) {
    const href = old.type === 'image/svg+xml' ? svgFrames[i] : old.type === 'image/png' ? pngFrames[i] : null;
    if (!href) continue;
    const next = old.cloneNode(false);
    next.href = href;
    old.replaceWith(next);
  }
}

function startBlink() {
  frameIndex = 0;
  drawFrame(0);
  blinkInterval = setInterval(() => {
    frameIndex++;
    if (frameIndex >= SVG_STEPS) {
      stopBlink();
      running = false;
      return;
    }
    drawFrame(frameIndex);
  }, FRAME_MS);
}

function stopBlink() {
  if (blinkInterval) {
    clearInterval(blinkInterval);
    blinkInterval = null;
  }
  drawFrame(0); // frame 0 is the resting state: opacity 1, scale 1
}

/**
 * Mark a save as starting. Any save triggers one full pulse cycle on the tab
 * favicon; a save that starts mid-cycle is ignored — it neither restarts nor
 * extends the cycle already playing. Purely a visual side effect: the
 * promise passed in is returned unchanged.
 */
export function withFaviconActivity(promise) {
  if (!running) {
    running = true;
    startBlink();
  }
  return promise;
}
