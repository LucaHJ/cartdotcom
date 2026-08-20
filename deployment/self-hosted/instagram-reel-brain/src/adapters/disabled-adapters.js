export class DisabledAdapterError extends Error {
  constructor(adapter, operation) {
    super(`${adapter} adapter is disabled during Phase 2 (${operation})`);
    this.name = "DisabledAdapterError";
    this.code = "adapter_disabled";
    this.adapter = adapter;
    this.operation = operation;
  }
}

function disabled(adapter) {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === "enabled") return false;
      if (prop === "adapterName") return adapter;
      return async () => {
        throw new DisabledAdapterError(adapter, String(prop));
      };
    },
  });
}

export function disabledWhisperAdapter() {
  return disabled("cloudflare-whisper");
}

export function disabledBrowserRenderingAdapter() {
  return disabled("cloudflare-browser-rendering");
}

export function disabledR2MirrorAdapter() {
  return disabled("r2-mirror");
}

export function disabledKvLibraryPublisher() {
  return disabled("kv-library-publication");
}

export function disabledInstagramOutboundAdapter() {
  return disabled("instagram-outbound");
}

export function disabledAdapterSet() {
  return {
    whisper: disabledWhisperAdapter(),
    browserRendering: disabledBrowserRenderingAdapter(),
    r2Mirror: disabledR2MirrorAdapter(),
    kvLibrary: disabledKvLibraryPublisher(),
    instagramOutbound: disabledInstagramOutboundAdapter(),
  };
}
