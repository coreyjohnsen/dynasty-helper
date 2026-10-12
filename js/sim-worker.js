"use strict";
/* The simulation, off the page's thread. It plays a job from prepareSim() with the same
   kernel the page would use, so a run gives the same numbers wherever it happens. */
importScripts('sim-kernel.js');
self.onmessage = (e) => {
  const id = e.data.id, job = e.data.job;
  try {
    const run = createSimRun(job);
    let last = Date.now();
    while (!run.finished()) {
      run.step(100);
      const now = Date.now();
      if (now - last > 120) { last = now; self.postMessage({ id, p: run.progress() }); }
    }
    self.postMessage({ id, acc: run.acc });
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
