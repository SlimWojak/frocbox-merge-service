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
    console.log('🎙️ [UPLOAD] File received via busboy:', {
      fieldname,
      filename,
      encoding,
      mimetype
    });

    if (fieldname === 'recordedAudio') {
      audioFilePath = `/tmp/audio-${Date.now()}.webm`;
      console.log('🎙️ [UPLOAD] Saving audio file to:', audioFilePath);
      
      const writeStream = fs.createWriteStream(audioFilePath);
      file.pipe(writeStream);
      
      writeStream.on('close', () => {
        const stats = fs.statSync(audioFilePath);
        console.log('🎙️ [UPLOAD] ✅ Audio file saved - Path:', audioFilePath, 'Size:', stats.size, 'bytes');
      });
    } else {
      console.log('⚠️  [UPLOAD] Unexpected file field:', fieldname);
      file.resume(); // Drain the file stream
    }
  });

  // Handle form fields
  busboy.on('field', (fieldname, value) => {
    console.log('📝 [FORM] Field received:', fieldname, '=', value);
    formFields[fieldname] = value;
    
    // Special logging for videoUrl
    if (fieldname === 'videoUrl') {
      console.log('📺 [VIDEO] Full videoUrl received:', value);
    }
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

    console.log('📺 [VIDEO] Starting download from:', videoUrl);
    
    // Download backing track
    let videoResponse;
    try {
      console.log('📺 [VIDEO] Initiating fetch...');
      videoResponse = await fetch(videoUrl);
      console.log('📺 [VIDEO] ✅ Fetch response - Status:', videoResponse.status, 'StatusText:', videoResponse.statusText);
      console.log('📺 [VIDEO] Response headers:', {
        'content-type': videoResponse.headers.get('content-type'),
        'content-length': videoResponse.headers.get('content-length')
      });
    } catch (downloadError) {
      console.error('📺 [VIDEO] ❌ Download failed:', downloadError.message);
      return res.status(500).json({ error: 'Failed to download video URL' });
    }

    const backingTrackPath = `/tmp/backing-${Date.now()}.mp4`;
    console.log('📺 [VIDEO] Saving backing track to:', backingTrackPath);
    
    try {
      console.log('📺 [VIDEO] Converting response to buffer...');
      const videoBuffer = await videoResponse.arrayBuffer();
      console.log('📺 [VIDEO] Buffer size:', videoBuffer.byteLength, 'bytes');
      fs.writeFileSync(backingTrackPath, Buffer.from(videoBuffer));
      const savedStats = fs.statSync(backingTrackPath);
      console.log('📺 [VIDEO] ✅ Backing track saved - Path:', backingTrackPath, 'Size:', savedStats.size, 'bytes');
    } catch (saveError) {
      console.error('📺 [VIDEO] ❌ Failed to save backing track:', saveError.message);
      return res.status(500).json({ error: 'Failed to save backing track' });
    }

    // FFmpeg merge command
    const outputPath = `/tmp/merged-${Date.now()}.mp4`;
    console.log('🎬 [FFMPEG] Starting merge process...');
    console.log('🎬 [FFMPEG] Input audio:', file.path);
    console.log('🎬 [FFMPEG] Input video:', backingTrackPath);
    console.log('🎬 [FFMPEG] Output path:', outputPath);
    console.log('🎬 [FFMPEG] Voice gain:', voiceGain, 'Track gain:', trackGain);
    
    const ffmpegCmd = `ffmpeg -y -ss 5.1 -i "${file.path}" -i "${backingTrackPath}" \
      -filter_complex "[0:a]aresample=async=1:first_pts=0,compand=attacks=0:points=-90/-90|-70/-20|-20/-5|0/0|20/0:soft-knee=6,equalizer=f=1800:width_type=h:width=200:g=3,dynaudnorm,highpass=f=300,volume=${voiceGain},agate=threshold=-30dB:ratio=2:attack=5:release=100[a0];[1:a]volume=${trackGain}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]" \
      -map 1:v:0 -map "[a]" -c:v copy -c:a aac -b:a 192k -async 1 -shortest -movflags +faststart \
      "${outputPath}"`;

    console.log('🎬 [FFMPEG] Exact command:', ffmpegCmd);
    console.log('🎬 [FFMPEG] ⏱️  Execution starting...');

    try {
      const startTime = Date.now();
      const result = await execAsync(ffmpegCmd);
      const duration = Date.now() - startTime;
      console.log('🎬 [FFMPEG] ✅ Merge completed successfully in', duration, 'ms');
      if (result.stdout) console.log('🎬 [FFMPEG] stdout:', result.stdout);
      if (result.stderr) console.log('🎬 [FFMPEG] stderr:', result.stderr);
    } catch (ffmpegError) {
      console.error('🎬 [FFMPEG] ❌ Merge failed:', ffmpegError.message);
      if (ffmpegError.stdout) console.error('🎬 [FFMPEG] stdout:', ffmpegError.stdout);
      if (ffmpegError.stderr) console.error('🎬 [FFMPEG] stderr:', ffmpegError.stderr);
      return res.status(500).json({ error: 'FFmpeg processing failed', details: ffmpegError.message });
    }

    // Check if output file exists
    console.log('✅ [RESPONSE] Checking output file...');
    if (!fs.existsSync(outputPath)) {
      console.error('✅ [RESPONSE] ❌ Output file not created:', outputPath);
      return res.status(500).json({ error: 'Merge output file not created' });
    }

    const outputStats = fs.statSync(outputPath);
    console.log('✅ [RESPONSE] Output file exists - Size:', outputStats.size, 'bytes');

    console.log('✅ [RESPONSE] Reading merged video file...');
    try {
      const videoData = fs.readFileSync(outputPath);
      console.log('✅ [RESPONSE] Video data loaded - Size:', videoData.length, 'bytes');

      // Return merged video as response
      console.log('✅ [RESPONSE] Setting headers and sending response...');
      res.setHeader('Content-Type', 'video/mp4');
      res.send(videoData);
      console.log('✅ [RESPONSE] 🎉 Response sent successfully - Total size:', videoData.length, 'bytes');
    } catch (readError) {
      console.error('✅ [RESPONSE] ❌ Failed to read output file:', readError.message);
      return res.status(500).json({ error: 'Failed to read merged video', details: readError.message });
    }

    // Cleanup
    console.log('🧹 [CLEANUP] Removing temporary files...');
    try {
      console.log('🧹 [CLEANUP] Removing audio file:', file.path);
      fs.unlinkSync(file.path);
      console.log('🧹 [CLEANUP] Removing video file:', backingTrackPath);
      fs.unlinkSync(backingTrackPath);
      console.log('🧹 [CLEANUP] Removing output file:', outputPath);
      fs.unlinkSync(outputPath);
      console.log('🧹 [CLEANUP] ✅ All temporary files removed');
    } catch (cleanupError) {
      console.warn('🧹 [CLEANUP] ⚠️  Cleanup failed:', cleanupError.message);
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