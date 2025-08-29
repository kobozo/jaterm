import { loadGlobalConfig, getCachedConfig } from './settings';
import { logger } from './logger';
import { getVersion } from '@tauri-apps/api/app';

/**
 * Telemetry event types
 */
export enum TelemetryEvent {
  // Application lifecycle
  APP_STARTED = 'app_started',
  APP_CLOSED = 'app_closed',
  APP_CRASHED = 'app_crashed',
  APP_UPDATED = 'app_updated',
  
  // Feature usage
  TERMINAL_OPENED = 'terminal_opened',
  SSH_CONNECTED = 'ssh_connected',
  EDITOR_OPENED = 'editor_opened',
  SETTINGS_CHANGED = 'settings_changed',
  
  // Errors
  ERROR_OCCURRED = 'error_occurred',
  SSH_CONNECTION_FAILED = 'ssh_connection_failed',
  
  // Performance
  STARTUP_TIME = 'startup_time',
  MEMORY_USAGE = 'memory_usage',
}

interface TelemetryData {
  event: TelemetryEvent;
  timestamp: number;
  sessionId: string;
  properties?: Record<string, any>;
  measurements?: Record<string, number>;
  context?: {
    appVersion?: string;
    platform?: string;
    arch?: string;
    osVersion?: string;
  };
}

class TelemetryService {
  private static instance: TelemetryService;
  private enabled = false;
  private sessionId: string;
  private eventQueue: TelemetryData[] = [];
  private maxQueueSize = 100;
  private initialized = false;
  private appContext: TelemetryData['context'] = {};

  private constructor() {
    this.sessionId = this.generateSessionId();
    this.initialize();
  }

  static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService();
    }
    return TelemetryService.instance;
  }

  private async initialize() {
    try {
      // Load settings
      const config = await loadGlobalConfig();
      this.enabled = config.advanced.enableTelemetry;
      
      // Get app context
      try {
        this.appContext = {
          appVersion: await getVersion(),
          // Platform info can be added later when plugin-os is available
          // For now, use navigator info
          platform: navigator.platform,
          arch: 'unknown',
          osVersion: navigator.userAgent,
        };
      } catch (error) {
        logger.warn('Failed to get app context for telemetry', error);
      }
      
      this.initialized = true;
      
      if (this.enabled) {
        logger.info('Telemetry initialized', { sessionId: this.sessionId });
        this.track(TelemetryEvent.APP_STARTED);
      }
    } catch (error) {
      logger.error('Failed to initialize telemetry', error);
      this.enabled = false;
      this.initialized = true;
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if telemetry is enabled
   */
  isEnabled(): boolean {
    const cached = getCachedConfig();
    if (cached) {
      return cached.advanced.enableTelemetry;
    }
    return this.enabled;
  }

  /**
   * Update telemetry enabled state
   */
  setEnabled(enabled: boolean) {
    const wasEnabled = this.enabled;
    this.enabled = enabled;
    
    if (enabled && !wasEnabled) {
      logger.info('Telemetry enabled');
      this.track(TelemetryEvent.SETTINGS_CHANGED, { setting: 'telemetry', value: true });
    } else if (!enabled && wasEnabled) {
      logger.info('Telemetry disabled');
      // Send one last event before disabling
      this.track(TelemetryEvent.SETTINGS_CHANGED, { setting: 'telemetry', value: false });
      this.flush();
      this.eventQueue = [];
    }
  }

  /**
   * Track an event
   */
  track(
    event: TelemetryEvent,
    properties?: Record<string, any>,
    measurements?: Record<string, number>
  ) {
    if (!this.isEnabled()) {
      return;
    }

    const data: TelemetryData = {
      event,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      properties,
      measurements,
      context: this.appContext,
    };

    this.eventQueue.push(data);
    
    // Keep queue size limited
    if (this.eventQueue.length > this.maxQueueSize) {
      this.eventQueue.shift();
    }

    logger.debug('Telemetry event tracked', { event, properties, measurements });

    // In a real implementation, you might batch and send events periodically
    // For now, we just store them locally
  }

  /**
   * Track an error
   */
  trackError(error: Error, context?: Record<string, any>) {
    if (!this.isEnabled()) {
      return;
    }

    this.track(TelemetryEvent.ERROR_OCCURRED, {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      ...context,
    });
  }

  /**
   * Track a performance metric
   */
  trackPerformance(metric: string, value: number, properties?: Record<string, any>) {
    if (!this.isEnabled()) {
      return;
    }

    this.track(TelemetryEvent.STARTUP_TIME, properties, { [metric]: value });
  }

  /**
   * Flush events (send to server in real implementation)
   */
  async flush(): Promise<void> {
    if (!this.isEnabled() || this.eventQueue.length === 0) {
      return;
    }

    // In a real implementation, this would send events to a telemetry server
    // For now, we just log them
    logger.info('Telemetry flush', {
      eventCount: this.eventQueue.length,
      events: this.eventQueue.map(e => e.event),
    });

    // Clear the queue after "sending"
    this.eventQueue = [];
  }

  /**
   * Get telemetry statistics
   */
  getStatistics(): {
    sessionId: string;
    enabled: boolean;
    queuedEvents: number;
    totalEvents: number;
  } {
    return {
      sessionId: this.sessionId,
      enabled: this.enabled,
      queuedEvents: this.eventQueue.length,
      totalEvents: this.eventQueue.length, // In real implementation, track total sent
    };
  }

  /**
   * Export telemetry data for debugging
   */
  exportData(): string {
    return JSON.stringify({
      sessionId: this.sessionId,
      enabled: this.enabled,
      context: this.appContext,
      events: this.eventQueue,
    }, null, 2);
  }

  /**
   * Clear all telemetry data
   */
  clear() {
    this.eventQueue = [];
    this.sessionId = this.generateSessionId();
    logger.info('Telemetry data cleared');
  }

  /**
   * Privacy notice text
   */
  getPrivacyNotice(): string {
    return `JaTerm Telemetry Privacy Notice

When telemetry is enabled, JaTerm collects the following anonymous data to improve the application:

• Application version and platform information
• Feature usage statistics (which features are used, not how)
• Error reports (without personal data)
• Performance metrics

We DO NOT collect:
• Personal information or identifiers
• File contents or terminal commands
• SSH credentials or connection details
• Any data from your terminal sessions

Telemetry is completely optional and can be disabled at any time in Settings > Advanced.

All data is processed in accordance with privacy best practices and is never shared with third parties.`;
  }
}

// Export singleton instance
export const telemetry = TelemetryService.getInstance();

// Export convenience functions
export const trackEvent = (
  event: TelemetryEvent,
  properties?: Record<string, any>,
  measurements?: Record<string, number>
) => telemetry.track(event, properties, measurements);

export const trackError = (error: Error, context?: Record<string, any>) =>
  telemetry.trackError(error, context);

export const trackPerformance = (metric: string, value: number, properties?: Record<string, any>) =>
  telemetry.trackPerformance(metric, value, properties);