export {};

declare global {
  interface Window {
    relayDesktop?: {
      platform: NodeJS.Platform;
      versions: {
        chrome: string;
        electron: string;
      };
    };
  }
}
