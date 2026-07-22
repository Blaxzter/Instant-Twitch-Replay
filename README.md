# Instant Twitch Replay

A Chrome extension that enables instant replay functionality for Twitch streams. Press the left arrow key while watching a stream to see the last 30 seconds again in a floating window.
Link to the Chrome Web Store: https://chromewebstore.google.com/detail/instant-twitch-replay/nhgnfjoaphcklboffbgbmnchjggkalin

## Features

- Continuously buffers the last 30 seconds of any Twitch stream (configurable up to 60)
- Trigger replay with the left arrow key — no seeking, no reloading
- Picture-in-picture style replay window you can drag and resize
- Replays with sound, and ducks the live stream while the replay plays
- Configurable replay volume: a fixed level or matching the stream's volume
- Skips ads: the buffer pauses while an ad is playing so replays stay ad-free
- Remembers the replay window's position and size between replays
- Settings popup for buffer length, volumes, window size and more

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
5. Click the extension icon to change the buffer length, volumes and window behaviour

## Technical Details

- Captures the player with `captureStream()` and encodes via the WebCodecs API
- Keeps encoded VP8 video and Opus audio chunks in a ring buffer, trimmed to the
  configured duration on a shared wall-clock timeline
- Muxes the buffered chunks into a WebM blob on demand using
  [mediabunny](https://github.com/Vanilagy/mediabunny) — nothing is re-encoded at replay time
- Multi-channel audio is downmixed to stereo before encoding

## License

This project is licensed under the [Creative Commons Attribution-NonCommercial 4.0 International License](https://creativecommons.org/licenses/by-nc/4.0/). You must provide attribution to the original author, and commercial use is prohibited.
