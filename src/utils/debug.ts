/**
 * Debug utilities for performance monitoring
 */

const DEBUG_KEYSTROKES = false; // Enable to debug keystroke timing

/**
 * Log keystroke events for debugging terminal performance
 */
export function logKeystroke(event: string, key?: string, timestamp?: number) {
  if (!DEBUG_KEYSTROKES) return;
  
  const now = performance.now();
  const message = timestamp 
    ? `[Terminal] ${event}: ${key} (latency: ${(now - timestamp).toFixed(2)}ms)`
    : `[Terminal] ${event}: ${key}`;
  
  console.log(message, { timestamp: now });
}

/**
 * Check if we're in a production build
 */
export function isProduction(): boolean {
  // Check if we're in production mode based on NODE_ENV or default to false
  return (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') || false;
}

/**
 * Get platform info for debugging
 */
export function getPlatformInfo(): string {
  const ua = navigator.userAgent;
  const platform = navigator.platform;
  return `Platform: ${platform}, UserAgent: ${ua}`;
}