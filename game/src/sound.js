// Solmar City — procedural WebAudio sound effects.
// No audio files, no network: every sound is a tiny oscillator / noise burst.
// The AudioContext is created lazily on first use (browsers block audio before
// user interaction) and every function is safe to call when audio is
// unavailable or the context is suspended — none of them ever throw.

export function createSound() {
  let ctx = null;

  // Lazily create the AudioContext, resuming it if it is suspended. Returns
  // null when WebAudio is unavailable or construction fails.
  const ensureContext = () => {
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
      } catch (err) {
        ctx = null;
        return null;
      }
    }
    if (ctx.state === 'suspended') {
      try {
        ctx.resume().catch(() => {});
      } catch (err) {
        // Ignore: the context stays suspended and calls become silent no-ops.
      }
    }
    return ctx;
  };

  // ---------------------------------------------------------------- engine --
  // A low continuous hum whose pitch rises with speed. Started once, then its
  // frequency is updated in place. Speed 0 stops it.
  let engineOsc = null;
  let engineFilter = null;
  let engineGain = null;
  let engineRunning = false;

  const stopEngine = () => {
    if (!engineRunning) return;
    const ac = ctx;
    try {
      engineGain.gain.setTargetAtTime(0, ac.currentTime, 0.08);
      engineOsc.stop(ac.currentTime + 0.3);
    } catch (err) {
      // already stopped / disposed — fine
    }
    try {
      engineOsc.disconnect();
      engineFilter.disconnect();
      engineGain.disconnect();
    } catch (err) {
      // ignore
    }
    engineOsc = null;
    engineFilter = null;
    engineGain = null;
    engineRunning = false;
  };

  const startEngine = (ac) => {
    try {
      engineOsc = ac.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 60;

      engineFilter = ac.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;

      engineGain = ac.createGain();
      engineGain.gain.value = 0;
      engineGain.gain.setTargetAtTime(0.10, ac.currentTime, 0.1);

      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(ac.destination);
      engineOsc.start();
      engineRunning = true;
    } catch (err) {
      stopEngine();
    }
  };

  const engine = (speed) => {
    const ac = ensureContext();
    if (!ac) return;
    if (speed <= 0) {
      stopEngine();
      return;
    }
    if (!engineRunning) startEngine(ac);
    // Map speed (world units/sec, up to ~600) onto a low hum 45..180 Hz.
    const freq = 45 + (Math.min(speed, 600) / 600) * 135;
    try {
      engineOsc.frequency.setTargetAtTime(freq, ac.currentTime, 0.05);
    } catch (err) {
      // ignore
    }
  };

  // ---------------------------------------------------------------- siren --
  // A two-tone police siren that alternates while on, silent when off.
  let sirenOsc = null;
  let sirenLfo = null;
  let sirenLfoGain = null;
  let sirenGain = null;
  let sirenRunning = false;

  const stopSiren = () => {
    if (!sirenRunning) return;
    const ac = ctx;
    try {
      sirenGain.gain.setTargetAtTime(0, ac.currentTime, 0.05);
      sirenOsc.stop(ac.currentTime + 0.25);
      sirenLfo.stop(ac.currentTime + 0.25);
    } catch (err) {
      // ignore
    }
    try {
      sirenOsc.disconnect();
      sirenLfo.disconnect();
      sirenLfoGain.disconnect();
      sirenGain.disconnect();
    } catch (err) {
      // ignore
    }
    sirenOsc = null;
    sirenLfo = null;
    sirenLfoGain = null;
    sirenGain = null;
    sirenRunning = false;
  };

  const siren = (on) => {
    const ac = ensureContext();
    if (!ac) return;
    if (!on) {
      stopSiren();
      return;
    }
    if (sirenRunning) return;
    try {
      sirenOsc = ac.createOscillator();
      sirenOsc.type = 'square';
      sirenOsc.frequency.value = 800;

      sirenLfo = ac.createOscillator();
      sirenLfo.type = 'sine';
      sirenLfo.frequency.value = 1.2; // ~0.4s per half-cycle
      sirenLfoGain = ac.createGain();
      sirenLfoGain.gain.value = 160; // sweeps 640..960 Hz around 800

      sirenGain = ac.createGain();
      sirenGain.gain.value = 0;
      sirenGain.gain.setTargetAtTime(0.05, ac.currentTime, 0.05);

      sirenLfo.connect(sirenLfoGain);
      sirenLfoGain.connect(sirenOsc.frequency);
      sirenOsc.connect(sirenGain);
      sirenGain.connect(ac.destination);
      sirenOsc.start();
      sirenLfo.start();
      sirenRunning = true;
    } catch (err) {
      stopSiren();
    }
  };

  // ------------------------------------------------------------- one-shots --
  // Blip: a short UI click for menu navigation.
  const blip = () => {
    const ac = ensureContext();
    if (!ac || ac.state === 'suspended') return;
    try {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 660;
      const t = ac.currentTime;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.1);
    } catch (err) {
      // ignore
    }
  };

  // Jingle: a short ascending arpeggio for mission completion.
  const jingle = () => {
    const ac = ensureContext();
    if (!ac || ac.state === 'suspended') return;
    try {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      const t0 = ac.currentTime;
      notes.forEach((freq, i) => {
        const t = t0 + i * 0.12;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(t);
        osc.stop(t + 0.16);
      });
    } catch (err) {
      // ignore
    }
  };

  // Thud: a short low noise burst for collisions.
  const thud = () => {
    const ac = ensureContext();
    if (!ac || ac.state === 'suspended') return;
    try {
      const dur = 0.12;
      const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        // White noise with a decaying amplitude envelope.
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
      }
      const src = ac.createBufferSource();
      src.buffer = buffer;
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      const gain = ac.createGain();
      gain.gain.value = 0.5;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ac.destination);
      src.start();
    } catch (err) {
      // ignore
    }
  };

  return { engine, siren, blip, jingle, thud };
}

// Generates procedural WebAudio sound effects.
