// Configuration options
const CONFIG = {
    numberOfRecorders: 2,
    recordingDuration: 30, // seconds per recorder
    startOffset: 15, // seconds between recorder starts
    initDelay: 2000,
    videoBitrate: 2500000,
    defaultWrapperWidth: '600px',
    volumeReduction: 0.05,
    codecPreferences: ['video/webm; codecs=vp9', 'video/webm; codecs=vp8', 'video/webm']
};

// Global flag to ensure only one instance
let systemInitialized = false;
let replaySystem = null; // Singleton instance

class ReplaySystem {
    constructor() {
        this.recorders = [];
        this.dataChunks = [];
        this.recordingStartTimes = [];
        this.listenerAdded = false;
        this.isReplaying = false;
        this.initializationInProgress = false;
    }

    async initialize() {
        if (this.initializationInProgress) {
            console.log('[ITR] Initialization already in progress');
            return false;
        }

        this.initializationInProgress = true;
        console.log('[ITR] Starting initialization with delay...');

        try {
            // Wait for the initial delay
            await new Promise(resolve => setTimeout(resolve, CONFIG.initDelay));
            
            const videoElement = document.querySelector('video');
            if (!videoElement) {
                console.warn('[ITR] No video element found.');
                return false;
            }

            // Check if video is actually playing
            if (videoElement.readyState < 3) { // HAVE_FUTURE_DATA
                console.log('[ITR] Video not ready yet, waiting for metadata...');
                await new Promise(resolve => {
                    videoElement.addEventListener('loadeddata', resolve, { once: true });
                });
            }

            const mediaStream = await this.captureVideoStream(videoElement);
            if (!mediaStream) {
                console.warn('[ITR] Failed to capture media stream');
                return false;
            }

            // Verify stream has tracks
            if (!mediaStream.getTracks().length) {
                console.warn('[ITR] Media stream has no tracks');
                return false;
            }

            const options = await this.getBestRecordingOptions();
            if (!options) return false;

            await this.initializeRecorders(mediaStream, options);
            this.setupKeyboardListener();
            return true;
        } finally {
            this.initializationInProgress = false;
        }
    }

    async captureVideoStream(videoElement) {
        try {
            let stream = null;
            
            // Try captureStream first
            if (videoElement.captureStream) {
                stream = videoElement.captureStream();
            } else if (videoElement.mozCaptureStream) {
                stream = videoElement.mozCaptureStream();
            }

            if (!stream) {
                console.error('[ITR] Video captureStream() not supported');
                return null;
            }

            // Verify stream has tracks
            if (stream.getTracks().length === 0) {
                console.error('[ITR] Captured stream has no tracks');
                return null;
            }

            console.log('[ITR] Successfully captured video stream with tracks:', 
                       stream.getTracks().map(t => t.kind).join(', '));
            
            return stream;

        } catch (error) {
            console.error('[ITR] Error capturing stream:', error);
            return null;
        }
    }

    async getBestRecordingOptions() {
        for (const mimeType of CONFIG.codecPreferences) {
            if (MediaRecorder.isTypeSupported(mimeType)) {
                console.log('[ITR] Using codec:', mimeType);
                return {
                    mimeType,
                    videoBitsPerSecond: CONFIG.videoBitrate
                };
            }
        }
        console.error('[ITR] No supported mime types found');
        return null;
    }

    async initializeRecorders(mediaStream, options) {
        // Clear any existing recorders
        this.recorders = [];
        this.dataChunks = [];
        this.recordingStartTimes = [];

        for (let i = 0; i < CONFIG.numberOfRecorders; i++) {
            try {
                const recorder = new MediaRecorder(mediaStream, options);
                this.dataChunks[i] = []; // Initialize data chunks array for each recorder
                
                recorder.ondataavailable = (event) => {
                    if (event.data && event.data.size > 0) {
                        this.dataChunks[i].push(event.data);
                        console.log(`[ITR] Data chunk received for recorder ${i}, total chunks: ${this.dataChunks[i].length}, size: ${event.data.size} bytes`);
                    }
                };

                recorder.onerror = (error) => {
                    console.error(`[ITR] MediaRecorder ${i} error:`, error);
                };

                recorder.onstart = () => {
                    this.recordingStartTimes[i] = Date.now();
                    console.log(`[ITR] Recorder ${i} started at ${new Date(this.recordingStartTimes[i]).toISOString()}`);
                };

                recorder.onstop = () => {
                    console.log(`[ITR] Recorder ${i} stopped successfully`);
                };

                this.recorders.push(recorder);
            } catch (error) {
                console.error(`[ITR] Error creating MediaRecorder ${i}:`, error);
                return false;
            }
        }

        // Start recorders with offset
        await this.startStaggeredRecording();
        return true;
    }

    async startStaggeredRecording() {
        // Start first recorder immediately
        this.startRecorder(0);

        // Start subsequent recorders after offsets
        for (let i = 1; i < CONFIG.numberOfRecorders; i++) {
            setTimeout(() => {
                this.startRecorder(i);
            }, CONFIG.startOffset * 1000 * i);
        }
    }

    startRecorder(index) {
        const recorder = this.recorders[index];
        
        try {
            if (recorder.state === 'inactive') {
                this.dataChunks[index] = []; // Reset data chunks for the recorder
                recorder.start(1000); // Start recording with timeslice of 1 second
                console.log(`[ITR] Recorder ${index} started with timeslice of 1 second`);
                
                // Schedule recorder restart after recording duration
                setTimeout(() => {
                    this.restartRecorder(index);
                }, CONFIG.recordingDuration * 1000);
            }
        } catch (error) {
            console.error(`[ITR] Error starting recorder ${index}:`, error);
        }
    }

