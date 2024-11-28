let videoBuffer = [];
const BUFFER_DURATION = 10; // seconds
let lowerOriginalVolume = true; // New setting to control volume adjustment

function initializeReplaySystem() {
    const videoElement = document.querySelector('video');
    if (!videoElement) {
        console.log('[ITR] No video element found.');
        return;
    }

    console.log('[ITR] Initializing media recorder...');
    let mediaStream;
    try {
        if (videoElement.captureStream) {
            mediaStream = videoElement.captureStream();
        } else if (videoElement.mozCaptureStream) {
            mediaStream = videoElement.mozCaptureStream();
        } else {
            console.log('[ITR] Video captureStream() not supported in this browser.');
            return;
        }
    } catch (e) {
        console.error('[ITR] Error capturing stream:', e);
        return;
    }

    const options = {
        mimeType: 'video/webm; codecs=vp9', // Adjust based on browser support
        videoBitsPerSecond: 2500000, // Adjust as needed
    };

    let mediaRecorder;
    try {
        mediaRecorder = new MediaRecorder(mediaStream, options);
    } catch (e) {
        console.error('[ITR] Error creating MediaRecorder:', e);
        return;
    }

    mediaRecorder.ondataavailable = (event) => {
        console.log('[ITR] Data chunk received.');
        if (event.data && event.data.size > 0) {
            videoBuffer.push({
                data: event.data,
                timestamp: Date.now()
            });
        } else {
            console.log('[ITR] Received empty data chunk.');
        }

        // Remove old chunks to maintain BUFFER_DURATION buffer
        const currentTime = Date.now();
        const cutoffTime = currentTime - (BUFFER_DURATION * 1000);
        videoBuffer = videoBuffer.filter(chunk => chunk.timestamp > cutoffTime);
        console.log('[ITR] Video buffer updated. Current buffer length:', videoBuffer.length);
    };

    mediaRecorder.onerror = (event) => {
        console.error('[ITR] MediaRecorder error:', event.error);
    };

    function startMediaRecorderWithRetry(retryCount = 0) {
        try {
            mediaRecorder.start(1000); // Capture in 1-second chunks
            console.log('[ITR] Media recorder started.');
        } catch (e) {
            if (e.name === 'NotSupportedError' && e.message.includes('no audio or video tracks available')) {
                console.warn('[ITR] MediaRecorder cannot start yet. Stream not ready. Retrying...');
                if (retryCount < 5) { // Set a maximum number of retries to prevent infinite loops
                    setTimeout(() => {
                        startMediaRecorderWithRetry(retryCount + 1);
                    }, 500); // Retry after 500 milliseconds
                } else {
                    console.error('[ITR] MediaRecorder failed to start after multiple retries.');
                }
            } else {
                console.error('[ITR] Error starting MediaRecorder:', e);
            }
        }
    }

    startMediaRecorderWithRetry();

    // Avoid adding multiple event listeners
    if (!initializeReplaySystem.listenerAdded) {
        console.log('[ITR] Adding keydown listener to focus element.');

        // Find the specific element that needs to be in focus
        const focusElement = document.querySelector('div[data-a-target="player-overlay-click-handler"]');
        if (focusElement) {
            console.log('[ITR] Focus element found:', focusElement);

            // Make sure the element is focusable
            focusElement.tabIndex = 0;

            // Add keydown listener to the focusElement to ensure it must be in focus
            focusElement.addEventListener('keydown', handleKeyDown);
        initializeReplaySystem.listenerAdded = true;
        } else {
            console.log('[ITR] Focus element not found.');
        }
    }
}

function handleKeyDown(event) {
    console.log('[ITR] Key pressed:', event.key);

    // Check if the specific element is in focus
    const focusElement = document.querySelector('div[data-a-target="player-overlay-click-handler"]');
    if (document.activeElement !== focusElement) {
        console.log('[ITR] Specified element is not in focus.');
        return;
    }

    if (event.key === 'ArrowLeft') {
        console.log('[ITR] Left arrow key detected. Initiating replay...');
        playReplay();
    }
}

