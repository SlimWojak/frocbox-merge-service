const express = require('express');
const cors = require('cors');
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

// Configure CORS to allow requests from your frontend domain
const corsOptions = {
  origin: [
    'https://sing.frocofficial.com',
    'http://localhost:3000', // for local development
    'https://frocbox-mvp.vercel.app' // if you have a Vercel deployment
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// Add a simple health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.post('/merge', upload.any(), async (req, res) => {
  console.log('[🛬] POST /merge received');
  console.log('📋 Request details:', {
    method: req.method,
    url: req.url,
    headers: req.headers,
    timestamp: new Date().toISOString()
  });

  try {
    console.log('📦 req.body:', req.body);
    console.log('📁 req.files:', req.files);
    
    // Find the recordedAudio file from the files array
    const file = req.files?.find(f => f.fieldname === 'recordedAudio');
    
    if (!file) {
      console.error('❌ No recordedAudio file uploaded - multer.any() failed to find it');
      console.error('Available files:', req.files?.map(f => ({ fieldname: f.fieldname, originalname: f.originalname })));
      return res.status(400).json({ error: 'No recorded audio uploaded' });
    }
    
    console.log('✅ File received:', {
      fieldname: file.fieldname,
      filename: file.filename,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      path: file.path
    });

    const { voiceGain = 0.6, trackGain = 1.7, videoUrl } = req.body;
    
    console.log('🔧 Parameters:', {
      voiceGain,
      trackGain,
      videoUrl
    });
    
    if (!videoUrl) {
      console.error('❌ No videoUrl provided');
      return res.status(400).json({ error: 'Missing video URL' });
    }

    console.log('🌐 Downloading backing track from:', videoUrl);
    
    // Download backing track
    let videoResponse;
    try {
      videoResponse = await fetch(videoUrl);
      console.log('📥 Video download response:', videoResponse.status, videoResponse.statusText);
    } catch (downloadError) {
      console.error('❌ Video download failed:', downloadError);
      return res.status(500).json({ error: 'Failed to download video URL' });
    }

    const backingTrackPath = `/tmp/backing-${Date.now()}.mp4`;
    console.log('💾 Saving backing track to:', backingTrackPath);
    
    try {
      const videoBuffer = await videoResponse.arrayBuffer();
      fs.writeFileSync(backingTrackPath, Buffer.from(videoBuffer));
      console.log('✅ Backing track saved successfully');
    } catch (saveError) {
      console.error('❌ Failed to save backing track:', saveError);
      return res.status(500).json({ error: 'Failed to save backing track' });
    }

    // FFmpeg merge command
    const outputPath = `/tmp/merged-${Date.now()}.mp4`;
    console.log('🎬 Starting FFmpeg merge...');
    console.log('🎵 Audio file:', file.path);
    console.log('🎥 Video file:', backingTrackPath);
    console.log('📽️  Output file:', outputPath);
    
    const ffmpegCmd = `ffmpeg -y -ss 5.1 -i "${file.path}" -i "${backingTrackPath}" \
      -filter_complex "[0:a]aresample=async=1:first_pts=0,compand=attacks=0:points=-90/-90|-70/-20|-20/-5|0/0|20/0:soft-knee=6,equalizer=f=1800:width_type=h:width=200:g=3,dynaudnorm,highpass=f=300,volume=${voiceGain},agate=threshold=-30dB:ratio=2:attack=5:release=100[a0];[1:a]volume=${trackGain}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]" \
      -map 1:v:0 -map "[a]" -c:v copy -c:a aac -b:a 192k -async 1 -shortest -movflags +faststart \
      "${outputPath}"`;

    console.log('⚙️  FFmpeg command:', ffmpegCmd);

    try {
      await execAsync(ffmpegCmd);
      console.log('✅ FFmpeg merge completed successfully');
    } catch (ffmpegError) {
      console.error('❌ FFmpeg merge failed:', ffmpegError);
      return res.status(500).json({ error: 'FFmpeg processing failed', details: ffmpegError.message });
    }

    // Check if output file exists
    if (!fs.existsSync(outputPath)) {
      console.error('❌ Output file not created:', outputPath);
      return res.status(500).json({ error: 'Merge output file not created' });
    }

    console.log('📤 Reading merged video file...');
    const videoData = fs.readFileSync(outputPath);
    console.log('📊 Video data size:', videoData.length, 'bytes');

    // Return merged video as response
    res.setHeader('Content-Type', 'video/mp4');
    res.send(videoData);
    console.log('✅ Response sent successfully');

    // Cleanup
    console.log('🧹 Cleaning up temporary files...');
    try {
      fs.unlinkSync(file.path);
      fs.unlinkSync(backingTrackPath);
      fs.unlinkSync(outputPath);
      console.log('✅ Cleanup completed');
    } catch (cleanupError) {
      console.warn('⚠️  Cleanup failed:', cleanupError);
    }

  } catch (error) {
    console.error('❌ Merge failed - Unexpected error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Merge processing failed', 
      message: error.message,
      stack: error.stack 
    });
  }
});

app.listen(port, () => {
  console.log(`Merge service running on port ${port}`);
}); 