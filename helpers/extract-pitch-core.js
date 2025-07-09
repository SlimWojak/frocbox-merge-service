const { YIN } = require('pitchfinder');
const WavDecoder = require('wav-decoder');
const fs = require('fs');

async function extractPitch(filePath) {
  const buffer = fs.readFileSync(filePath);
  const decoded = await WavDecoder.decode(buffer);
  const { sampleRate, channelData } = decoded;
  const input = channelData[0];

  const detectPitch = YIN({ sampleRate });
  const frameSize = 1024;
  const hopSize = 512;
  const pitchFrames = [];

  for (let i = 0; i + frameSize < input.length; i += hopSize) {
    const frame = input.slice(i, i + frameSize);
    const pitch = detectPitch(frame) || 0;
    pitchFrames.push({
      time: +(i / sampleRate).toFixed(3),
      pitch: +pitch.toFixed(3),
    });
  }

  return pitchFrames;
}

module.exports = { extractPitch }; 