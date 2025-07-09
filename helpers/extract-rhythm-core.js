const WavDecoder = require('wav-decoder');
const fs = require('fs');

async function extractRhythm(filePath) {
  const buffer = fs.readFileSync(filePath);
  const decoded = await WavDecoder.decode(buffer);
  const { sampleRate, channelData } = decoded;
  const input = channelData[0];

  const frameSize = 1024;
  const hopSize = 512;
  const energyFrames = [];

  for (let i = 0; i + frameSize < input.length; i += hopSize) {
    const frame = input.slice(i, i + frameSize);
    const energy = Math.sqrt(frame.reduce((sum, s) => sum + s * s, 0) / frame.length);
    energyFrames.push(+energy.toFixed(8));
  }

  const threshold = 1e-5;
  const activeCount = energyFrames.filter(e => e > threshold).length;
  const activityRatio = +(activeCount / energyFrames.length).toFixed(3);

  return { energyFrames, activityRatio };
}

module.exports = { extractRhythm }; 