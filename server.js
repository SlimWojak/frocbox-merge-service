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
app.post('/merge', async (req, res) => {
  console.log('[START] Merge route processing initiated');
  console.log('[🛬] POST /merge received');
  console.log('📋 Request details:', {
    method: req.method,
    url: req.url,
    headers: req.headers,
    timestamp: new Date().toISOString()
  });

  // Wrap busboy processing in Promise to ensure proper async handling
  const processBusboy = new Promise((resolve, reject) => {
    const busboy = new Busboy({ headers: req.headers });
    let audioFilePath = null;
    let formFields = {};
    let fileWritePromises = [];

    console.log('🔄 [BUSBOY] Initializing busboy processing...');

    // Handle file uploads
    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      console.log('🎙️ [UPLOAD] 🔥 FILE EVENT FIRED - busboy.on("file") callback executing');
      console.log('🎙️ [UPLOAD] File received via busboy:', {
        fieldname,
        filename,
        encoding,
        mimetype
      });

      if (fieldname === 'recordedAudio') {
        audioFilePath = `/tmp/audio-${Date.now()}.webm`;
        console.log('🎙️ [UPLOAD] Saving audio file to:', audioFilePath);
        
        // Create promise for file write completion
        const fileWritePromise = new Promise((fileResolve, fileReject) => {
          const writeStream = fs.createWriteStream(audioFilePath);
          file.pipe(writeStream);
          
          writeStream.on('close', () => {
            const stats = fs.statSync(audioFilePath);
            console.log('🎙️ [UPLOAD] ✅ Audio file saved - Path:', audioFilePath, 'Size:', stats.size, 'bytes');
            fileResolve();
          });
          
          writeStream.on('error', (error) => {
            console.error('🎙️ [UPLOAD] ❌ File write error:', error);
            fileReject(error);
          });
        });
        
        fileWritePromises.push(fileWritePromise);
      } else {
        console.log('⚠️  [UPLOAD] Unexpected file field:', fieldname);
        file.resume(); // Drain the file stream
      }
    });

    // Handle form fields
    busboy.on('field', (fieldname, value) => {
      console.log('📝 [FORM] 🔥 FIELD EVENT FIRED - busboy.on("field") callback executing');
      console.log('📝 [FORM] Field received:', fieldname, '=', value);
      formFields[fieldname] = value;
      
      // Special logging for videoUrl
      if (fieldname === 'videoUrl') {
        console.log('📺 [VIDEO] Full videoUrl received:', value);
      }
    });

    // Handle completion
    busboy.on('finish', async () => {
      console.log('🎯 [BUSBOY] 🔥 FINISH EVENT FIRED - busboy.on("finish") callback executing');
      console.log('🏁 Busboy parsing completed');
      console.log('📦 Form fields:', formFields);
      console.log('📁 Audio file path:', audioFilePath);

      try {
        // Wait for all file writes to complete
        console.log('⏳ [BUSBOY] Waiting for file writes to complete...');
        await Promise.all(fileWritePromises);
        console.log('✅ [BUSBOY] All file writes completed');
        
        // Resolve with the processed data
        console.log('🎯 [BUSBOY] 🔥 RESOLVING PROMISE - allowing route to continue');
        resolve({ audioFilePath, formFields });
      } catch (error) {
        console.error('❌ [BUSBOY] Error waiting for file writes:', error);
        reject(error);
      }
    });

    busboy.on('error', (error) => {
      console.error('❌ [BUSBOY] 🔥 ERROR EVENT FIRED - busboy.on("error") callback executing');
      console.error('❌ Busboy error:', error);
      reject(error);
    });

    // Start processing
    console.log('🚀 [BUSBOY] Starting req.pipe(busboy)...');
    req.pipe(busboy);
  });

  try {
    console.log('⏳ [ROUTE] Waiting for busboy processing to complete...');
    const { audioFilePath, formFields } = await processBusboy;
         console.log('✅ [ROUTE] Busboy processing completed successfully');
     console.log('📁 Final audio path:', audioFilePath);
     console.log('📝 Final form fields:', formFields);

    if (!audioFilePath) {
      console.error('❌ No recordedAudio file received');
      console.log('[END] Merge route failed - no audio file');
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
      console.log('[END] Merge route failed - no video URL');
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
      console.log('[END] Merge route failed at video download stage');
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
      console.log('[END] Merge route failed at video save stage');
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
      console.log('[END] Merge route failed at FFmpeg stage');
      return res.status(500).json({ error: 'FFmpeg processing failed', details: ffmpegError.message });
    }

    // Check if output file exists
    console.log('✅ [RESPONSE] Checking output file...');
    if (!fs.existsSync(outputPath)) {
      console.error('✅ [RESPONSE] ❌ Output file not created:', outputPath);
      console.log('[END] Merge route failed - output file not created');
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
      
      // Force log flush with small delay before response
      console.log('[END] Merge route completed successfully - About to send response');
      setTimeout(() => {
        res.send(videoData);
        console.log('✅ [RESPONSE] 🎉 Response sent successfully - Total size:', videoData.length, 'bytes');
      }, 100);
    } catch (readError) {
      console.error('✅ [RESPONSE] ❌ Failed to read output file:', readError.message);
      console.log('[END] Merge route failed at response stage');
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

  } catch (busboyError) {
    console.error('❌ [ROUTE] Busboy processing failed:', busboyError);
    console.log('[END] Merge route failed during busboy processing:', busboyError.message);
    res.status(400).json({ error: 'Error parsing multipart data', details: busboyError.message });
  }
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