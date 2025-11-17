// Niskala Studio — app.js (Mixing + Style Presets + Re-generate)
// Replace entire app.js with this code and commit.

// ---------------------------
// Globals & DOM refs
// ---------------------------
let vocalFile = null;
let musicFile = null;
let lastOptions = null;   // store last options for regenerate
let lastRenderedBlob = null;

const vocalInput = document.getElementById("vocalFile");
const musicInput = document.getElementById("musicFile");
const styleSelect = document.getElementById("styleSelect");
const claritySlider = document.getElementById("clarity");
const warmthSlider = document.getElementById("warmth");
const presenceSlider = document.getElementById("presence");
const generateBtn = document.getElementById("generateBtn");
const regenBtn = document.getElementById("regenBtn");
const statusEl = document.getElementById("status");
const player = document.getElementById("player");
const downloadWav = document.getElementById("downloadWav");
const downloadMp3 = document.getElementById("downloadMp3");
const resultCard = document.getElementById("resultCard");

// manual mix controls (we will create simple sliders in DOM if not present)
let vocalGainControl = null;
let musicGainControl = null;

// ---------------------------
// Attach events
// ---------------------------
vocalInput.addEventListener("change", e => { vocalFile = e.target.files[0]; });
musicInput.addEventListener("change", e => { musicFile = e.target.files[0]; });

generateBtn.addEventListener("click", () => {
  if (!vocalFile) return alert("Unggah vocal file terlebih dahulu.");
  runProcess({ regenerate:false });
});

regenBtn.addEventListener("click", () => {
  if (!lastOptions) return alert("Belum ada hasil untuk di-regenerate.");
  runProcess({ regenerate:true });
});

// ---------------------------
// Style presets mapping
// ---------------------------
function presetToOptions(presetName) {
  // returns object with clarity, warmth, presence, ambient amount
  switch (presetName) {
    case "warm":   return { clarity:0.25, warmth:0.7, presence:0.25, ambient:0.08 };
    case "bright": return { clarity:0.6,  warmth:0.1, presence:0.6,  ambient:0.06 };
    case "airy":   return { clarity:0.45, warmth:0.2, presence:0.5,  ambient:0.18 };
    case "strong": return { clarity:0.35, warmth:0.35,presence:0.35, ambient:0.04, compression:0.6 };
    case "ambient":return { clarity:0.25, warmth:0.25,presence:0.2,  ambient:0.35 };
    default:       return { clarity:0.3,  warmth:0.3, presence:0.2,  ambient:0.1 };
  }
}

// ---------------------------
// Utility: read file -> ArrayBuffer
// ---------------------------
async function fileToArrayBuffer(file) {
  return await file.arrayBuffer();
}

