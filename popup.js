// popup.js
document.addEventListener('DOMContentLoaded', function() {
    // Load current configuration
    chrome.storage.sync.get(['extensionConfig'], function(result) {
        const config = result.extensionConfig || {};
        
        // Populate form with current values
        document.getElementById('numberOfRecorders').value = config.numberOfRecorders || 2;
        document.getElementById('recordingDuration').value = config.recordingDuration || 30;
        document.getElementById('defaultWrapperWidth').value = config.defaultWrapperWidth || '600px';
        document.getElementById('volumeReduction').value = config.volumeReduction || 0.05;
        document.getElementById('roundedCorners').value = config.roundedCorners || 4;
        document.getElementById('useStorage').checked = config.useStorage !== false;
        document.getElementById('enableToggle').checked = config.enableToggle !== false;
        document.getElementById('autoClose').checked = config.autoClose !== false;
    });


    // Debounce function to limit how often we save configuration
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            const later = () => {
                timeout = null;
                func.apply(this, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Save configuration
    function saveConfiguration() {
        const newConfig = {
            numberOfRecorders: parseInt(document.getElementById('numberOfRecorders').value),
            recordingDuration: parseInt(document.getElementById('recordingDuration').value),
            defaultWrapperWidth: document.getElementById('defaultWrapperWidth').value,
            volumeReduction: parseFloat(document.getElementById('volumeReduction').value),
            roundedCorners: parseInt(document.getElementById('roundedCorners').value),
            useStorage: document.getElementById('useStorage').checked,
            codecPreferences: [
                "video/webm; codecs=vp9",
                "video/webm; codecs=vp8",
                "video/webm",
            ],
            storageKey: "replayUIPositionAndSize",
            enableToggle: document.getElementById('enableToggle').checked,
            autoClose: document.getElementById('autoClose').checked
        };

        // Save to chrome.storage
        chrome.storage.sync.set({
            extensionConfig: newConfig
        }, function() {
            // Notify content script of config update
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'CONFIG_UPDATE',
                    config: newConfig
                }).catch(error => {
                    // Ignore the error - we're probably not on a Twitch page
                    console.log('Not on Twitch - settings saved but not applied to current page');
                });
            });

            // Visual feedback
            const headerTitle = document.querySelector('.header h1');
            headerTitle.textContent = 'Settings Saved!';
            setTimeout(() => {
                headerTitle.textContent = 'Instant Twitch Replay';
            }, 1500);
        });
    }

    const debouncedSaveConfiguration = debounce(saveConfiguration, 500);

    document.getElementById('config-form').addEventListener('input', debouncedSaveConfiguration);
});