    restartRecorder(index) {
        const recorder = this.recorders[index];
        
        try {
            if (recorder.state !== 'inactive') {
                recorder.stop();
                // Start the recorder again after a small delay
                setTimeout(() => {
                    this.startRecorder(index);
                }, 100);
            }
        } catch (error) {
            console.error(`[ITR] Error restarting recorder ${index}:`, error);
        }
    }

    getBestRecorder() {
        let bestIndex = 0;
        let maxChunks = 0;

        for (let i = 0; i < this.recorders.length; i++) {
            if (this.dataChunks[i] && this.dataChunks[i].length > maxChunks) {
                maxChunks = this.dataChunks[i].length;
                    bestIndex = i;
            }
        }

        return {
            index: bestIndex,
            recordedTime: maxChunks // Each chunk represents 1 second
        };
    }

    setupKeyboardListener() {
        if (this.listenerAdded) return;

        const focusElement = document.querySelector('div[data-a-target="player-overlay-click-handler"]');
        if (!focusElement) {
            console.warn('[ITR] Focus element not found');
            return;
        }

        focusElement.tabIndex = 0;
        focusElement.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowLeft' && document.activeElement === focusElement) {
                this.playReplay();
            }
        });

        this.listenerAdded = true;
    }

    async playReplay() {
        if (this.isReplaying) {
            console.log('[ITR] Replay already in progress');
            return;
        }

        const bestRecorder = this.getBestRecorder();
        const chunks = this.dataChunks[bestRecorder.index];

        if (!chunks || chunks.length === 0) {
            console.warn('[ITR] No replay data available yet');
            return;
        }

        console.log(`[ITR] Playing replay from recorder ${bestRecorder.index} with ${bestRecorder.recordedTime}s recorded`);

        this.isReplaying = true;
        const replayUI = new ReplayUI(this.cleanup.bind(this));
        await replayUI.show(chunks);
    }

    cleanup() {
        this.isReplaying = false;
    }
}

class ReplayUI {
    constructor(onCleanup) {
        this.onCleanup = onCleanup;
        this.elements = {};
    }

    async show(chunks) {
        const blob = new Blob(chunks, { type: chunks[0].type });
        const url = URL.createObjectURL(blob);
        
        this.createElements();
        this.setupEventListeners(url);
        document.body.appendChild(this.elements.wrapper);
        
        const originalVideo = document.querySelector('video');
        if (originalVideo) {
            this.previousVolume = originalVideo.volume;
            originalVideo.volume = CONFIG.volumeReduction;
        }
    }

    createElements() {
        // Create wrapper
        this.elements.wrapper = document.createElement('div');
        Object.assign(this.elements.wrapper.style, {
            position: 'fixed',
            bottom: '10px',
            right: '10px',
            width: CONFIG.defaultWrapperWidth,
            height: 'auto',
            resize: 'both',
            overflow: 'auto',
            zIndex: '1000',
            backgroundColor: 'black'
        });

        // Create video element
        this.elements.video = document.createElement('video');
        Object.assign(this.elements.video, {
            controls: true,
            autoplay: true,
            style: 'width: 100%; height: auto;'
        });

        // Create close button
        this.elements.closeButton = document.createElement('div');
        Object.assign(this.elements.closeButton.style, {
            position: 'absolute',
            top: '5px',
            right: '10px',
            fontSize: '24px',
            color: 'white',
            cursor: 'pointer',
            zIndex: '1001'
        });
        this.elements.closeButton.innerHTML = '&times;';

        this.elements.wrapper.appendChild(this.elements.video);
        this.elements.wrapper.appendChild(this.elements.closeButton);
    }

    setupEventListeners(url) {
        const cleanup = () => this.cleanup(url);

        this.elements.closeButton.addEventListener('click', cleanup);
        this.elements.video.addEventListener('ended', cleanup);
        this.elements.video.addEventListener('error', (e) => {
            console.error('[ITR] Replay video error:', e);
            alert('Replay failed due to encoding issues.');
            cleanup();
        });

        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);

        this.elements.video.src = url;
    }

    cleanup(url) {
        document.body.removeChild(this.elements.wrapper);
        URL.revokeObjectURL(url);

        const originalVideo = document.querySelector('video');
        if (originalVideo && this.previousVolume !== undefined) {
            originalVideo.volume = this.previousVolume;
        }

        this.onCleanup();
    }
}

// Modified initialization
const observer = new MutationObserver((mutations, obs) => {
    if (systemInitialized) {
        return;
    }

    const videoElement = document.querySelector('video');
    const focusElement = document.querySelector('div[data-a-target="player-overlay-click-handler"]');
    
    if (videoElement && focusElement) {
        console.log('[ITR] Found required elements, starting initialization...');
        
        // Wait for video to be in a good state
        const checkAndInitialize = async () => {
            if (systemInitialized) {
                return;
            }
            if (videoElement.readyState >= 3) { // HAVE_FUTURE_DATA
                console.log('[ITR] Video is ready, initializing replay system...');
                
                if (!replaySystem) {
                    replaySystem = new ReplaySystem();
                }
                const success = await replaySystem.initialize();
                if (success) {
                    console.log('[ITR] Replay system initialized successfully');
                    obs.disconnect();
                    videoElement.removeEventListener('canplay', checkAndInitialize);
                    systemInitialized = true; // Set flag after successful initialization
                } else {
                    console.error('[ITR] Failed to initialize replay system');
                }
            }
        };

        videoElement.addEventListener('canplay', checkAndInitialize);
        // Also try immediately in case video is already ready
        checkAndInitialize();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});