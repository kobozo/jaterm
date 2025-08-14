// Centralized event names/types used across the app
export const Channels = {
  PTY_OUTPUT: 'PTY_OUTPUT',
  PTY_EXIT: 'PTY_EXIT',
  GIT_STATUS: 'GIT_STATUS',
  WATCH_EVENT: 'WATCH_EVENT',
} as const;

export type ChannelName = typeof Channels[keyof typeof Channels];

