const Pitchfinder = require('pitchfinder');  // 🛠️ FIXED: Use full import like pre-Railway
const WavDecoder = require('wav-decoder');
const fs = require('fs');

async function extractPitch(filePath) {
  const buffer = fs.readFileSync(filePath);
  const decoded = await WavDecoder.decode(buffer);
  const { sampleRate, channelData } = decoded;
  const input = channelData[0];

  if (!input) throw new Error('Missing audio samples in WAV data.');

  // 🛠️ FIXED: Use pre-Railway YIN import pattern  
  const detectPitch = Pitchfinder.YIN({ sampleRate });
  const frameSize = 2048;
  const hopSize = 512;
  const pitchFrames = [];

  for (let i = 0; i + frameSize < input.length; i += hopSize) {
    const frame = input.slice(i, i + frameSize);
    // 🛠️ FIXED: Use pre-Railway pattern - don't convert failures to 0
    const pitch = detectPitch(frame);
    const time = +(i / sampleRate).toFixed(3);
    pitchFrames.push({ time, pitch });
  }

  // 🛠️ FIXED: Add pre-Railway debugging output
  console.log("🎵 [PITCH DEBUG] Extracted Pitch Values (first 20):");
  console.log(pitchFrames.slice(0, 20));

  // 🛠️ FIXED: Use pre-Railway validity range and filtering logic
  const validPitches = pitchFrames.filter(p => p.pitch && p.pitch > 50 && p.pitch < 1500);
  console.log(`🎧 [PITCH DEBUG] Total pitch frames: ${pitchFrames.length}`);
  console.log(`🎯 [PITCH DEBUG] Valid pitch frames (filtered): ${validPitches.length}`);
  console.log(`📊 [PITCH DEBUG] Sample of valid pitches:`, validPitches.slice(0, 5));

  // 🛠️ FIXED: Add debug file output like pre-Railway version
  try {
    fs.writeFileSync(
      '/tmp/debug_pitch_data.json',
      JSON.stringify(pitchFrames.slice(0, 100), null, 2),
      'utf-8'
    );
    console.log('✅ [PITCH DEBUG] Pitch data sample saved to /tmp/debug_pitch_data.json');
  } catch (debugError) {
    console.warn('⚠️  [PITCH DEBUG] Could not save debug file:', debugError.message);
  }

  return pitchFrames;
}

module.exports = { extractPitch }; 