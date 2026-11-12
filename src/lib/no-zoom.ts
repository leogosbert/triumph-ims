/**
 * Phones: keep the screen at its normal size.
 *
 * The viewport (layout.tsx: maximumScale 1, userScalable false) stops pinch zoom on Android and stops iPhone
 * zooming in when a field is tapped. iPhone Safari ignores it for pinch, so this script stops Safari's own pinch
 * events. Double-tap zoom is stopped in globals.css (`touch-action: manipulation`), and fields use 16px text on
 * phones so Safari has no reason to zoom when one is focused. No touchmove listener: scrolling stays as it was.
 */
export const NO_ZOOM_SCRIPT =
  `(function(){var s=function(e){e.preventDefault()};` +
  `["gesturestart","gesturechange","gestureend"].forEach(function(t){document.addEventListener(t,s,{passive:false})})})();`;
