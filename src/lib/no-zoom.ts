/**
 * Phones: keep the screen at its normal size.
 *
 * The viewport (layout.tsx: maximumScale 1, userScalable false) stops zoom on Android and stops iPhone zooming
 * in when a field is tapped. iPhone Safari ignores it for pinch, so this script stops pinch there; one finger
 * still scrolls. Double-tap zoom is stopped in globals.css (`touch-action: manipulation`), and fields use 16px
 * text on phones so Safari has no reason to zoom when one is focused.
 */
export const NO_ZOOM_SCRIPT =
  `(function(){var d=document,s=function(e){e.preventDefault()};` +
  `["gesturestart","gesturechange","gestureend"].forEach(function(t){d.addEventListener(t,s,{passive:false})});` +
  `d.addEventListener("touchmove",function(e){if(e.touches.length>1&&e.cancelable)e.preventDefault()},{passive:false})})();`;
