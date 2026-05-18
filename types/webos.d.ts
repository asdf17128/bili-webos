interface PalmServiceBridgeConstructor {
  new (): unknown;
}

interface PalmSystemServiceBridge {
  serviceBridge?: () => unknown;
}

interface WebOSServiceRequestOptions {
  method: string;
  subscribe?: boolean;
  parameters?: Record<string, unknown>;
  onSuccess?: (response: any) => void;
  onFailure?: (error: any) => void;
}

interface WebOSServiceApi {
  request: (uri: string, options: WebOSServiceRequestOptions) => void;
}

interface WebOSApi {
  service?: WebOSServiceApi;
}

declare global {
  interface Window {
    PalmServiceBridge?: PalmServiceBridgeConstructor;
    PalmSystem?: PalmSystemServiceBridge;
    webOS?: WebOSApi;
  }

  var __TEST_WINDOW__: Window | undefined;
  var __TEST_DOCUMENT__: Document | undefined;
}

export {};
