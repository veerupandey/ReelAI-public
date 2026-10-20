
import { MusicComposition, Note } from '../types';

// Map Note names to Frequency
const getNoteFreq = (note: string): number => {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = parseInt(note.slice(-1));
  const key = note.slice(0, -1);
  const index = notes.indexOf(key);
  
  if (index === -1) return 0;

  // A4 = 440Hz. A4 is index 9 in octave 4.
  const stepsFromC0 = index + (octave * 12);
  const stepsFromA4 = stepsFromC0 - 57; 
  
  return 440 * Math.pow(2, stepsFromA4 / 12);
};

export const synthesizeComposition = async (composition: MusicComposition): Promise<AudioBuffer> => {
  const sampleRate = 44100;
  // Ensure duration is at least 20s or the composition length
  const duration = Math.max(composition.totalDuration, 20);
  
  // Create Offline Context for rendering
  const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

  // Master Gain
  const masterGain = offlineCtx.createGain();
  masterGain.gain.value = 0.4; 
  masterGain.connect(offlineCtx.destination);

  // --- 1. TANPURA DRONE (The Soul of Indian Music) ---
  // A continuous drone on Root (Sa) and Fifth (Pa)
  const droneFreq1 = 130.81; // C3
  const droneFreq2 = 196.00; // G3

  const createDroneString = (freq: number, pan: number) => {
      const osc = offlineCtx.createOscillator();
      const gain = offlineCtx.createGain();
      const filter = offlineCtx.createBiquadFilter();
      const panner = offlineCtx.createStereoPanner();

      osc.type = 'sawtooth'; // Rich harmonics
      osc.frequency.value = freq;
      
      // Lowpass to dampen the buzz
      filter.type = 'lowpass';
      filter.frequency.value = 300;
      filter.Q.value = 1;

      // Subtle pulse to make it alive
      const lfo = offlineCtx.createOscillator();
      const lfoGain = offlineCtx.createGain();
      lfo.frequency.value = 0.2; // Slow pulse
      lfoGain.gain.value = 10; // Depth of modulation on filter
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start(0);

      gain.gain.value = 0.1; // Background level
      panner.pan.value = pan;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
      panner.connect(masterGain);
      osc.start(0);
  };

  createDroneString(droneFreq1, -0.3);
  createDroneString(droneFreq2, 0.3);


  // --- 2. SITAR / SANTOOR LEAD ---
  // Uses a delay line for metallic resonance and a sharp envelope
  const delay = offlineCtx.createDelay();
  delay.delayTime.value = 0.15; // Slapback
  const delayFeedback = offlineCtx.createGain();
  delayFeedback.gain.value = 0.2;
  delay.connect(delayFeedback);
  delayFeedback.connect(delay);
  delay.connect(masterGain);
  
  // Reverb-ish effect via longer delay
  const reverb = offlineCtx.createDelay();
  reverb.delayTime.value = 0.4;
  const reverbGain = offlineCtx.createGain();
  reverbGain.gain.value = 0.15;
  reverb.connect(reverbGain);
  reverbGain.connect(masterGain);

  composition.notes.forEach((note) => {
    const freq = getNoteFreq(note.pitch);
    if (freq <= 0) return;

    const osc = offlineCtx.createOscillator();
    const env = offlineCtx.createGain();
    const filter = offlineCtx.createBiquadFilter();

    // Sitar emulation: Sawtooth + Resonant Filter sweep
    osc.type = 'sawtooth';
    osc.frequency.value = freq;

    // Filter Envelope (The "Twang")
    filter.type = 'lowpass';
    filter.Q.value = 8; // High resonance for metallic sound
    filter.frequency.setValueAtTime(2000, note.startTime);
    filter.frequency.exponentialRampToValueAtTime(400, note.startTime + 0.3);

    // Amplitude Envelope
    env.gain.setValueAtTime(0, note.startTime);
    env.gain.linearRampToValueAtTime(note.velocity || 0.6, note.startTime + 0.01); // Instant attack
    env.gain.exponentialRampToValueAtTime(0.001, note.startTime + note.duration + 0.5); // Long ringing tail

    osc.connect(filter);
    filter.connect(env);
    env.connect(masterGain);
    env.connect(delay);
    env.connect(reverb);

    osc.start(note.startTime);
    osc.stop(note.startTime + note.duration + 2.0); // Let tail ring out
  });

  // Render
  return await offlineCtx.startRendering();
};
