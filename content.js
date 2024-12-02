// Configuration options
const CONFIG = {
    numberOfRecorders: 2,
    recordingDuration: 30, // seconds per recorder
    startOffset: 15, // seconds between recorder starts
    initDelay: 2000,
    videoBitrate: 2500000,
    defaultWrapperWidth: "600px",
    volumeReduction: 0.05,
    codecPreferences: [
        "video/webm; codecs=vp9",
        "video/webm; codecs=vp8",
        "video/webm",
    ],
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
            console.log("[ITR] Initialization already in progress");
            return false;
        }

        this.initializationInProgress = true;
        console.log("[ITR] Starting initialization with delay...");

        try {
            // Wait for the initial delay
            await new Promise((resolve) =>
                setTimeout(resolve, CONFIG.initDelay)
            );

            const videoElement = document.querySelector("video");
            if (!videoElement) {
                console.warn("[ITR] No video element found.");
                return false;
            }

            // Check if video is actually playing
            if (videoElement.readyState < 3) {
                // HAVE_FUTURE_DATA
                console.log(
                    "[ITR] Video not ready yet, waiting for metadata..."
                );
                await new Promise((resolve) => {
                    videoElement.addEventListener("loadeddata", resolve, {
                        once: true,
                    });
                });
            }

            const mediaStream = await this.captureVideoStream(videoElement);
            if (!mediaStream) {
                console.warn("[ITR] Failed to capture media stream");
                return false;
            }

            // Verify stream has tracks
            if (!mediaStream.getTracks().length) {
                console.warn("[ITR] Media stream has no tracks");
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
                console.error("[ITR] Video captureStream() not supported");
                return null;
            }

            // Verify stream has tracks
            if (stream.getTracks().length === 0) {
                console.error("[ITR] Captured stream has no tracks");
                return null;
            }

            console.log(
                "[ITR] Successfully captured video stream with tracks:",
                stream
                    .getTracks()
                    .map((t) => t.kind)
                    .join(", ")
            );

            return stream;
        } catch (error) {
            console.error("[ITR] Error capturing stream:", error);
            return null;
        }
    }

    async getBestRecordingOptions() {
        for (const mimeType of CONFIG.codecPreferences) {
            if (MediaRecorder.isTypeSupported(mimeType)) {
                console.log("[ITR] Using codec:", mimeType);
                return {
                    mimeType,
                    videoBitsPerSecond: CONFIG.videoBitrate,
                };
            }
        }
        console.error("[ITR] No supported mime types found");
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
                        console.log(
                            `[ITR] Data chunk received for recorder ${i}, total chunks: ${this.dataChunks[i].length}, size: ${event.data.size} bytes`
                        );
                    }
                };

                recorder.onerror = (error) => {
                    console.error(`[ITR] MediaRecorder ${i} error:`, error);
                };

                recorder.onstart = () => {
                    this.recordingStartTimes[i] = Date.now();
                    console.log(
                        `[ITR] Recorder ${i} started at ${new Date(
                            this.recordingStartTimes[i]
                        ).toISOString()}`
                    );
                };

                recorder.onstop = () => {
                    console.log(`[ITR] Recorder ${i} stopped successfully`);
                };

                this.recorders.push(recorder);
            } catch (error) {
                console.error(
                    `[ITR] Error creating MediaRecorder ${i}:`,
                    error
                );
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
            if (recorder.state === "inactive") {
                this.dataChunks[index] = []; // Reset data chunks for the recorder
                recorder.start(1000); // Start recording with timeslice of 1 second
                console.log(
                    `[ITR] Recorder ${index} started with timeslice of 1 second`
                );

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
            if (recorder.state !== "inactive") {
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
            recordedTime: maxChunks, // Each chunk represents 1 second
        };
    }

    setupKeyboardListener() {
        if (this.listenerAdded) return;

        const focusElement = document.querySelector(
            'div[data-a-target="player-overlay-click-handler"]'
        );
        if (!focusElement) {
            console.warn("[ITR] Focus element not found");
            return;
        }

        focusElement.tabIndex = 0;
        focusElement.addEventListener("keydown", (event) => {
            if (
                event.key === "ArrowLeft" &&
                document.activeElement === focusElement
            ) {
                this.playReplay();
            }
        });

        this.listenerAdded = true;
    }

    async playReplay() {
        if (this.isReplaying) {
            console.log("[ITR] Replay already in progress");
            return;
        }

        const bestRecorder = this.getBestRecorder();
        const chunks = this.dataChunks[bestRecorder.index];

        if (!chunks || chunks.length === 0) {
            console.warn("[ITR] No replay data available yet");
            return;
        }

        console.log(
            `[ITR] Playing replay from recorder ${bestRecorder.index} with ${bestRecorder.recordedTime}s recorded`
        );

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
        this.isDragging = false;
        this.isResizing = false;
        this.currentX = 0;
        this.currentY = 0;
        this.initialX = 0;
        this.initialY = 0;
        this.xOffset = 0;
        this.yOffset = 0;
        this.initialWidth = 0;
        this.initialHeight = 0;
    }

    async show(chunks) {
        const blob = new Blob(chunks, { type: chunks[0].type });
        const url = URL.createObjectURL(blob);

        this.createElements();

        setTimeout(() => {
            // Calculate initial position from bottom-right
            const wrapper = this.elements.wrapper;
            const rect = wrapper.getBoundingClientRect();
            const top = window.innerHeight - rect.height - 10; // 10px from bottom

            console.log(rect);

            // Set initial position
            wrapper.style.top = `${top}px`;
            wrapper.style.left = `${window.innerWidth - rect.width - 10}px`; // 10px from right
        }, 10);

        this.setupEventListeners(url);
        this.setupDragListeners();
        document.body.appendChild(this.elements.wrapper);

        const originalVideo = document.querySelector("video");
        if (originalVideo) {
            this.previousVolume = originalVideo.volume;
            originalVideo.volume = CONFIG.volumeReduction;
        }
    }

    createElements() {
        // Create wrapper
        this.elements.wrapper = document.createElement("div");
        Object.assign(this.elements.wrapper.style, {
            position: "fixed",
            width: CONFIG.defaultWrapperWidth,
            height: "auto",
            zIndex: "1000",
            backgroundColor: "black",
            cursor: "default",
            transform: "translate(0px, 0px)",
        });

        // Create drag handle
        this.elements.dragHandle = document.createElement("div");
        Object.assign(this.elements.dragHandle.style, {
            position: "absolute",
            top: "0",
            left: "0",
            right: "0",
            height: "30px",
            backgroundColor: "rgba(0, 0, 0, 0)",
            cursor: "default",
            zIndex: "1002",
            transition: "background-color 0.2s ease",
        });

        // Create resize handle
        this.elements.resizeHandle = document.createElement("div");
        Object.assign(this.elements.resizeHandle.style, {
            position: "absolute",
            bottom: "0",
            right: "0",
            width: "20px",
            height: "20px",
            cursor: "nw-resize",
            zIndex: "1001",
            opacity: "0",
            transition: "opacity 0.2s ease",
            pointerEvents: "auto", // Ensure the div can receive mouse events
        });

        // Create resize icon
        const resizeIcon = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg"
        );
        Object.assign(resizeIcon.style, {
            width: "100%",
            height: "100%",
            fill: "white",
            pointerEvents: "none", // Make the SVG transparent to mouse events
        });
        resizeIcon.setAttribute("viewBox", "0 0 10 10");
        resizeIcon.innerHTML = `
            <polygon points="9,1 9,9 1,9" fill="rgba(255,255,255,0.5)" pointer-events="none"/>
        `;
        this.elements.resizeHandle.appendChild(resizeIcon);

        // Add a class name for easier selection
        this.elements.resizeHandle.className = "resize-handle";

        // Create video element
        this.elements.video = document.createElement("video");
        Object.assign(this.elements.video, {
            controls: true,
            autoplay: true,
            style: "width: 100%; height: auto;",
        });

        // Create close button
        this.elements.closeButton = document.createElement("div");
        Object.assign(this.elements.closeButton.style, {
            position: "absolute",
            top: "5px",
            right: "10px",
            fontSize: "24px",
            color: "white",
            cursor: "pointer",
            zIndex: "1002",
            opacity: "0",
            transition: "opacity 0.2s ease",
        });
        this.elements.closeButton.innerHTML = "&times;";

        // Add hover effects
        this.elements.wrapper.addEventListener("mouseenter", () => {
            this.elements.dragHandle.style.backgroundColor =
                "rgba(0, 0, 0, 0.5)";
            this.elements.dragHandle.style.cursor = "move";
            this.elements.closeButton.style.opacity = "1";
            this.elements.resizeHandle.style.opacity = "1";
        });

        this.elements.wrapper.addEventListener("mouseleave", () => {
            if (!this.isDragging && !this.isResizing) {
                this.elements.dragHandle.style.backgroundColor =
                    "rgba(0, 0, 0, 0)";
                this.elements.dragHandle.style.cursor = "default";
                this.elements.closeButton.style.opacity = "0";
                this.elements.resizeHandle.style.opacity = "0";
            }
        });

        this.elements.wrapper.appendChild(this.elements.dragHandle);
        this.elements.wrapper.appendChild(this.elements.video);
        this.elements.wrapper.appendChild(this.elements.closeButton);
        this.elements.wrapper.appendChild(this.elements.resizeHandle);

        this.setupResizeListeners();
    }

    setupResizeListeners() {
        const startResize = (e) => {
            console.log(e);
            this.isResizing = true;
            this.initialWidth = this.elements.wrapper.offsetWidth;
            this.initialHeight = this.elements.wrapper.offsetHeight;
            this.initialX = e.clientX;
            this.initialY = e.clientY;
            // Store the initial position
            const rect = this.elements.wrapper.getBoundingClientRect();
            this.initialTop = rect.top;
            this.initialLeft = rect.left;
        };

        const stopResize = () => {
            this.isResizing = false;
            if (!this.elements.wrapper.matches(":hover")) {
                this.elements.resizeHandle.style.opacity = "0";
            }
        };

        const resize = (e) => {
            if (!this.isResizing) return;

            e.preventDefault();

            const deltaX = e.clientX - this.initialX;
            const deltaY = e.clientY - this.initialY;

            // Calculate new width while maintaining minimum size
            const newWidth = Math.max(300, this.initialWidth + deltaX);

            // Set the new width and let height adjust automatically
            // since we're using 'height: auto' in the wrapper style
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // Check if new size would exceed viewport bounds
            if (this.initialLeft + newWidth <= viewportWidth) {
                this.elements.wrapper.style.width = `${newWidth}px`;
            }
        };

        this.elements.resizeHandle.addEventListener("mousedown", startResize);
        document.addEventListener("mousemove", resize);
        document.addEventListener("mouseup", stopResize);
    }

    setupDragListeners() {
        const dragStart = (e) => {
            if (e.type === "touchstart") {
                this.initialX = e.touches[0].clientX - this.xOffset;
                this.initialY = e.touches[0].clientY - this.yOffset;
            } else {
                this.initialX = e.clientX - this.xOffset;
                this.initialY = e.clientY - this.yOffset;
            }
            if (e.target === this.elements.dragHandle) {
                this.isDragging = true;
                this.elements.dragHandle.style.backgroundColor =
                    "rgba(0, 0, 0, 0.7)";
                // Remove transition during drag
                this.elements.wrapper.style.transition = "none";
            }
        };

        const dragEnd = () => {
            this.isDragging = false;
            if (!this.elements.wrapper.matches(":hover")) {
                this.elements.dragHandle.style.backgroundColor =
                    "rgba(0, 0, 0, 0)";
                this.elements.dragHandle.style.cursor = "default";
            }

            // Add smooth transition for bounce back
            this.elements.wrapper.style.transition = "transform 0.3s ease-out";

            // Get viewport and element dimensions
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const rect = this.elements.wrapper.getBoundingClientRect();

            // Calculate constrained position
            let newX = this.currentX;
            let newY = this.currentY;

            // Constrain to viewport bounds
            if (rect.left < 0) newX -= rect.left;
            if (rect.right > viewportWidth) newX -= rect.right - viewportWidth;
            if (rect.top < 0) newY -= rect.top;
            if (rect.bottom > viewportHeight)
                newY -= rect.bottom - viewportHeight;

            // Apply bounce back if needed
            if (newX !== this.currentX || newY !== this.currentY) {
                this.currentX = newX;
                this.currentY = newY;
                this.xOffset = newX;
                this.yOffset = newY;

                this.elements.wrapper.style.transform = `translate(${this.currentX}px, ${this.currentY}px)`;
            }
        };

        const drag = (e) => {
            if (!this.isDragging) return;
            e.preventDefault();

            if (e.type === "touchmove") {
                this.currentX = e.touches[0].clientX - this.initialX;
                this.currentY = e.touches[0].clientY - this.initialY;
            } else {
                this.currentX = e.clientX - this.initialX;
                this.currentY = e.clientY - this.initialY;
            }

            this.xOffset = this.currentX;
            this.yOffset = this.currentY;

            this.elements.wrapper.style.transform = `translate(${this.currentX}px, ${this.currentY}px)`;
        };

        // Mouse events
        this.elements.dragHandle.addEventListener("mousedown", dragStart);
        document.addEventListener("mousemove", drag);
        document.addEventListener("mouseup", dragEnd);

        // Touch events
        this.elements.dragHandle.addEventListener("touchstart", dragStart);
        document.addEventListener("touchmove", drag);
        document.addEventListener("touchend", dragEnd);
    }

    setupEventListeners(url) {
        const cleanup = () => this.cleanup(url);

        this.elements.closeButton.addEventListener("click", cleanup);
        // this.elements.video.addEventListener('ended', cleanup);
        this.elements.video.addEventListener("error", (e) => {
            console.error("[ITR] Replay video error:", e);
            alert("Replay failed due to encoding issues.");
            cleanup();
        });

        const escapeHandler = (e) => {
            if (e.key === "Escape") {
                cleanup();
                document.removeEventListener("keydown", escapeHandler);
            }
        };
        document.addEventListener("keydown", escapeHandler);

        this.elements.video.src = url;
    }

    cleanup(url) {
        // Remove event listeners
        document.removeEventListener("mousemove", this.drag);
        document.removeEventListener("mouseup", this.dragEnd);
        document.removeEventListener("touchmove", this.drag);
        document.removeEventListener("touchend", this.dragEnd);

        document.body.removeChild(this.elements.wrapper);
        URL.revokeObjectURL(url);

        const originalVideo = document.querySelector("video");
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

    const videoElement = document.querySelector("video");
    const focusElement = document.querySelector(
        'div[data-a-target="player-overlay-click-handler"]'
    );

    if (videoElement && focusElement) {
        console.log(
            "[ITR] Found required elements, starting initialization..."
        );

        // Wait for video to be in a good state
        const checkAndInitialize = async () => {
            if (systemInitialized) {
                return;
            }
            if (videoElement.readyState >= 3) {
                // HAVE_FUTURE_DATA
                console.log(
                    "[ITR] Video is ready, initializing replay system..."
                );

                if (!replaySystem) {
                    replaySystem = new ReplaySystem();
                }
                const success = await replaySystem.initialize();
                if (success) {
                    console.log("[ITR] Replay system initialized successfully");
                    obs.disconnect();
                    videoElement.removeEventListener(
                        "canplay",
                        checkAndInitialize
                    );
                    systemInitialized = true; // Set flag after successful initialization
                } else {
                    console.error("[ITR] Failed to initialize replay system");
                }
            }
        };

        videoElement.addEventListener("canplay", checkAndInitialize);
        // Also try immediately in case video is already ready
        checkAndInitialize();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true,
});
