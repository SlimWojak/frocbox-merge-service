const WavDecoder = require('wav-decoder');
const fs = require('fs');

async function extractRhythm(filePath) {
  const buffer = fs.readFileSync(filePath);
  const decoded = await WavDecoder.decode(buffer);
  const { sampleRate, channelData } = decoded;
  const input = channelData[0];

  if (!input) throw new Error('Missing audio samples for rhythm analysis.');

  const frameSize = 2048;
  const hopSize = 512;
  const energyFrames = [];

  for (let i = 0; i + frameSize < input.length; i += hopSize) {
    const frame = input.slice(i, i + frameSize);
    // 🛠️ FIXED: Calculate energy exactly like pre-Railway
    const energy = frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length;
    energyFrames.push(energy);
  }

  // 🛠️ CRITICAL FIX: WAV decoder produces normalized samples (-1 to 1)
  // Pre-Railway used raw samples. Need to scale threshold appropriately.
  // Energy values around 1e-8 suggest we need a much smaller threshold
  const threshold = 1e-5;  // 🛠️ FIXED: Adjusted for WavDecoder normalization
  const activeCount = energyFrames.filter(e => e > threshold).length;
  const activityRatio = +(activeCount / energyFrames.length).toFixed(3);

  // 🛠️ FIXED: Add pre-Railway debugging output
  console.log("🥁 [RHYTHM DEBUG] Extracted Rhythm Data (first 20):");
  console.log(energyFrames.slice(0, 20));
  console.log(`🥁 [RHYTHM DEBUG] Activity Ratio: ${activityRatio.toFixed(3)}`);
  console.log(`🥁 [RHYTHM DEBUG] Active frames: ${activeCount}/${energyFrames.length} (threshold: ${threshold})`);

  // 🛠️ FIXED: Add debug file output like pre-Railway version
  try {
    fs.writeFileSync(
      '/tmp/debug_energy_data.json',
      JSON.stringify(energyFrames.slice(0, 100), null, 2),
      'utf-8'
    );
    console.log('✅ [RHYTHM DEBUG] Energy data sample saved to /tmp/debug_energy_data.json');
  } catch (debugError) {
    console.warn('⚠️  [RHYTHM DEBUG] Could not save debug file:', debugError.message);
  }

  return { energyFrames, activityRatio };
}

module.exports = { extractRhythm }; 