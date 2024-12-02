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
    });

    // Save configuration
    document.getElementById('saveConfig').addEventListener('click', function() {
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
            storageKey: "replayUIPositionAndSize"
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
                });
            });

            // Visual feedback
            const saveButton = document.getElementById('saveConfig');
            saveButton.textContent = 'Saved!';
            setTimeout(() => {
                saveButton.textContent = 'Save Configuration';
            }, 1500);
        });
    });
});