// ---------------------------
// Main processing pipeline
// Uses OfflineAudioContext to render final mixed buffer
// ---------------------------
async function runProcess({ regenerate=false }) {
  try {
    generateBtn.disabled = true;
    regenBtn.disabled = true;
    setStatus("Preparing files...");

    // gather user parameters
    const userOptions = presetToOptions(styleSelect.value);
    userOptions.clarity = (claritySlider?.value ?? 30) / 100;
    userOptions.warmth  = (warmthSlider?.value  ?? 30) / 100;
    userOptions.presence= (presenceSlider?.value ?? 20) / 100;
    // manual mix gains default (vocal dominant)
    const manualVocalGain = vocalGainControl ? parseFloat(vocalGainControl.value) : 0.85;
    const manualMusicGain = musicGainControl ? parseFloat(musicGainControl.value) : 0.45;

    // store last options
    lastOptions = { userOptions, manualVocalGain, manualMusicGain };

    setStatus("Decoding audio...");
    const vAB = await fileToArrayBuffer(vocalFile);
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const vDecoded = await audioCtx.decodeAudioData(vAB.slice(0));

    let mDecoded = null;
    if (musicFile) {
      const mAB = await fileToArrayBuffer(musicFile);
      try { mDecoded = await audioCtx.decodeAudioData(mAB.slice(0)); } catch(e){
        console.warn("Failed decode music:", e);
      }
    }

    // determine output length: follow vocal duration
    const sampleRate = vDecoded.sampleRate;
    const outLength = vDecoded.length;

    setStatus("Building processing graph...");
    const offline = new OfflineAudioContext(2, outLength, sampleRate);

    // --- vocal source and nodes
    const vSource = offline.createBufferSource();
    vSource.buffer = vDecoded;

    const vGainNode = offline.createGain();
    vGainNode.gain.value = manualVocalGain;

    // Noise gate (soft)
    const noiseGate = offline.createDynamicsCompressor();
    noiseGate.threshold.value = -55;
    noiseGate.ratio.value = 12;

    // EQ nodes influenced by warmth/presence
    const lowShelf = offline.createBiquadFilter();
    lowShelf.type = "lowshelf";
    lowShelf.frequency.value = 200;
    lowShelf.gain.value = 3 * userOptions.warmth; // map warmth

    const presenceEQ = offline.createBiquadFilter();
    presenceEQ.type = "peaking";
    presenceEQ.frequency.value = 3000;
    presenceEQ.Q.value = 1.2;
    presenceEQ.gain.value = 3 * userOptions.presence;

    // subtle highs based on clarity
    const highShelf = offline.createBiquadFilter();
    highShelf.type = "highshelf";
    highShelf.frequency.value = 8000;
    highShelf.gain.value = 4 * userOptions.clarity;

    // compressor for vocals
    const vocalComp = offline.createDynamicsCompressor();
    vocalComp.threshold.value = -24;
    vocalComp.ratio.value = 3 + (userOptions.compression || 0); // stronger for 'strong'

    // optional harmonic (waveshaper) — mild
    const shaper = offline.createWaveShaper();
    shaper.curve = makeDistortionCurve((userOptions.clarity||0.3) * 6);
    shaper.oversample = "2x";

    // reverb (small for ambient)
    const convolver = offline.createConvolver();
    convolver.buffer = createImpulse(offline, 0.4, 2.0 * (userOptions.ambient || 0.08));

    // connect vocal chain:
    // vSource -> noiseGate -> lowShelf -> presenceEQ -> highShelf -> shaper -> vocalComp -> vGainNode -> convolver -> masterGain
    vSource.connect(noiseGate);
    noiseGate.connect(lowShelf);
    lowShelf.connect(presenceEQ);
    presenceEQ.connect(highShelf);
    highShelf.connect(shaper);
    shaper.connect(vocalComp);
    vocalComp.connect(vGainNode);
    vGainNode.connect(convolver);

    // --- music source and nodes (if present)
    let mSource = null;
    let mGainNode = offline.createGain();
    mGainNode.gain.value = manualMusicGain;

    if (mDecoded) {
      mSource = offline.createBufferSource();
      // if music shorter than vocal -> loop it, else truncate by setting playbackRate appropriately (we'll loop)
      if (mDecoded.length < vDecoded.length) {
        // create new buffer that repeats music to match vocal length
        const chan = mDecoded.numberOfChannels;
        const newBuf = offline.createBuffer(chan, vDecoded.length, mDecoded.sampleRate);
        const repeats = Math.ceil(vDecoded.length / mDecoded.length);
        for (let c = 0; c < chan; c++) {
          const dst = newBuf.getChannelData(c);
          const src = mDecoded.getChannelData(c);
          let pos = 0;
          for (let r = 0; r < repeats; r++) {
            for (let i = 0; i < src.length && pos < dst.length; i++, pos++) dst[pos] = src[i];
          }
        }
        mSource.buffer = newBuf;
      } else {
        // truncate music to vocal length by copying portion
        const chan = mDecoded.numberOfChannels;
        const newBuf = offline.createBuffer(chan, vDecoded.length, mDecoded.sampleRate);
        for (let c = 0; c < chan; c++) {
          const dst = newBuf.getChannelData(c);
          const src = mDecoded.getChannelData(c);
          for (let i = 0; i < vDecoded.length; i++) dst[i] = src[i];
        }
        mSource.buffer = newBuf;
      }
      // add mild lowcut to reduce clash with vocal low frequencies
      const musicHighpass = offline.createBiquadFilter();
      musicHighpass.type = "highpass";
      musicHighpass.frequency.value = 80;
      mSource.connect(musicHighpass);
      musicHighpass.connect(mGainNode);
    }

    // --- master chain
    const masterGain = offline.createGain();
    masterGain.gain.value = 0.95; // prevent clipping

    // connect convolver (vocal) and music gain to master
    convolver.connect(masterGain);
    if (mDecoded) mGainNode.connect(masterGain);

    masterGain.connect(offline.destination);

    // start sources
    vSource.start(0);
    if (mSource) mSource.start(0);

    setStatus("Rendering (this could take a few seconds)...");
    const rendered = await offline.startRendering();

    setStatus("Encoding WAV...");
    const wavBlob = bufferToWav(rendered);
    const wavURL = URL.createObjectURL(wavBlob);
    player.src = wavURL;
    downloadWav.href = wavURL;

    // MP3 encode (optional, may be slower on some devices)
    setStatus("Encoding MP3 (background)...");
    setTimeout(async () => {
      try {
        const mp3Blob = await encodeMp3(rendered, 192);
        const mp3URL = URL.createObjectURL(mp3Blob);
        downloadMp3.href = mp3URL;
      } catch (e) {
        console.warn("MP3 encode failed:", e);
      }
    }, 300);

    lastRenderedBlob = wavBlob;
    setStatus("Done — result ready.");
    resultCard.style.display = "block";
    generateBtn.disabled = false;
    regenBtn.disabled = false;
  } catch (err) {
    console.error("Processing error:", err);
    setStatus("Processing failed: " + (err.message || err));
    generateBtn.disabled = false;
    regenBtn.disabled = false;
  }
}

