const { extractPitch } = require('./extract-pitch-core');
const { extractRhythm } = require('./extract-rhythm-core');

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function bellCurve(x, peak) {
  return Math.exp(-Math.pow(x - peak, 2));
}

function getMemeVerdict(score) {
  if (score >= 85) return "🔥 FIRE!";
  if (score >= 75) return "🎯 Solid!";
  if (score >= 65) return "👍 Not bad!";
  if (score >= 50) return "🤔 Questionable...";
  if (score >= 35) return "😬 Cringe level rising...";
  return "💀 RIP";
}

async function scorePerformance(audioFilePath) {
  try {
    console.log('🎯 [SCORING] Starting performance analysis...');
    console.log('🎯 [SCORING] Audio file:', audioFilePath);
    
    // Extract pitch and rhythm data
    const pitchFrames = await extractPitch(audioFilePath);
    const { energyFrames, activityRatio } = await extractRhythm(audioFilePath);
    
    console.log('🎯 [SCORING] Pitch frames extracted:', pitchFrames.length);
    console.log('🎯 [SCORING] Energy frames extracted:', energyFrames.length);
    console.log('🎯 [SCORING] Activity ratio:', activityRatio);

    // Pitch Scoring Logic
    const pitchValues = pitchFrames.map(f => f.pitch);
    const validPitches = pitchFrames.filter(p => p.pitch && p.pitch >= 80 && p.pitch <= 1200).map(p => p.pitch);
    
    console.log('🎯 [SCORING] Total pitch frames:', pitchValues.length);
    console.log('🎯 [SCORING] Valid pitch frames:', validPitches.length);
    
    const pitchAccuracy = validPitches.length / pitchValues.length;

    let pitchVar = 0;
    if (validPitches.length > 0) {
      const min = Math.min(...validPitches);
      const max = Math.max(...validPitches);
      pitchVar = max - min;
    }

    const pitchDiversity = Math.min(pitchVar / 300, 1); // Normalize spread
    const comboScore = pitchAccuracy * pitchDiversity;
    const adjustedScore = comboScore < 0.05 ? 0 : bellCurve(comboScore, 1.5);
    const pitchScore = Math.round(adjustedScore * 100); // Convert to 0-100 scale

    // Rhythm Score
    const rhythmScore = clamp((activityRatio || 0) * 120, 0, 100);

    // Final Score
    const finalScore = Math.round((pitchScore * 0.4 + rhythmScore * 0.6));
    const verdict = getMemeVerdict(finalScore);

    const result = {
      pitch: pitchScore,
      rhythm: rhythmScore,
      total: finalScore,
      verdict,
      pitchAccuracy,
      pitchDiversity,
      activityRatio
    };

    console.log('🎯 [SCORING] ✅ Scoring completed:', result);
    return result;

  } catch (error) {
    console.error('🎯 [SCORING] ❌ Scoring failed:', error);
    // Return default scores if scoring fails
    return {
      pitch: 50,
      rhythm: 50,
      total: 50,
      verdict: "🤔 Analysis failed",
      error: error.message
    };
  }
}

module.exports = { scorePerformance }; 