const { extractPitch } = require('./extract-pitch-core');
const { extractRhythm } = require('./extract-rhythm-core');

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// 🎯 REFINED: Reduced skew from 1.5 to 1.3 for more realistic distribution
function bellCurve(rawRatio, skew = 1.3) {
  const x = Math.max(0, Math.min(rawRatio, 1));
  return Math.pow(x, skew) * 100;
}

// 🎯 ENHANCED: More granular verdicts for better user feedback
function getMemeVerdict(score) {
  // Top Scores (100+)
  if (score >= 100) return 'Mic God 👑';
  if (score >= 95) return 'Crypto Legend 💎';
  if (score >= 90) return 'Moonbound 🚀';
  
  // High Scores (85-70)
  if (score >= 85) return 'Frog King 🐸';
  if (score >= 80) return 'Unstoppable 💥';
  if (score >= 75) return 'The Belter™️ 🔥';
  if (score >= 70) return 'Mildly Rekt 😅';
  
  // Mid Scores (65-50)
  if (score >= 65) return 'On The Rise 📈';
  if (score >= 60) return 'Getting There 👍';
  if (score >= 55) return 'Room for Growth 📈';
  if (score >= 50) return 'Keep Practicing 💪';
  
  // Low Scores (45-0)
  if (score >= 45) return 'Not Bad 🛑';
  if (score >= 40) return 'Almost Rugged 😬';
  if (score >= 35) return 'Close But No 🍄';
  if (score >= 30) return 'Cat Blender 🐱💥';
  if (score >= 20) return 'WTF Was That? 🤨';
  if (score >= 10) return 'Rugged Again 🏚️';
  return 'Dead Inside 💀';
}

// 🎯 NEW: Calculate duration penalty for recordings under 60 seconds
function calculateDurationPenalty(durationSeconds) {
  if (durationSeconds < 60) {
    console.log(`🎯 [DURATION] Recording too short: ${durationSeconds}s - Applying 20% penalty`);
    return 0.8; // 20% penalty
  }
  return 1.0; // No penalty
}

// 🎯 NEW: Exponential scaling for rhythm to prevent easy 100s
function scaleRhythmScore(rawRhythmScore) {
  // Apply exponential flattening to prevent scores from hitting 100 too easily
  // This creates a more realistic distribution
  const scaledScore = Math.pow(rawRhythmScore / 100, 0.8) * 100;
  return Math.min(scaledScore, 98); // Cap at 98 to reserve 99-100 for truly exceptional
}

async function scorePerformance(audioFilePath) {
  try {
    console.log('🎯 [SCORING] Starting performance analysis...');
    console.log('🎯 [SCORING] Audio file:', audioFilePath);
    
    // Extract pitch and rhythm data
    const pitchFrames = await extractPitch(audioFilePath);
    const { energyFrames, activityRatio: extractedActivityRatio } = await extractRhythm(audioFilePath);
    
    console.log('🎯 [SCORING] Pitch frames extracted:', pitchFrames.length);
    console.log('🎯 [SCORING] Energy frames extracted:', energyFrames?.length || 'undefined');
    
    // Calculate activity ratio (rhythm component) - use the one from extractRhythm
    const activityRatio = extractedActivityRatio;
    console.log('🎯 [SCORING] Activity ratio:', activityRatio);
    
    // Calculate pitch accuracy
    const pitchValues = pitchFrames.map(f => f.pitch);
    const validPitches = pitchFrames.filter(p => p.pitch && p.pitch > 50 && p.pitch < 1500).map(p => p.pitch);
    
    console.log('🎯 [SCORING] Total pitch frames:', pitchFrames.length);
    console.log('🎯 [SCORING] Valid pitch frames:', validPitches.length);
    
    // Calculate pitch accuracy and diversity
    const pitchAccuracy = validPitches.length / pitchFrames.length;
    const pitchDiversity = validPitches.length > 0 ? 
      Math.min(1, (Math.max(...validPitches) - Math.min(...validPitches)) / 1000) : 0;
    
    // 🎯 ENHANCED: Calculate duration from frames (assuming 44.1kHz, 512 hop size)
    const durationSeconds = (pitchFrames.length * 512) / 44100;
    const durationPenalty = calculateDurationPenalty(durationSeconds);
    
    // Calculate base scores using refined bell curve
    const pitchScore = bellCurve(pitchAccuracy);
    const rawRhythmScore = bellCurve(activityRatio);
    
    // 🎯 ENHANCED: Apply exponential scaling to rhythm score
    const rhythmScore = scaleRhythmScore(rawRhythmScore);
    
    console.log('🎯 [SCORING] Raw rhythm score:', rawRhythmScore);
    console.log('🎯 [SCORING] Scaled rhythm score:', rhythmScore);
    
    // Calculate final score with improved distribution
    const baseScore = (pitchScore * 0.4 + rhythmScore * 0.6);
    
    // 🎯 ENHANCED: Apply duration penalty and normalize to bell curve
    const finalScore = Math.round(baseScore * durationPenalty * 10) / 10;
    
    // 🎯 ENHANCED: Add score normalization to ensure realistic distribution
    const normalizedScore = Math.min(finalScore, 95); // Cap at 95 to make 95+ truly exceptional
    
    const verdict = getMemeVerdict(normalizedScore);
    
    const result = {
      pitchScore: Math.round(pitchScore * 10) / 10,
      rhythmScore: Math.round(rhythmScore * 10) / 10,
      finalScore: normalizedScore,
      verdict: verdict,
      clarity: Math.round(pitchAccuracy * 100),
      midiRange: Math.round(pitchDiversity * 100),
      pitchAccuracy: pitchAccuracy,
      pitchDiversity: pitchDiversity,
      activityRatio: activityRatio,
      durationSeconds: Math.round(durationSeconds * 10) / 10,
      durationPenalty: durationPenalty < 1 ? true : false
    };
    
    console.log('🎯 [SCORING] ✅ Scoring completed:', result);
    return result;
    
  } catch (error) {
    console.error('🎯 [SCORING] ❌ Error during scoring:', error);
    // Return default scores on error
    return {
      pitchScore: 25,
      rhythmScore: 25,
      finalScore: 25,
      verdict: 'Analysis Error 🔧',
      clarity: 0,
      midiRange: 0,
      pitchAccuracy: 0,
      pitchDiversity: 0,
      activityRatio: 0,
      durationSeconds: 0,
      durationPenalty: false
    };
  }
}

module.exports = { scorePerformance }; 