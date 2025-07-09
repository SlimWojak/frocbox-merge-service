const express = require('express');
const cors = require('cors');
const busboy = require('busboy');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const { scorePerformance } = require('./helpers/score-performance');

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
    const busboyInstance = busboy({ headers: req.headers });
    let audioFilePath = null;
    let formFields = {};
    let fileWritePromises = [];

    console.log('🔄 [BUSBOY] Initializing busboy processing...');

    // Handle file uploads
    busboyInstance.on('file', (fieldname, file, filename, encoding, mimetype) => {
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
            
            // Additional file size verification using fs.stat
            fs.stat(audioFilePath, (err, stats) => {
              if (err) {
                console.error('🎙️ [UPLOAD] ❌ Error checking file stats:', err);
              } else {
                console.log('🎙️ [UPLOAD] Saved file size:', stats?.size);
                if (stats.size === 0) {
                  console.error('🎙️ [UPLOAD] ⚠️  WARNING: Audio file is zero bytes!');
                } else {
                  // Log first 100 bytes of the audio file to verify integrity
                  try {
                    const buffer = fs.readFileSync(audioFilePath);
                    const first100Bytes = buffer.slice(0, 100);
                    console.log('🎙️ [UPLOAD] First 100 bytes (hex):', first100Bytes.toString('hex'));
                    console.log('🎙️ [UPLOAD] First 100 bytes (base64):', first100Bytes.toString('base64'));
                    
                    // Check if it looks like a valid WebM file (starts with specific magic bytes)
                    const magicBytes = buffer.slice(0, 4);
                    console.log('🎙️ [UPLOAD] File magic bytes:', magicBytes.toString('hex'));
                    
                    // WebM files start with EBML header (0x1A45DFA3)
                    if (magicBytes.toString('hex').startsWith('1a45dfa3')) {
                      console.log('🎙️ [UPLOAD] ✅ Detected WebM/EBML format');
                    } else {
                      console.log('🎙️ [UPLOAD] ⚠️  File does not appear to be WebM format');
                    }
                  } catch (readError) {
                    console.error('🎙️ [UPLOAD] ❌ Error reading audio file for inspection:', readError);
                  }
                }
              }
            });
            
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
    busboyInstance.on('field', (fieldname, value) => {
      console.log('📝 [FORM] 🔥 FIELD EVENT FIRED - busboy.on("field") callback executing');
      console.log('📝 [FORM] Field received:', fieldname, '=', value);
      formFields[fieldname] = value;
      
      // Special logging for videoUrl
      if (fieldname === 'videoUrl') {
        console.log('📺 [VIDEO] Full videoUrl received:', value);
      }
    });

    // Handle completion
    busboyInstance.on('finish', async () => {
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

    busboyInstance.on('error', (error) => {
      console.error('❌ [BUSBOY] 🔥 ERROR EVENT FIRED - busboy.on("error") callback executing');
      console.error('❌ Busboy error:', error);
      reject(error);
    });

    // Start processing
    console.log('🚀 [BUSBOY] Starting req.pipe(busboy)...');
    req.pipe(busboyInstance);
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

    // Verify the audio file is readable and non-empty
    console.log('🎙️ [UPLOAD] Verifying audio file readability...');
    try {
      const readStream = fs.createReadStream(audioFilePath);
      readStream.on('error', err => {
        console.error('🎙️ [UPLOAD] Error reading audio file:', err);
      });
      readStream.on('open', () => {
        console.log('🎙️ [UPLOAD] ✅ Audio file successfully opened for reading');
      });
      // Close the stream immediately since we're just testing readability
      readStream.destroy();
    } catch (readError) {
      console.error('🎙️ [UPLOAD] ❌ Failed to create readStream:', readError);
    }

    // Validate audio file with ffprobe before proceeding
    console.log('🔍 [FFPROBE] Validating audio file format...');
    try {
      const ffprobeCmd = `ffprobe -v error -show_format -show_streams "${audioFilePath}"`;
      console.log('🔍 [FFPROBE] Command:', ffprobeCmd);
      
      const ffprobeResult = await execAsync(ffprobeCmd);
      console.log('🔍 [FFPROBE] ✅ Audio file validation successful');
      console.log('🔍 [FFPROBE] Format info:', ffprobeResult.stdout);
      
      // Check if there are any audio streams
      if (ffprobeResult.stdout.includes('codec_type=audio')) {
        console.log('🔍 [FFPROBE] ✅ Audio stream detected');
      } else {
        console.log('🔍 [FFPROBE] ⚠️  No audio stream detected in file');
      }
    } catch (ffprobeError) {
      console.error('🔍 [FFPROBE] ❌ Audio file validation failed:', ffprobeError.message);
      console.error('🔍 [FFPROBE] Error details:', ffprobeError.stderr || ffprobeError.stdout);
      console.log('[END] Merge route failed at ffprobe validation stage');
      return res.status(400).json({ 
        error: 'Invalid audio file format', 
        details: ffprobeError.message,
        ffprobeOutput: ffprobeError.stderr || ffprobeError.stdout
      });
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
    console.log('📺 [VIDEO] Full video URL:', videoUrl);
    console.log('📺 [VIDEO] URL length:', videoUrl.length);
    console.log('📺 [VIDEO] URL protocol:', videoUrl.startsWith('https://') ? 'HTTPS' : videoUrl.startsWith('http://') ? 'HTTP' : 'Unknown');
    
    // Download backing track
    let videoResponse;
    try {
      console.log('📺 [VIDEO] Initiating fetch...');
      videoResponse = await fetch(videoUrl);
      console.log('📺 [VIDEO] ✅ Fetch response - Status:', videoResponse.status, 'StatusText:', videoResponse.statusText);
      console.log('📺 [VIDEO] Response headers:', {
        'content-type': videoResponse.headers.get('content-type'),
        'content-length': videoResponse.headers.get('content-length'),
        'content-encoding': videoResponse.headers.get('content-encoding'),
        'accept-ranges': videoResponse.headers.get('accept-ranges'),
        'server': videoResponse.headers.get('server'),
        'etag': videoResponse.headers.get('etag')
      });
      
      // Log all response headers for debugging
      const allHeaders = {};
      videoResponse.headers.forEach((value, key) => {
        allHeaders[key] = value;
      });
      console.log('📺 [VIDEO] All response headers:', allHeaders);
      
    } catch (downloadError) {
      console.error('📺 [VIDEO] ❌ Download failed:', downloadError.message);
      console.error('📺 [VIDEO] Download error stack:', downloadError.stack);
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
      
      // Log first 100 bytes of video file to verify integrity
      try {
        const videoFileBuffer = fs.readFileSync(backingTrackPath);
        const first100Bytes = videoFileBuffer.slice(0, 100);
        console.log('📺 [VIDEO] First 100 bytes (hex):', first100Bytes.toString('hex'));
        console.log('📺 [VIDEO] First 100 bytes (base64):', first100Bytes.toString('base64'));
        
        // Check if it looks like a valid MP4 file (starts with ftyp box)
        const magicBytes = videoFileBuffer.slice(0, 12);
        console.log('📺 [VIDEO] File magic bytes:', magicBytes.toString('hex'));
        
        // MP4 files typically have 'ftyp' at offset 4-7
        if (magicBytes.slice(4, 8).toString('ascii') === 'ftyp') {
          console.log('📺 [VIDEO] ✅ Detected MP4 format');
        } else {
          console.log('📺 [VIDEO] ⚠️  File does not appear to be MP4 format');
        }
      } catch (readError) {
        console.error('📺 [VIDEO] ❌ Error reading video file for inspection:', readError);
      }
      
      // Validate video file with ffprobe before proceeding
      console.log('🔍 [FFPROBE] Validating video file format...');
      try {
        const ffprobeCmd = `ffprobe -v error -show_format -show_streams "${backingTrackPath}"`;
        console.log('🔍 [FFPROBE] Command:', ffprobeCmd);
        
        const ffprobeResult = await execAsync(ffprobeCmd);
        console.log('🔍 [FFPROBE] ✅ Video file validation successful');
        console.log('🔍 [FFPROBE] Video format info:', ffprobeResult.stdout);
        
        // Check if there are video and audio streams
        if (ffprobeResult.stdout.includes('codec_type=video')) {
          console.log('🔍 [FFPROBE] ✅ Video stream detected');
        } else {
          console.log('🔍 [FFPROBE] ⚠️  No video stream detected in file');
        }
        
        if (ffprobeResult.stdout.includes('codec_type=audio')) {
          console.log('🔍 [FFPROBE] ✅ Audio stream detected in video');
        } else {
          console.log('🔍 [FFPROBE] ⚠️  No audio stream detected in video');
        }
      } catch (ffprobeError) {
        console.error('🔍 [FFPROBE] ❌ Video file validation failed:', ffprobeError.message);
        console.error('🔍 [FFPROBE] Error details:', ffprobeError.stderr || ffprobeError.stdout);
        console.log('[END] Merge route failed at video ffprobe validation stage');
        return res.status(400).json({ 
          error: 'Invalid video file format', 
          details: ffprobeError.message,
          ffprobeOutput: ffprobeError.stderr || ffprobeError.stdout
        });
      }
      
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

      // Convert WebM audio to WAV for scoring
      console.log('🎯 [SCORING] Converting audio to WAV for analysis...');
      const wavPath = `/tmp/scoring-${Date.now()}.wav`;
      const wavConvertCmd = `ffmpeg -y -i "${file.path}" -ac 1 -ar 44100 "${wavPath}"`;
      console.log('🎯 [SCORING] WAV conversion command:', wavConvertCmd);
      
      let scoreResult = null;
      try {
        await execAsync(wavConvertCmd);
        console.log('🎯 [SCORING] ✅ WAV conversion completed');
        
        // Run scoring analysis
        scoreResult = await scorePerformance(wavPath);
        console.log('🎯 [SCORING] ✅ Performance scoring completed:', scoreResult);
        
        // Clean up WAV file
        fs.unlinkSync(wavPath);
        console.log('🎯 [SCORING] WAV file cleaned up');
        
      } catch (scoringError) {
        console.error('🎯 [SCORING] ❌ Scoring failed:', scoringError.message);
        // Use default scores if scoring fails
        scoreResult = {
          pitch: 50,
          rhythm: 50,
          total: 50,
          verdict: "🤔 Analysis failed"
        };
      }

      // Generate unique video ID
      const videoUid = uuidv4();
      console.log('🆔 [RESPONSE] Generated videoUid:', videoUid);

      // Convert video to base64 for JSON response
      const videoBase64 = `data:video/mp4;base64,${videoData.toString('base64')}`;
      console.log('📹 [RESPONSE] Video converted to base64 - Size:', videoBase64.length, 'chars');

      // Return JSON response with scoring
      const jsonResponse = {
        success: true,
        videoUid,
        videoUrl: videoBase64,
        scoreResult,
        tokenId: 'temp-token-id'
      };

      console.log('🎯 [SCORING] Final score before response:', scoreResult);
      console.log('✅ [RESPONSE] Setting headers and sending JSON response...');
      res.setHeader('Content-Type', 'application/json');
      
      console.log('[END] Merge route completed successfully - About to send JSON response');
      res.json(jsonResponse);
      console.log('✅ [RESPONSE] 🎉 JSON response sent successfully');
      
    } catch (readError) {
      console.error('✅ [RESPONSE] ❌ Failed to read output file:', readError.message);
      console.log('[END] Merge route failed at response stage');
      return res.status(500).json({ error: 'Failed to read merged video', details: readError.message });
    }

    // Cleanup
    console.log('🧹 [CLEANUP] Removing temporary files...');
    try {
      console.log('🧹 [CLEANUP] Removing audio file:', file.path);
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      console.log('🧹 [CLEANUP] Removing video file:', backingTrackPath);
      if (fs.existsSync(backingTrackPath)) fs.unlinkSync(backingTrackPath);
      console.log('🧹 [CLEANUP] Removing output file:', outputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
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