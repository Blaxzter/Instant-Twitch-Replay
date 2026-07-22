// popup.js
document.addEventListener('DOMContentLoaded', function() {
    // Fall back to the default only when the value was never stored, so that
    // legitimate zero values survive a reload
    function withDefault(value, fallback) {
        return value !== undefined && value !== null ? value : fallback;
    }

    // Load current configuration
    chrome.storage.sync.get(['extensionConfig'], function(result) {
        const config = result.extensionConfig || {};

        // Populate form with current values
        document.getElementById('recordingDuration').value = withDefault(config.recordingDuration, 30);
        document.getElementById('defaultWrapperWidth').value = withDefault(config.defaultWrapperWidth, '600px');
        document.getElementById('volumeReduction').value = Math.round(withDefault(config.volumeReduction, 0.05) * 100);
        document.getElementById('replayVolumeMode').value = withDefault(config.replayVolumeMode, 'fixed');
        document.getElementById('replayVolume').value = Math.round(withDefault(config.replayVolume, 1) * 100);
        document.getElementById('roundedCorners').value = withDefault(config.roundedCorners, 4);
        document.getElementById('useStorage').checked = config.useStorage !== false;
        document.getElementById('enableToggle').checked = config.enableToggle !== false;
        document.getElementById('autoClose').checked = config.autoClose !== false;
        document.getElementById('showBadge').checked = config.showBadge !== false;

        updateLabels();
    });

    // Keep the live value labels in sync and show the replay level slider only
    // when a fixed volume is used
    function updateLabels() {
        const mode = document.getElementById('replayVolumeMode').value;
        document.getElementById('replayVolumeItem').style.display =
            mode === 'fixed' ? '' : 'none';

        document.getElementById('recordingDurationValue').textContent =
            `${document.getElementById('recordingDuration').value}s`;
        document.getElementById('volumeReductionValue').textContent =
            `${document.getElementById('volumeReduction').value}%`;
        document.getElementById('replayVolumeValue').textContent =
            `${document.getElementById('replayVolume').value}%`;
    }

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

    let statusTimeout;
    function showSaved() {
        const status = document.getElementById('saveStatus');
        status.classList.add('visible');
        clearTimeout(statusTimeout);
        statusTimeout = setTimeout(() => status.classList.remove('visible'), 1500);
    }

    // Save configuration
    function saveConfiguration() {
        const newConfig = {
            recordingDuration: parseInt(document.getElementById('recordingDuration').value),
            defaultWrapperWidth: document.getElementById('defaultWrapperWidth').value,
            volumeReduction: parseInt(document.getElementById('volumeReduction').value) / 100,
            replayVolumeMode: document.getElementById('replayVolumeMode').value,
            replayVolume: parseInt(document.getElementById('replayVolume').value) / 100,
            roundedCorners: parseInt(document.getElementById('roundedCorners').value),
            useStorage: document.getElementById('useStorage').checked,
            storageKey: "replayUIPositionAndSize",
            enableToggle: document.getElementById('enableToggle').checked,
            autoClose: document.getElementById('autoClose').checked,
            showBadge: document.getElementById('showBadge').checked
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

            showSaved();
        });
    }

    const debouncedSaveConfiguration = debounce(saveConfiguration, 500);

    const form = document.getElementById('config-form');
    form.addEventListener('input', debouncedSaveConfiguration);
    // Immediate (non debounced) feedback while dragging sliders
    form.addEventListener('input', updateLabels);
    document.getElementById('replayVolumeMode').addEventListener('change', updateLabels);
});
