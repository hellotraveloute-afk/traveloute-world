// Automatic quality steps: if the frame rate stays below target, turn the most
// expensive things down one step at a time. Steps only go down during a session,
// so the world never flip-flops between settings.
//
// Order: bloom off -> lower resolution -> shadows off -> lower resolution again
//        -> shorter tree distance -> art extras (fog clouds, ...).
//
// Frame-rate windows are skipped while a tile is being built or after a long
// pause (tab hidden, app in background), so loading hitches don't count.
// Turn it off with ?adaptive=0 (or `adaptive: false` in the app's `start`).

const WINDOW_S = 2; // measure over this long
const BAD_WINDOWS = 2; // consecutive slow windows before stepping down
const SETTLE_S = 2.5; // wait after a step (and at start) before measuring again

export class QualityGovernor {
  constructor({ world, quality, onChange }) {
    this.world = world;
    this.q = quality;
    this.onChange = onChange;
    this.enabled = quality.adaptive;
    // weak-phone preset aims for 30 fps, the full preset for 60
    const goal = quality.level === 'low' ? 30 : 60;
    this.target = Math.min(goal, quality.maxFps) * 0.88;
    this.steps = this.makeSteps();
    this.tier = 0;
    this.bad = 0;
    this.settle = SETTLE_S + 2;
    this.resetWindow();
  }

  makeSteps() {
    const q = this.q;
    const w = this.world;
    const steps = [];
    const prSteps = [];
    for (let pr = q.pixelRatio - 0.25; pr > q.minPixelRatio + 0.01; pr -= 0.25) prSteps.push(pr);
    if (q.pixelRatio > q.minPixelRatio + 0.01) prSteps.push(q.minPixelRatio);
    const res = (pr) => ({ name: `resolution ${pr.toFixed(2)}x`, run: () => w.setPixelRatio(pr) });

    if (q.bloom) steps.push({ name: 'bloom off', run: () => w.setBloom(false) });
    if (prSteps.length) steps.push(res(prSteps.shift()));
    if (q.shadows) {
      steps.push({
        name: 'shadows off',
        run: () => {
          w.setShadows(false);
          q.shadows = false; // tiles built from now on skip shadow work too
        },
      });
    }
    for (const pr of prSteps) steps.push(res(pr));
    for (const dist of [1000, 650]) {
      if (dist < q.treeDistance) steps.push({ name: `trees to ${dist} m`, run: () => (q.treeDistance = dist) });
    }
    // art pass extras, lightest loss first
    if (q.fogClouds) steps.push({ name: 'fog clouds off', run: () => (q.fogClouds = false) });
    return steps;
  }

  resetWindow() {
    this.frames = 0;
    this.time = 0;
    this.dirty = false;
  }

  // Call once per rendered frame. `busy`: a tile is being built right now.
  update(rawDt, busy) {
    if (!this.enabled || this.tier >= this.steps.length) return;
    if (rawDt > 0.25) {
      this.resetWindow(); // a pause, not a slow frame
      return;
    }
    if (this.settle > 0) {
      this.settle -= rawDt;
      return;
    }
    if (busy) this.dirty = true;
    this.frames++;
    this.time += rawDt;
    if (this.time < WINDOW_S) return;
    const fps = this.frames / this.time;
    if (!this.dirty) this.bad = fps < this.target ? this.bad + 1 : 0;
    this.resetWindow();
    if (this.bad < BAD_WINDOWS) return;
    const step = this.steps[this.tier++];
    step.run();
    this.bad = 0;
    this.settle = SETTLE_S;
    console.info(`[quality] ${fps.toFixed(1)} fps < ${this.target.toFixed(0)}: ${step.name}`);
    this.onChange && this.onChange(step.name, this.tier);
  }
}

// Caps the frame rate (so 90/120 Hz screens don't render frames nobody needs)
// while keeping an even rhythm. Returns true when this animation frame should render.
export function makeFrameCap(maxFps) {
  const gap = 1000 / maxFps;
  const slack = Math.min(4, gap * 0.12); // absorbs timestamp jitter
  let next = 0;
  return (now) => {
    if (now + slack < next) return false;
    // schedule from the ideal time, but never fall more than one frame behind
    next = Math.max(next + gap, now + gap * 0.5);
    return true;
  };
}
