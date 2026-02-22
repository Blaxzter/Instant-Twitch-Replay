// Configuration options
let CONFIG = {
    enableToggle: true,
    numberOfRecorders: 2,
    recordingDuration: 30, // seconds per recorder
    initDelay: 2000,
    videoBitrate: 2500000,
    defaultWrapperWidth: "600px",
    volumeReduction: 0.05,
    codecPreferences: [
        "video/webm; codecs=vp9",
        "video/webm; codecs=vp8",
        "video/webm",
    ],
    storageKey: "replayUIPositionAndSize", // Key for localStorage
    useStorage: true, // Save position and size to localStorage
    autoClose: true, // Close replay UI on video end
    roundedCorners: 4, // px
    showBadge: true, // Show status indicator badge
};

// Load config from storage when content script initializes
chrome.storage.sync.get(["extensionConfig"], function (result) {
    if (result.extensionConfig) {
        console.log(
            "[ITR] Loaded configuration from storage:",
            result.extensionConfig
        );
        CONFIG = { ...CONFIG, ...result.extensionConfig };
    }
});

// Listen for configuration updates
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "CONFIG_UPDATE") {
        CONFIG = { ...CONFIG, ...message.config };
        // Apply badge visibility change immediately
        if (message.config.showBadge === false) {
            removeStatusIndicator();
        } else if (message.config.showBadge === true) {
            addStatusIndicator();
        }
    }
});

function injectStyles() {
    if (document.getElementById("itr-styles")) {
        // Styles already injected
        return;
    }

    const style = document.createElement("style");
    style.id = "itr-styles";
    style.innerHTML = `
        @keyframes flash {
            0% { opacity: 1; }
            50% { opacity: 0.2; }
            100% { opacity: 1; }
        }

        #itr-status {
            display: flex;
            align-items: center;
            position: absolute;
            top: 10px; /* Adjust as needed */
            left: 10px; /* Adjust as needed */
            z-index: 1000; /* Ensure it's on top */
            background-color: rgba(0, 0, 0, 0.5); /* Optional: Background for better visibility */
            padding: 5px 10px;
            border-radius: 5px;
            color: white;
            font-size: 12px;
            box-shadow: 0 0 5px rgba(0, 0, 0, 0.5);
            pointer-events: none;
        }

        #itr-red-dot {
            width: 10px;
            height: 10px;
            background-color: red;
            border-radius: 50%;
            margin-right: 8px;
            animation: flash 1s infinite;
        }
    `;
    document.head.appendChild(style);
}

function createStatusIndicator() {
    const statusContainer = document.createElement("div");
    statusContainer.id = "itr-status"; // Assign an ID for easy reference and removal

    const redDot = document.createElement("div");
    redDot.id = "itr-red-dot"; // Assign an ID for styling and cleanup

    const statusText = document.createElement("span");
    statusText.id = "itr-status-text";
    statusText.textContent = "Twitch Instant Recorder Running";

    statusContainer.appendChild(redDot);
    statusContainer.appendChild(statusText);

    return statusContainer;
}

function addStatusIndicator() {
    const topBar = document.querySelector("div.top-bar");

    if (!topBar) {
        console.warn(
            "[ITR] .click-handler element not found. Cannot add status indicator."
        );
        return;
    }

    // Inject necessary styles
    injectStyles();

    // Remove existing status indicator if present
    const existingStatus = document.getElementById("itr-status");
    if (existingStatus) {
        existingStatus.remove();
    }

    // Create and append the new status indicator
    const statusIndicator = createStatusIndicator();
    topBar.style.position = "relative"; // Ensure the parent is positioned
    topBar.appendChild(statusIndicator);

    console.log("[ITR] Status indicator added to .click-handler element.");
}

function removeStatusIndicator() {
    const statusIndicator = document.getElementById("itr-status");
    if (statusIndicator) {
        statusIndicator.remove();
        console.log("[ITR] Status indicator removed.");
    }
}

function calculateMediaDuration(media) {
    return new Promise((resolve, reject) => {
        media.onloadedmetadata = function () {
            // set the mediaElement.currentTime  to a high value beyond its real duration
            media.currentTime = Number.MAX_SAFE_INTEGER;
            // listen to time position change
            media.ontimeupdate = function () {
                media.ontimeupdate = function () {};
                // setting player currentTime back to 0 can be buggy too, set it first to .1 sec
                media.currentTime = 0.1;
                media.currentTime = 0;
                // media.duration should now have its correct value, return it...
                resolve(media.duration);
            };
        };
    });
}

