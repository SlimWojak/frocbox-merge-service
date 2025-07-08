const express = require('express');
const cors = require('cors');
const Busboy = require('busboy');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const execAsync = promisify(exec);

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

// CRITICAL: Handle /merge route BEFORE any body parsing middleware to bypass GraphQL interference
app.post('/merge', (req, res) => {
  console.log('[🛬] POST /merge received');
  console.log('📋 Request details:', {
    method: req.method,
    url: req.url,
    headers: req.headers,
    timestamp: new Date().toISOString()
  });

  const busboy = new Busboy({ headers: req.headers });
  let audioFilePath = null;
  let formFields = {};
  let processingComplete = false;

  // Handle file uploads
  busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
    console.log('📁 File received via busboy:', {
      fieldname,
      filename,
      encoding,
      mimetype
    });

    if (fieldname === 'recordedAudio') {
      audioFilePath = `/tmp/audio-${Date.now()}.webm`;
      console.log('💾 Saving audio file to:', audioFilePath);
      
      const writeStream = fs.createWriteStream(audioFilePath);
      file.pipe(writeStream);
      
      writeStream.on('close', () => {
        console.log('✅ Audio file saved successfully');
      });
    } else {
      console.log('⚠️  Unexpected file field:', fieldname);
      file.resume(); // Drain the file stream
    }
  });

  // Handle form fields
  busboy.on('field', (fieldname, value) => {
    console.log('📝 Form field received:', fieldname, '=', value);
    formFields[fieldname] = value;
  });

  // Handle completion
  busboy.on('finish', async () => {
    console.log('🏁 Busboy parsing completed');
    console.log('📦 Form fields:', formFields);
    console.log('📁 Audio file path:', audioFilePath);

    if (processingComplete) return; // Prevent double processing
    processingComplete = true;

    try {
      if (!audioFilePath) {
        console.error('❌ No recordedAudio file received');
        return res.status(400).json({ error: 'No recorded audio uploaded' });
      }

      // Create file object similar to multer format
      const file = {
        fieldname: 'recordedAudio',
        path: audioFilePath,
        filename: path.basename(audioFilePath),
        mimetype: 'audio/webm'
      };

      console.log('✅ File object created:', file);

      const { voiceGain = 0.6, trackGain = 1.7, videoUrl } = formFields;
    
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
      console.error('❌ Error in merge endpoint:', error);
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  });

  // Handle busboy errors
  busboy.on('error', (error) => {
    console.error('❌ Busboy error:', error);
    if (!processingComplete) {
      processingComplete = true;
      res.status(400).json({ error: 'Error parsing multipart data', details: error.message });
    }
  });

  // Pipe the request to busboy
  req.pipe(busboy);
});

// Apply JSON parsing to all other routes (after /merge to avoid interference)
app.use(express.json());

// Add a simple health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Merge service running on port ${port}`);
}); 