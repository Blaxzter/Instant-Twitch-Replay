import {
    Output,
    WebMOutputFormat,
    BufferTarget,
    EncodedVideoPacketSource,
    EncodedAudioPacketSource,
    EncodedPacket,
} from "mediabunny";

export class WebCodecsRingBuffer {
    constructor(maxSeconds = 30, videoBitrate = 2_500_000) {
        this.maxSeconds = maxSeconds;
        this.videoBitrate = videoBitrate;

        this.videoChunks = []; // { data, timestamp, duration, isKey }
        this.audioChunks = []; // { data, timestamp, duration, isKey }

        this.videoEncoder = null;
        this.audioEncoder = null;
        this.videoReader = null;
        this.audioReader = null;

        this.videoWidth = 0;
        this.videoHeight = 0;
        this.sampleRate = 0;
        this.numberOfChannels = 0;

        // Store decoder config metadata from first encoded chunk
        this.firstVideoMeta = null;
        this.firstAudioMeta = null;

        this.running = false;
        this.paused = false;
    }

    async start(videoElement) {
        let stream = null;
        if (videoElement.captureStream) {
            stream = videoElement.captureStream();
        } else if (videoElement.mozCaptureStream) {
            stream = videoElement.mozCaptureStream();
        }

        if (!stream) {
            console.error("[ITR] captureStream() not supported");
            return false;
        }

        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];

        if (!videoTrack) {
            console.error("[ITR] No video track in captured stream");
            return false;
        }

        this.videoWidth = videoElement.videoWidth;
        this.videoHeight = videoElement.videoHeight;
        this.running = true;
        // Shared wall-clock reference so audio and video timestamps are comparable
        this.startTime = performance.now();

        // Setup video encoder
        this.videoEncoder = new VideoEncoder({
            output: (chunk, meta) => {
                const buf = new Uint8Array(chunk.byteLength);
                chunk.copyTo(buf);

                if (!this.firstVideoMeta && meta?.decoderConfig) {
                    this.firstVideoMeta = meta;
                }

                // Use wall-clock time (microseconds) as shared timeline
                const wallTimestamp =
                    (performance.now() - this.startTime) * 1000;

                this.videoChunks.push({
                    data: buf,
                    timestamp: wallTimestamp,
                    duration: chunk.duration,
                    isKey: chunk.type === "key",
                });
                this._trimVideo();
            },
            error: (e) => console.error("[ITR] VideoEncoder error:", e),
        });

        this.videoEncoder.configure({
            codec: "vp8",
            width: this.videoWidth,
            height: this.videoHeight,
            bitrate: this.videoBitrate,
            framerate: 30,
        });
        console.log(
            `[ITR] VideoEncoder configured: ${this.videoWidth}x${this.videoHeight}, vp8, ${this.videoBitrate}bps`
        );

        // Setup audio processing if audio track exists
        // Downmix to stereo via AudioContext since Opus supports max 2 channels
        if (audioTrack) {
            this.audioEncoderConfigured = false;

            this.audioEncoder = new AudioEncoder({
                output: (chunk, meta) => {
                    const buf = new Uint8Array(chunk.byteLength);
                    chunk.copyTo(buf);

                    if (!this.firstAudioMeta && meta?.decoderConfig) {
                        this.firstAudioMeta = meta;
                    }

                    // Use same wall-clock timeline as video (microseconds)
                    const wallTimestamp =
                        (performance.now() - this.startTime) * 1000;

                    this.audioChunks.push({
                        data: buf,
                        timestamp: wallTimestamp,
                        duration: chunk.duration,
                        isKey: chunk.type === "key",
                    });
                    this._trimAudio();
                },
                error: (e) => console.error("[ITR] AudioEncoder error:", e),
            });

            // Downmix multi-channel audio to stereo using AudioContext
            const audioCtx = new AudioContext({ sampleRate: 48000 });
            const source = audioCtx.createMediaStreamSource(
                new MediaStream([audioTrack])
            );
            // Force downmix to stereo
            const gainNode = audioCtx.createGain();
            gainNode.channelCount = 2;
            gainNode.channelCountMode = "explicit";
            gainNode.channelInterpretation = "speakers";
            source.connect(gainNode);
            const dest = audioCtx.createMediaStreamDestination();
            gainNode.connect(dest);
            this.audioContext = audioCtx;

            const stereoTrack = dest.stream.getAudioTracks()[0];
            console.log(
                `[ITR] Audio downmixed to stereo (original channels: ${audioTrack.getSettings().channelCount || "unknown"})`
            );

            const audioProcessor = new MediaStreamTrackProcessor({
                track: stereoTrack,
            });
            this.audioReader = audioProcessor.readable.getReader();
            this._processAudioFrames();
        }