function isAdPlaying() {
    return !!document.querySelector('span[data-a-target="video-ad-label"]');
}

async function waitForAdToFinish() {
    return new Promise((resolve) => {
        if (!isAdPlaying()) {
            resolve();
            return;
        }

        const observer = new MutationObserver(() => {
            if (!isAdPlaying()) {
                observer.disconnect();
                resolve();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
        });
    });
}

class ReplaySystem {
    constructor() {
        this.recorders = [];
        this.dataChunks = [];
        this.recordingStartTimes = [];
        this.listenerAdded = false;
        this.isReplaying = false;
        this.initializationInProgress = false;
        this.timeouts = [];
        this.adCheckInterval = null;
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

            // Check for and wait for any ads to finish
            console.log("[ITR] Checking for ads before initialization...");
            await waitForAdToFinish();
            console.log("[ITR] No ads playing, proceeding with initialization");

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

    setupAdCheckInterval() {
        // Clear any existing interval
        if (this.adCheckInterval) {
            clearInterval(this.adCheckInterval);
        }

        // Check for ads every second
        this.adCheckInterval = setInterval(async () => {
            if (isAdPlaying()) {
                console.log("[ITR] Ad detected, pausing recorders");
                this.pauseAllRecorders();
                
                // Wait for ad to finish
                await waitForAdToFinish();
                
                console.log("[ITR] Ad finished, resuming recorders");
                this.resumeAllRecorders();
            }
        }, 1000);
    }

    pauseAllRecorders() {
        for (let i = 0; i < this.recorders.length; i++) {
            const recorder = this.recorders[i];
            if (recorder.state === "recording") {
                recorder.pause();
            }
        }
    }

    resumeAllRecorders() {
        for (let i = 0; i < this.recorders.length; i++) {
            const recorder = this.recorders[i];
            if (recorder.state === "paused") {
                recorder.resume();
            }
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
                        this.dataChunks[i]?.push(event.data);
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
            this.timeouts.push(
                setTimeout(() => {
                    this.startRecorder(i);
                }, (CONFIG.recordingDuration / CONFIG.numberOfRecorders) * 1000 * i)
            );
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
                this.timeouts.push(
                    setTimeout(() => {
                        this.restartRecorder(index);
                    }, CONFIG.recordingDuration * 1000)
                );
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
            console.info("[ITR] Focus element not found");
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

    destroy() {
        console.log("[ITR] Destroying replay system");

        if (this.adCheckInterval) {
            clearInterval(this.adCheckInterval);
            this.adCheckInterval = null;
        }

        for (const recorder of this.recorders) {
            if (recorder.state !== "inactive") {
                recorder.stop();
            }
        }
        // Clear any pending timeouts
        for (const timeout of this.timeouts) {
            clearTimeout(timeout);
        }

        this.recorders = [];
        this.dataChunks = [];
        this.recordingStartTimes = [];
        this.listenerAdded = false;
        this.isReplaying = false;
        this.initializationInProgress = false;

        removeStatusIndicator();
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
        this.previousVolume = null;
    }

    async show(chunks) {
        const blob = new Blob(chunks, { type: chunks[0].type });
        const url = URL.createObjectURL(blob);

        this.createElements();
        // fix for the duration of the video
        const video = this.elements.video;
        calculateMediaDuration(video)
            .then((duration) => {
                console.log("[ITR] Video duration:", duration);
            })
            .catch((error) => {
                console.error("[ITR] Error calculating video duration:", error);
            });

        // Load and apply saved position and size
        this.loadPositionAndSize();

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
            boxShadow: "0 4px 8px rgba(0, 0, 0, 0.2)",
            borderRadius: `${CONFIG.roundedCorners}px`,
            overflow: "hidden",
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
            this.savePositionAndSize();
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

            this.savePositionAndSize();
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
        this.elements.video.addEventListener("ended", () => {
            if (CONFIG.autoClose) {
                cleanup();
            }
        });
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

    loadPositionAndSize() {
        const saved = localStorage.getItem(CONFIG.storageKey);
        if (saved && CONFIG.useStorage) {
            try {
                const { x, y, width } = JSON.parse(saved);
                this.currentX = x;
                this.currentY = y;
                this.xOffset = x;
                this.yOffset = y;
                this.elements.wrapper.style.transform = `translate(${x}px, ${y}px)`;
                this.elements.wrapper.style.width = width;
            } catch (e) {
                console.error(
                    "[ITR] Failed to parse saved position and size:",
                    e
                );
            }
        } else {
            // If no saved position, set default position (10px from bottom-right)
            setTimeout(() => {
                const wrapper = this.elements.wrapper;
                const rect = wrapper.getBoundingClientRect();
                const top = window.innerHeight - rect.height - 10; // 10px from bottom
                const left =
                    window.innerWidth -
                    parseInt(CONFIG.defaultWrapperWidth) -
                    10; // 10px from right
                this.currentX = left;
                this.currentY = top;
                this.xOffset = left;
                this.yOffset = top;
                this.elements.wrapper.style.transform = `translate(${left}px, ${top}px)`;
            }, 50);
        }
    }

    savePositionAndSize() {
        if (!CONFIG.useStorage) return;
        const transform = this.elements.wrapper.style.transform;
        let x = this.currentX;
        let y = this.currentY;
        // Optionally, parse the transform string if needed
        // Here, we're using currentX and currentY directly

        const width =
            this.elements.wrapper.style.width || CONFIG.defaultWrapperWidth;
        const data = { x, y, width };
        localStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
        console.log("[ITR] Saved Replay UI position and size:", data);
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

let currentStreamerName = null;
let systemInitialized = false;
let replaySystem = null;

// Observe the document for a changed tw-title element
const videoObserver = new MutationObserver(async () => {
    const newTitle = document.querySelector("h1.tw-title").textContent;
    if (newTitle && currentStreamerName && newTitle !== currentStreamerName) {
        console.log(
            "[ITR] Streamer name changed to:",
            newTitle,
            "from previous:",
            currentStreamerName
        );

        // destroy existing replay system
        if (replaySystem) {
            await replaySystem.destroy();
            replaySystem = null;
            systemInitialized = false;
        }

        currentStreamerName = newTitle;
        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
        videoObserver.disconnect();
    }
});

// Debounce utility function
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const later = () => {
            clearTimeout(timeout);
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Function to initialize or refresh your extension's logic
async function checkAndInitialize(videoElement, obs) {
    if (!CONFIG.enableToggle) {
        console.log("[ITR] Instant Replay is disabled in the configuration.");
        return;
    }
    if (systemInitialized) {
        return;
    }

    console.log("[ITR] Found required elements, preparing to initialize...");

    if (videoElement.readyState >= 3) {
        // HAVE_FUTURE_DATA
        console.log("[ITR] Video is ready, initializing replay system...");

        if (!replaySystem) {
            replaySystem = new ReplaySystem();
        }
        const success = await replaySystem.initialize();
        if (success) {
            console.log("[ITR] Replay system initialized successfully");

            if (CONFIG.showBadge) {
                addStatusIndicator();
            }
            currentStreamerName =
                document.querySelector("h1.tw-title").textContent;

            obs.disconnect();
            videoElement.removeEventListener(
                "canplay",
                debouncedCheckAndInitialize
            );
            systemInitialized = true; // Set flag after successful initialization

            videoObserver.observe(document.body, {
                childList: true,
                subtree: true,
            });
        } else {
            console.info("[ITR] Failed to initialize replay system");
        }
    }
}

const debouncedCheckAndInitialize = debounce(checkAndInitialize, 300); // 300ms debounce delay

// Function to handle initialization
function handleInitialization(obs) {
    const videoElement = document.querySelector("video");
    const focusElement = document.querySelector(
        'div[data-a-target="player-overlay-click-handler"]'
    );

    if (videoElement && focusElement) {
        // Attach debounced event listener
        videoElement.addEventListener("canplay", () =>
            debouncedCheckAndInitialize(videoElement, obs)
        );
        // Also try immediately in case video is already ready
        debouncedCheckAndInitialize(videoElement, obs);
    }
}

// Setup MutationObserver
const observer = new MutationObserver((mutations, obs) => {
    if (systemInitialized) {
        return;
    }

    handleInitialization(obs);
});

// Start observing the document body for changes
observer.observe(document.body, {
    childList: true,
    subtree: true,
});
