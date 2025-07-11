const express = require('express');
const cors = require('cors');
const multer = require('multer');
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

// Set up multer with memory storage
const upload = multer({ storage: multer.memoryStorage() });

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
app.post('/merge', upload.single('recordedAudio'), async (req, res) => {
  console.log('[START] Merge route processing initiated');
  console.log('[🛬] POST /merge received');
  console.log('📋 Request details:', {
    method: req.method,
    url: req.url,
    headers: req.headers,
    timestamp: new Date().toISOString()
  });

  try {
    // Access the uploaded file via req.file.buffer
    const audioBuffer = req.file.buffer;
    const filename = req.file.originalname;
    
    console.log('🎙️ [UPLOAD] File received via multer:', {
      fieldname: req.file.fieldname,
      filename: filename,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    if (!audioBuffer) {
      console.error('❌ No recordedAudio file received');
      console.log('[END] Merge route failed - no audio file');
      return res.status(400).json({ error: 'No recorded audio uploaded' });
    }

    // Write the buffer to /tmp like before
    const audioFilePath = `/tmp/audio-${Date.now()}-${filename}`;
    fs.writeFileSync(audioFilePath, audioBuffer);
    
    console.log('🎙️ [UPLOAD] ✅ Audio file saved - Path:', audioFilePath, 'Size:', audioBuffer.length, 'bytes');
    
    // Log first 100 bytes of the audio file to verify integrity
    try {
      const first100Bytes = audioBuffer.slice(0, 100);
      console.log('🎙️ [UPLOAD] First 100 bytes (hex):', first100Bytes.toString('hex'));
      console.log('🎙️ [UPLOAD] First 100 bytes (base64):', first100Bytes.toString('base64'));
      
      // Check if it looks like a valid WebM file (starts with specific magic bytes)
      const magicBytes = audioBuffer.slice(0, 4);
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

      const { voiceGain = 0.6, trackGain = 1.7, videoUrl } = req.body;
    
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
    
    // 🔧 Optimized for size: 360p, moderate bitrate, web streaming ready
    // 🎤 DUAL GATE FIX: Advanced dual noise gate system to prevent "horror film zooming" audio
    const ffmpegCmd = `ffmpeg -y -ss 5.1 -i "${file.path}" -i "${backingTrackPath}" \
      -filter_complex "[0:a]silenceremove=start_periods=1:start_duration=0.1:start_threshold=-10dB,aresample=async=1:first_pts=0,highpass=f=100,agate=threshold=-55dB:ratio=25:attack=5:release=250,agate=threshold=-50dB:ratio=20:attack=5:release=250,equalizer=f=1800:width_type=h:width=200:g=3,equalizer=f=8000:width_type=h:width=1000:g=-2,volume=0.01[a0];[1:a]volume=${trackGain}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]" \
      -map 1:v:0 -map "[a]" -vf scale=640:360 -b:v 800k -c:v libx264 -preset fast -c:a aac -b:a 192k -async 1 -shortest -movflags +faststart \
      "${outputPath}"`;

    console.log('🎤 [FFMPEG] SILENCE REMOVE + DUAL GATE FIX: THRESHOLD PROOF TEST');
    console.log('🎤 [FFMPEG] - Silence remove: Chops audio until -10dB threshold crossed (🔥 EXTREME TEST - only shouting passes)');
    console.log('🎤 [FFMPEG] - High-pass: 100Hz (removes breathing/low-end noise)');
    console.log('🎤 [FFMPEG] - Gate 1: -55dB threshold, 25:1 ratio, 250ms release (aggressive noise cutting)');
    console.log('🎤 [FFMPEG] - Gate 2: -50dB threshold, 20:1 ratio, 250ms release (secondary cleanup)');
    console.log('🎤 [FFMPEG] - Gate timing: 5ms attack, 250ms release (longer, smoother transitions)');
    console.log('🎤 [FFMPEG] - EQ: +3dB @ 1.8kHz (presence), -2dB @ 8kHz (reduce sibilance)');
    console.log('🎤 [FFMPEG] - 🧪 VOLUME TEST: Set to 0.01 to verify filter chain is active');
    console.log('🎤 [FFMPEG] - Filter order: silenceremove → aresample → highpass → gate → gate → EQ → volume');
    console.log('🧪 [DEBUG] FFmpeg command:', ffmpegCmd);
    console.log('🎬 [FFMPEG] 🔧 Optimizations: 360p (640x360), 800kbps video, fast preset');
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
        // 🛠️ FIXED: Use correct field names matching pre-Railway version
        scoreResult = {
          pitchScore: 50,
          rhythmScore: 50,
          finalScore: 50,
          verdict: "🤔 Analysis failed",
          clarity: 0,
          midiRange: 0
        };
      }

      // Generate unique video ID
      const videoUid = uuidv4();
      console.log('🆔 [RESPONSE] Generated videoUid:', videoUid);

      // 🔧 PRODUCTION FIX: Don't include full video in JSON response to avoid 4MB limit
      // Instead, return a reference that can be fetched separately
      console.log('📹 [RESPONSE] Video data size:', videoData.length, 'bytes');
      
      // Store video temporarily and return reference
      const videoTempPath = `/tmp/response-${videoUid}.mp4`;
      fs.writeFileSync(videoTempPath, videoData);
      console.log('📹 [RESPONSE] Video saved to temp path:', videoTempPath);

      // Return JSON response with video reference instead of full data
      const baseUrl = process.env.MERGE_PUBLIC_URL || 'http://localhost:3002';
      const jsonResponse = {
        success: true,
        videoUid,
        videoUrl: `${baseUrl}/video/${videoUid}`,
        scoreResult,
        tokenId: 'temp-token-id'
      };

      console.log('🎯 [SCORING] Final score before response:', scoreResult);
      console.log('✅ [RESPONSE] Setting headers and sending JSON response...');
      
      // 🔍 PRODUCTION DEBUG: Enhanced response logging
      console.log('🔍 [RESPONSE DEBUG] About to set content-type header');
      res.setHeader('Content-Type', 'application/json');
      console.log('🔍 [RESPONSE DEBUG] Content-Type header set to:', res.getHeader('Content-Type'));
      
      // 🔍 PRODUCTION DEBUG: Log the exact JSON response being sent
      console.log('🔍 [RESPONSE DEBUG] JSON response object:', {
        success: jsonResponse.success,
        videoUid: jsonResponse.videoUid,
        videoUrlLength: jsonResponse.videoUrl?.length || 0,
        scoreResult: jsonResponse.scoreResult,
        tokenId: jsonResponse.tokenId
      });
      
      // 🔍 PRODUCTION DEBUG: Log the JSON response
      const jsonString = JSON.stringify(jsonResponse);
      console.log('🔍 [RESPONSE DEBUG] JSON string length:', jsonString.length);
      console.log('🔍 [RESPONSE DEBUG] Response structure:', {
        success: jsonResponse.success,
        videoUid: jsonResponse.videoUid,
        videoUrl: jsonResponse.videoUrl,
        scoreResult: jsonResponse.scoreResult,
        tokenId: jsonResponse.tokenId
      });
      
      // 🔍 PRODUCTION DEBUG: Verify JSON is valid before sending
      try {
        JSON.parse(jsonString);
        console.log('🔍 [RESPONSE DEBUG] ✅ JSON is valid');
      } catch (parseError) {
        console.error('🔍 [RESPONSE DEBUG] ❌ JSON is INVALID:', parseError);
        return res.status(500).json({ error: 'Invalid JSON response generated', details: String(parseError) });
      }
      
      console.log('[END] Merge route completed successfully - About to send JSON response');
      
      // 🚨 CRITICAL FIX: Ensure this is the ONLY response path
      if (res.headersSent) {
        console.error('🚨 [RESPONSE] Headers already sent! Cannot send response again');
        return;
      }
      
      // 🔧 CRITICAL FIX: Ensure we're sending JSON data, not MP4 data
      // Double-check that we're not accidentally sending binary data
      if (jsonString.includes('ftyp') || jsonString.includes('mp4') || jsonString.charCodeAt(0) === 0) {
        console.error('🚨 [RESPONSE] CRITICAL ERROR: JSON response contains binary MP4 data!');
        console.error('🚨 [RESPONSE] First 100 chars:', jsonString.substring(0, 100));
        console.error('🚨 [RESPONSE] First 10 char codes:', jsonString.substring(0, 10).split('').map(c => c.charCodeAt(0)));
        return res.status(500).json({ error: 'Server error: binary data detected in JSON response' });
      }
      
      // 🔧 CRITICAL FIX: Validate JSON structure one more time
      if (!jsonString.startsWith('{') || !jsonString.endsWith('}')) {
        console.error('🚨 [RESPONSE] CRITICAL ERROR: JSON response malformed!');
        console.error('🚨 [RESPONSE] Response starts with:', jsonString.substring(0, 50));
        console.error('🚨 [RESPONSE] Response ends with:', jsonString.substring(jsonString.length - 50));
        return res.status(500).json({ error: 'Server error: malformed JSON response' });
      }
      
      // 🔍 PRODUCTION DEBUG: Use res.json() instead of res.send() for guaranteed JSON handling
      res.status(200).json(jsonResponse);
      
      console.log('✅ [RESPONSE] 🎉 JSON response sent successfully');
      console.log('🔍 [RESPONSE DEBUG] Response has been sent to client');
      
      // 🚨 CRITICAL FIX: RETURN immediately after response to prevent any further execution
      return;
      
    } catch (readError) {
      console.error('✅ [RESPONSE] ❌ Failed to read output file:', readError.message);
      console.log('[END] Merge route failed at response stage');
      return res.status(500).json({ error: 'Failed to read merged video', details: readError.message });
    }

    // 🚨 SAFETY CHECK: This should NEVER be reached after successful response
    console.error('🚨 [CONTROL FLOW] Reached cleanup section after response - this should not happen!');
    
    // Cleanup - this should only run if there was an error above
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

  } catch (error) {
    console.error('❌ [ROUTE] Merge processing failed:', error);
    console.log('[END] Merge route failed during processing:', error.message);
    
    // 🚨 SAFETY CHECK: Ensure response hasn't been sent already
    if (!res.headersSent) {
      res.status(400).json({ error: 'Error processing request', details: error.message });
    } else {
      console.error('🚨 [ERROR] Cannot send error response - headers already sent');
    }
  }
});

// Apply JSON parsing to all other routes (after /merge to avoid interference)
app.use(express.json());

// 🔧 PRODUCTION FIX: Add video serving endpoint
app.get('/video/:videoUid', (req, res) => {
  const { videoUid } = req.params;
  const filePath = `/tmp/response-${videoUid}.mp4`;
  
  console.log('📹 [VIDEO SERVE] Request for video:', videoUid);
  console.log('📹 [VIDEO SERVE] Looking for file:', filePath);
  
  // 🚨 CRITICAL FIX: Handle request abortion/cancellation
  req.on('close', () => {
    console.log('📹 [VIDEO SERVE] ⚠️  Request aborted by client for:', videoUid);
  });
  
  req.on('error', (err) => {
    console.error('📹 [VIDEO SERVE] ❌ Request error:', err);
  });
  
  if (!fs.existsSync(filePath)) {
    console.error('📹 [VIDEO SERVE] ❌ Video file not found:', filePath);
    if (!res.headersSent) {
      return res.status(404).json({ error: 'Video not found' });
    }
    return;
  }
  
  // Set headers before sending file
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  }
  
  // Serve the file with proper error handling
  res.sendFile(filePath, {}, (err) => {
    if (err) {
      console.error("❌ Error sending file:", err);
      // 🚨 CRITICAL FIX: Check if headers already sent before responding
      if (!res.headersSent) {
        res.status(500).send("Failed to serve video");
      } else {
        console.error("🚨 [VIDEO SERVE] Cannot send error response - headers already sent");
      }
    } else {
      console.log(`📹 [VIDEO SERVE] ✅ Served video file: ${filePath}`);
      
      // Delay cleanup by 10 minutes (600,000 ms)
      setTimeout(() => {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`🧹 [VIDEO SERVE] Cleaned up video file: ${filePath}`);
          }
        } catch (cleanupErr) {
          console.error(`❌ [VIDEO SERVE] Cleanup failed for ${filePath}:`, cleanupErr);
        }
      }, 10 * 60 * 1000);
    }
  });
});

// Add a simple health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`🚀 Merge service running on port ${port}`);
  console.log(`🔄 DEPLOYMENT VERSION: 2025-01-15T10:55:00Z - FORCE REDEPLOY v1.0.1-silenceremove-test`);
  console.log(`🧪 FILTER CHAIN: silenceremove(-10dB) → highpass(100Hz) → agate(-55dB,25:1) → agate(-50dB,20:1) → EQ → volume(0.01)`);
  console.log(`🚨 NEW FFmpeg COMMAND SHOULD CONTAIN: silenceremove + volume=0.01 + NO compand + NO dynaudnorm`);
}); 