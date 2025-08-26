/**
 * Platform detection utilities
 */

/**
 * Detects if the app is running on macOS
 */
export function isMacOS(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('mac') || ua.includes('darwin');
}

/**
 * Detects if running in a WebKit-based WebView (Safari/WKWebView)
 */
export function isWebKit(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  // Check for Safari or WebKit, but not Chrome (which also includes Safari in UA)
  return (ua.includes('safari') || ua.includes('webkit')) && !ua.includes('chrome');
}

/**
 * Detects if we should use the DOM renderer for xterm.js
 * This is needed on macOS/WebKit to avoid rendering issues
 */
export function shouldUseDOMRenderer(): boolean {
  // Use DOM renderer on macOS to avoid WKWebView canvas rendering bugs
  // This fixes issues with missing/slow keystrokes in release builds
  return isMacOS() || isWebKit();
}