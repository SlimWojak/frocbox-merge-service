const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const execAsync = promisify(exec);
const upload = multer({ dest: '/tmp/' });

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.post('/merge', upload.single('recordedAudio'), async (req, res) => {
  try {
    const { voiceGain = 0.6, trackGain = 1.7, videoUrl } = req.body;
    
    if (!req.file || !videoUrl) {
      return res.status(400).json({ error: 'Missing audio file or video URL' });
    }

    // Download backing track
    const videoResponse = await fetch(videoUrl);
    const backingTrackPath = `/tmp/backing-${Date.now()}.mp4`;
    const videoBuffer = await videoResponse.arrayBuffer();
    fs.writeFileSync(backingTrackPath, Buffer.from(videoBuffer));

    // FFmpeg merge command
    const outputPath = `/tmp/merged-${Date.now()}.mp4`;
    const ffmpegCmd = `ffmpeg -y -ss 5.1 -i "${req.file.path}" -i "${backingTrackPath}" \
      -filter_complex "[0:a]aresample=async=1:first_pts=0,compand=attacks=0:points=-90/-90|-70/-20|-20/-5|0/0|20/0:soft-knee=6,equalizer=f=1800:width_type=h:width=200:g=3,dynaudnorm,highpass=f=300,volume=${voiceGain},agate=threshold=-30dB:ratio=2:attack=5:release=100[a0];[1:a]volume=${trackGain}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]" \
      -map 1:v:0 -map "[a]" -c:v copy -c:a aac -b:a 192k -async 1 -shortest -movflags +faststart \
      "${outputPath}"`;

    await execAsync(ffmpegCmd);

    // Return merged video as response
    const videoData = fs.readFileSync(outputPath);
    res.setHeader('Content-Type', 'video/mp4');
    res.send(videoData);

    // Cleanup
    fs.unlinkSync(req.file.path);
    fs.unlinkSync(backingTrackPath);
    fs.unlinkSync(outputPath);

  } catch (error) {
    console.error('Merge failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Merge service running on port ${port}`);
}); 