        // Start video processing
        const videoProcessor = new MediaStreamTrackProcessor({
            track: videoTrack,
        });
        this.videoReader = videoProcessor.readable.getReader();
        this._processVideoFrames();

        return true;
    }

    async _processVideoFrames() {
        let frameCount = 0;
        console.log("[ITR] Processing video frames...");

        while (this.running) {
            try {
                const { value: frame, done } = await this.videoReader.read();
                if (done) break;

                if (this.paused) {
                    frame.close();
                    continue;
                }

                // Force keyframe every ~2 seconds (assuming ~30fps)
                const keyFrame = frameCount % 60 === 0;
                this.videoEncoder.encode(frame, { keyFrame });
                frame.close();
                frameCount++;
            } catch (e) {
                if (this.running) {
                    console.error("[ITR] Error processing video frame:", e);
                }
                break;
            }
        }
    }

    async _processAudioFrames() {
        console.log("[ITR] Processing audio frames...");

        while (this.running) {
            try {
                const { value: audioData, done } =
                    await this.audioReader.read();
                if (done) break;

                if (this.paused) {
                    audioData.close();
                    continue;
                }

                // Configure encoder from the first actual AudioData frame
                if (!this.audioEncoderConfigured) {
                    this.sampleRate = audioData.sampleRate;
                    this.numberOfChannels = audioData.numberOfChannels;

                    this.audioEncoder.configure({
                        codec: "opus",
                        sampleRate: this.sampleRate,
                        numberOfChannels: this.numberOfChannels,
                        bitrate: 128_000,
                    });
                    this.audioEncoderConfigured = true;
                    console.log(
                        `[ITR] AudioEncoder configured from frame: opus, ${this.sampleRate}Hz, ${this.numberOfChannels}ch`
                    );
                }

                this.audioEncoder.encode(audioData);
                audioData.close();
            } catch (e) {
                if (this.running) {
                    console.error("[ITR] Error processing audio frame:", e);
                }
                break;
            }
        }
    }

    _trimVideo() {
        if (this.videoChunks.length === 0) return;

        const newest = this.videoChunks[this.videoChunks.length - 1].timestamp;
        const cutoff = newest - this.maxSeconds * 1_000_000; // microseconds

        // Find the latest keyframe before/at cutoff
        let cutIndex = 0;
        for (let i = 0; i < this.videoChunks.length; i++) {
            if (
                this.videoChunks[i].timestamp < cutoff &&
                this.videoChunks[i].isKey
            ) {
                cutIndex = i;
            }
        }
        if (cutIndex > 0) {
            this.videoChunks.splice(0, cutIndex);
        }
    }

    _trimAudio() {
        if (this.audioChunks.length === 0) return;

        const newest = this.audioChunks[this.audioChunks.length - 1].timestamp;
        const cutoff = newest - this.maxSeconds * 1_000_000;

        // For audio, we can cut more aggressively (no keyframe dependency)
        let cutIndex = 0;
        for (let i = 0; i < this.audioChunks.length; i++) {
            if (this.audioChunks[i].timestamp < cutoff) {
                cutIndex = i;
            }
        }
        if (cutIndex > 0) {
            this.audioChunks.splice(0, cutIndex);
        }
    }

    hasData() {
        return this.videoChunks.length > 0;
    }

    async getReplayBlob() {
        if (this.videoChunks.length === 0) {
            console.warn("[ITR] No video data available for replay");
            return null;
        }

        // Find first keyframe
        let startIdx = -1;
        for (let i = 0; i < this.videoChunks.length; i++) {
            if (this.videoChunks[i].isKey) {
                startIdx = i;
                break;
            }
        }
        if (startIdx === -1) {
            console.warn("[ITR] No keyframe found in buffer");
            return null;
        }

        const videoSlice = this.videoChunks.slice(startIdx);
        const baseTimestamp = videoSlice[0].timestamp;
        const endTimestamp = videoSlice[videoSlice.length - 1].timestamp;

        // Filter audio chunks to match video time range
        const audioSlice = this.audioChunks.filter(
            (c) => c.timestamp >= baseTimestamp && c.timestamp <= endTimestamp
        );

        console.log(
            `[ITR] Muxing replay: ${videoSlice.length} video chunks, ${audioSlice.length} audio chunks`
        );

        try {
            const videoSource = new EncodedVideoPacketSource("vp8");
            const audioSource =
                audioSlice.length > 0
                    ? new EncodedAudioPacketSource("opus")
                    : null;

            const target = new BufferTarget();
            const output = new Output({
                format: new WebMOutputFormat(),
                target,
            });

            output.addVideoTrack(videoSource, { frameRate: 30 });
            if (audioSource) {
                output.addAudioTrack(audioSource);
            }

            await output.start();

            // Add video chunks
            for (let i = 0; i < videoSlice.length; i++) {
                const c = videoSlice[i];
                const packet = new EncodedPacket(
                    c.data,
                    c.isKey ? "key" : "delta",
                    (c.timestamp - baseTimestamp) / 1_000_000, // convert to seconds
                    c.duration / 1_000_000 // convert to seconds
                );
                const meta = i === 0 ? this.firstVideoMeta : undefined;
                await videoSource.add(packet, meta);
            }

            // Add audio chunks
            if (audioSource) {
                for (let i = 0; i < audioSlice.length; i++) {
                    const c = audioSlice[i];
                    const packet = new EncodedPacket(
                        c.data,
                        c.isKey ? "key" : "delta",
                        (c.timestamp - baseTimestamp) / 1_000_000,
                        c.duration / 1_000_000
                    );
                    const meta = i === 0 ? this.firstAudioMeta : undefined;
                    await audioSource.add(packet, meta);
                }
            }

            await output.finalize();

            const blob = new Blob([target.buffer], { type: "video/webm" });
            console.log(
                `[ITR] Replay blob created: ${(blob.size / 1024 / 1024).toFixed(2)} MB`
            );
            return blob;
        } catch (e) {
            console.error("[ITR] Error creating replay blob:", e);
            return null;
        }
    }

    pause() {
        this.paused = true;
        console.log("[ITR] Ring buffer paused");
    }

    resume() {
        this.paused = false;
        console.log("[ITR] Ring buffer resumed");
    }

    stop() {
        this.running = false;

        try {
            if (this.videoEncoder?.state !== "closed") {
                this.videoEncoder?.close();
            }
        } catch (e) {
            /* ignore */
        }

        try {
            if (this.audioEncoder?.state !== "closed") {
                this.audioEncoder?.close();
            }
        } catch (e) {
            /* ignore */
        }

        try {
            this.videoReader?.cancel();
        } catch (e) {
            /* ignore */
        }

        try {
            this.audioReader?.cancel();
        } catch (e) {
            /* ignore */
        }

        try {
            this.audioContext?.close();
        } catch (e) {
            /* ignore */
        }

        this.videoChunks = [];
        this.audioChunks = [];
        console.log("[ITR] Ring buffer stopped");
    }
}