// ---------------------------
// Helpers
// ---------------------------
function setStatus(t) { statusEl.innerText = t; }

// simple WAV writer (stereo)
function bufferToWav(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArray = new ArrayBuffer(length);
  const view = new DataView(bufferArray);
  let channels = [], i, sample, offset = 0, pos = 0;

  writeString(view, pos, 'RIFF'); pos += 4;
  view.setUint32(pos, length - 8, true); pos += 4;
  writeString(view, pos, 'WAVE'); pos += 4;
  writeString(view, pos, 'fmt '); pos += 4;
  view.setUint32(pos, 16, true); pos += 4;
  view.setUint16(pos, 1, true); pos += 2;
  view.setUint16(pos, numOfChan, true); pos += 2;
  view.setUint32(pos, buffer.sampleRate, true); pos += 4;
  view.setUint32(pos, buffer.sampleRate * numOfChan * 2, true); pos += 4;
  view.setUint16(pos, numOfChan * 2, true); pos += 2;
  view.setUint16(pos, 16, true); pos += 2;
  writeString(view, pos, 'data'); pos += 4;
  view.setUint32(pos, length - pos - 4, true); pos += 4;

  for (i = 0; i < numOfChan; i++) channels.push(buffer.getChannelData(i));
  while (pos < length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }
  return new Blob([view], { type: 'audio/wav' });

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// makeDistortionCurve for mild harmonic
function makeDistortionCurve(amount) {
  const k = typeof amount === 'number' ? amount : 50;
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

// create impulse buffer for reverb
function createImpulse(ctx, durationSec = 0.5, decay = 2.0) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * durationSec;
  const impulse = ctx.createBuffer(2, length, sampleRate);
  for (let c = 0; c < 2; c++) {
    const channel = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

// MP3 encode using lamejs (if loaded via CDN)
async function encodeMp3(audioBuffer, kbps = 192) {
  if (typeof lamejs === "undefined" && typeof Lame === "undefined") {
    throw new Error("MP3 encoder (lamejs) not loaded.");
  }
  // convert to interleaved float32
  const numChannels = audioBuffer.numberOfChannels;
  const left = audioBuffer.getChannelData(0);
  const right = numChannels > 1 ? audioBuffer.getChannelData(1) : null;
  // convert to 16bit PCM
  const samples = new Int16Array(audioBuffer.length * numChannels);
  for (let i = 0; i < audioBuffer.length; i++) {
    samples[i * numChannels] = Math.max(-1, Math.min(1, left[i])) * 0x7fff;
    if (numChannels > 1) samples[i * numChannels + 1] = Math.max(-1, Math.min(1, right[i])) * 0x7fff;
  }
  // lamejs encoder usage
  // If using lamejs from unpkg, it's available as lamejs.Mp3Encoder
  const mp3enc = new lamejs.Mp3Encoder(numChannels, audioBuffer.sampleRate, kbps);
  const blockSize = 1152;
  let mp3Data = [];
  for (let i = 0; i < samples.length; i += blockSize * numChannels) {
    const chunk = samples.subarray(i, i + blockSize * numChannels);
    const mp3buf = mp3enc.encodeBuffer(chunk);
    if (mp3buf.length > 0) mp3Data.push(mp3buf);
  }
  const mp3buf = mp3enc.flush();
  if (mp3buf.length > 0) mp3Data.push(mp3buf);
  return new Blob(mp3Data, { type: "audio/mpeg" });
                                            }    view.setUint16(pos, numOfChan, true); pos += 2;
    view.setUint32(pos, buffer.sampleRate, true); pos += 4;
    view.setUint32(pos, buffer.sampleRate * 2 * numOfChan, true); pos += 4;
    view.setUint16(pos, numOfChan * 2, true); pos += 2;
    view.setUint16(pos, 16, true); pos += 2;
    writeString("data"); pos += 4;
    view.setUint32(pos, length - pos - 4, true); pos += 4;

    for (i = 0; i < numOfChan; i++)
        channels.push(buffer.getChannelData(i));

    while (pos < length) {
        for (i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset]));
            sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(pos, sample, true);
            pos += 2;
        }
        offset++;
    }

    return new Blob([bufferArray], { type: "audio/wav" });

    function writeString(s) {
        for (let i = 0; i < s.length; i++)
            view.setUint8(pos + i, s.charCodeAt(i));
    }
}
