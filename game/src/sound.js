// Solmar City — tiny procedural sound effects, Web Audio oscillators only.
//
// No audio files, no network. Every method is a silent no-op when the
// browser has no AudioContext or the context has not been unlocked by a
// user gesture yet. Master volume is kept low so effects stay subtle.

export function createSound() {
  let ctx = null;
  let master = null;

  const AC =
    typeof window !== 'undefined' &&
    (window.AudioContext || window.webkitAudioContext);
  if (AC) {
    try {
      ctx = new AC();
    } catch (e) {
      ctx = null;
    }
  }

  if (ctx) {
    master = ctx.createGain();
    master.gain.value = 0.12; // low master volume: effects stay subtle
    master.connect(ctx.destination);
  }

  const ensureReady = () => {
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      try {
        ctx.resume();
      } catch (e) {
        /* not unlockable yet */
      }
    }
    return ctx.state === 'running';
  };

  // Auto-unlock on the first user gesture (guarded for non-browser envs).
  if (ctx && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const unlock = () => {
      if (ctx && ctx.state === 'suspended') {
        try {
          ctx.resume();
        } catch (e) {
          /* ignore */
        }
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  // ---- engine hum -------------------------------------------------------
  let engineOscA = null;
  let engineOscB = null;
  let engineGain = null;
  let engineFilter = null;
  let engineStopToken = 0;

  const engine = (speed) => {
    if (!ensureReady()) return;
    if (speed <= 0) {
      engineStopToken++;
      const myToken = engineStopToken;
      if (engineGain) {
        const t = ctx.currentTime;
        engineGain.gain.cancelScheduledValues(t);
        engineGain.gain.setValueAtTime(engineGain.gain.value, t);
        engineGain.gain.linearRampToValueAtTime(0, t + 0.12);
      }
      setTimeout(() => {
        if (myToken !== engineStopToken) return; // re-accelerated, keep it
        try {
          if (engineOscA) { engineOscA.stop(); engineOscA.disconnect(); }
          if (engineOscB) { engineOscB.stop(); engineOscB.disconnect(); }
          if (engineFilter) engineFilter.disconnect();
          if (engineGain) engineGain.disconnect();
        } catch (e) {
          /* already stopped */
        }
        engineOscA = engineOscB = engineGain = engineFilter = null;
      }, 140);
      return;
    }

    engineStopToken++; // any positive call cancels a pending stop
    if (!engineOscA) {
      engineOscA = ctx.createOscillator();
      engineOscB = ctx.createOscillator();
      engineFilter = ctx.createBiquadFilter();
      engineGain = ctx.createGain();
      engineOscA.type = 'sawtooth';
      engineOscB.type = 'sawtooth';
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 600;
      engineGain.gain.value = 0;
      engineOscA.connect(engineFilter);
      engineOscB.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOscA.start();
      engineOscB.start();
    }
    const t = ctx.currentTime;
    const freq = 40 + speed * 150; // pitch rises with speed
    const g = 0.02 + speed * 0.05;
    engineOscA.frequency.setTargetAtTime(freq, t, 0.05);
    engineOscB.frequency.setTargetAtTime(freq * 1.007, t, 0.05);
    engineGain.gain.setTargetAtTime(g, t, 0.05);
  };

  // ---- police siren -----------------------------------------------------
  const siren = () => {
    if (!ensureReady()) return () => {};
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    const g = ctx.createGain();
    osc.type = 'triangle';
    lfo.type = 'square';
    osc.frequency.value = 750;
    lfo.frequency.value = 1.4; // two-tone alternation rate
    lfoDepth.gain.value = 160; // swings ~590..910 Hz
    g.gain.value = 0.05;
    lfo.connect(lfoDepth);
    lfoDepth.connect(osc.frequency);
    osc.connect(g);
    g.connect(master);
    osc.start();
    lfo.start();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      try {
        const t = ctx.currentTime;
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + 0.1);
        setTimeout(() => {
          try {
            osc.stop(); osc.disconnect();
            lfo.stop(); lfo.disconnect();
            lfoDepth.disconnect();
            g.disconnect();
          } catch (e) {
            /* already stopped */
          }
        }, 120);
      } catch (e) {
        /* ignore */
      }
    };
  };

  // ---- short UI blip ----------------------------------------------------
  const blip = () => {
    if (!ensureReady()) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = 'sine';
    osc.frequency.value = 880;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 0.1);
  };

  // ---- rising mission-complete arpeggio ---------------------------------
  const jingle = () => {
    if (!ensureReady()) return;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    const t0 = ctx.currentTime;
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const t = t0 + i * 0.09;
      osc.type = 'triangle';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  };

  // ---- low collision thud ----------------------------------------------
  const thud = () => {
    if (!ensureReady()) return;
    const dur = 0.18;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length); // decaying noise
    }
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    src.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur);
  };

  return { engine, siren, blip, jingle, thud };
}
