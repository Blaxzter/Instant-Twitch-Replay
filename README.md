# Instant Twitch Replay

A Chrome extension that enables instant replay functionality for Twitch streams. Press the left arrow key while watching a stream to see the last 30 seconds again in a floating window.

## Features

- Records the last 30 seconds of any Twitch stream continuously
- Trigger replay with left arrow key
- Picture-in-picture style replay window
- Resizable replay window
- Automatic volume reduction of main stream during replay
- Multiple buffer system for reliable capture
- Supports various video codecs (VP9, VP8)

## Installation

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory

## Usage

1. Navigate to any Twitch stream
2. Wait a few seconds for the extension to initialize
3. Press the left arrow key while focused on the video player to see the last 30 seconds
4. Close the replay window with ESC key or the X button

## Technical Details

- Uses MediaRecorder API for stream capture
- Implements a rotating buffer system with multiple recorders
- Automatic codec selection based on browser support
- Memory-efficient chunk-based recording

## License

This project is licensed under the [Creative Commons Attribution-NonCommercial 4.0 International License](https://creativecommons.org/licenses/by-nc/4.0/). You must provide attribution to the original author, and commercial use is prohibited.