function playReplay() {
    // Copy the current buffer into a new playback buffer
    const playbackBuffer = videoBuffer.slice(); // Create a shallow copy
    if (playbackBuffer.length === 0) {
        console.log('[ITR] Playback buffer is empty. Cannot play replay.');
        return;
    }

    if (document.getElementById('replayWrapper')) {
        console.log('[ITR] Replay is already playing.');
        return;
    }

    console.log('[ITR] Creating replay video...');
    let blob;
    try {
        const chunks = playbackBuffer.map(chunk => chunk.data);
        blob = new Blob(chunks, { type: 'video/webm' });
    } catch (e) {
        console.error('[ITR] Error creating Blob:', e);
        return;
    }

    let url;
    try {
        url = URL.createObjectURL(blob);
    } catch (e) {
        console.error('[ITR] Error creating object URL:', e);
        return;
    }

    // Before starting replay, lower the original video's volume if the setting is enabled
    const originalVideo = document.querySelector('video');
    let previousVolume;
    if (lowerOriginalVolume && originalVideo) {
        previousVolume = originalVideo.volume;
        originalVideo.volume = 0.05;
    }

    // Create a new video element for the replay
    const replayVideo = document.createElement('video');
    replayVideo.id = 'replayVideo';
    replayVideo.controls = true;
    replayVideo.autoplay = true;
    replayVideo.src = url;
    replayVideo.style.width = '100%'; // Adjusted to fit the wrapper
    replayVideo.style.height = 'auto';

    // Create a wrapper div to make the replay video resizable
    const wrapperDiv = document.createElement('div');
    wrapperDiv.id = 'replayWrapper';
    wrapperDiv.style.position = 'fixed';
    wrapperDiv.style.bottom = '10px';
    wrapperDiv.style.right = '10px';
    wrapperDiv.style.width = '600px';
    wrapperDiv.style.height = 'auto';
    wrapperDiv.style.resize = 'both';
    wrapperDiv.style.overflow = 'auto';
    wrapperDiv.style.zIndex = '1000';
    wrapperDiv.style.backgroundColor = 'black'; // Optional styling

    // Add a closing cross (X) in the top right corner
    const closeButton = document.createElement('div');
    closeButton.innerHTML = '&times;';
    closeButton.style.position = 'absolute';
    closeButton.style.top = '5px';
    closeButton.style.right = '10px';
    closeButton.style.fontSize = '24px';
    closeButton.style.color = 'white';
    closeButton.style.cursor = 'pointer';
    closeButton.style.zIndex = '1001';
    wrapperDiv.appendChild(closeButton);

    // Function to close the replay and clean up
    function closeReplay() {
        console.log('[ITR] Closing replay.');
        document.body.removeChild(wrapperDiv);
        URL.revokeObjectURL(url);
        // Restore the original video's volume when the replay ends
        if (lowerOriginalVolume && originalVideo) {
            originalVideo.volume = previousVolume;
        }
        // Remove the keydown event listener
        document.removeEventListener('keydown', onDocumentKeyDown);
    }

    // Add event listener to close button
    closeButton.addEventListener('click', closeReplay);

    // Event handler for keydown event to close on Escape key
    function onDocumentKeyDown(e) {
        if (e.key === 'Escape') {
            closeReplay();
        }
    }

    // Add keydown event listener to document
    document.addEventListener('keydown', onDocumentKeyDown);

    wrapperDiv.appendChild(replayVideo);
    document.body.appendChild(wrapperDiv);

    console.log('[ITR] Replay video added to the DOM.');

    // Clean up after the replay finishes
    replayVideo.onended = () => {
        console.log('[ITR] Replay ended. Cleaning up...');
        closeReplay();
    };

    replayVideo.onerror = (e) => {
        console.error('[ITR] Replay video error:', e);
        alert('Replay failed due to encoding issues.');
        closeReplay();
    };
}

// Wait for the video element and the focus element to be ready
const observer = new MutationObserver((mutations, obs) => {
    const videoElement = document.querySelector('video');
    const focusElement = document.querySelector('div[data-a-target="player-overlay-click-handler"]');
    if (videoElement && focusElement) {
        console.log('[ITR] Video and focus elements found. Initializing replay system.');
        initializeReplaySystem();
        obs.disconnect();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});
