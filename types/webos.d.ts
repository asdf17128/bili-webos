interface PalmServiceBridgeConstructor {
  new (): unknown;
}

interface PalmSystemServiceBridge {
  serviceBridge?: () => unknown;
  identifier?: string;
}

interface WebOSServiceRequestOptions {
  method: string;
  subscribe?: boolean;
  parameters?: Record<string, unknown>;
  onSuccess?: (response: any) => void;
  onFailure?: (error: any) => void;
}

interface WebOSServiceRequestHandle {
  cancel?: () => void;
}

interface WebOSServiceApi {
  request: (
    uri: string,
    options: WebOSServiceRequestOptions,
  ) => WebOSServiceRequestHandle | void;
}

interface WebOSApi {
  service?: WebOSServiceApi;
  platformBack?: () => void;
  platform?: {
    tv?: {
      registerKey?: (key: string) => void;
    };
  };
  tv?: {
    registerKey?: (key: string) => void;
  };
}

declare global {
  interface Window {
    PalmServiceBridge?: PalmServiceBridgeConstructor;
    PalmSystem?: PalmSystemServiceBridge;
    webOS?: WebOSApi;
    webOSDev?: {
      registerKey?: (key: string) => void;
    };
  }

  var __TEST_WINDOW__: Window | undefined;
  var __TEST_DOCUMENT__: Document | undefined;
}

export {};
