/** Resources owned by one mounted atlas, including callbacks created later. */
export class AtlasScope {
  disposed = false;
  private abort = new AbortController();
  private timeouts = new Set<number>();
  private intervals = new Set<number>();
  private frames = new Set<number>();

  listen(target: EventTarget, event: string, listener: EventListenerOrEventListenerObject, options: AddEventListenerOptions | boolean = {}) {
    if (this.disposed) return;
    target.addEventListener(event, listener, {
      ...(typeof options === 'boolean' ? { capture: options } : options),
      signal: this.abort.signal,
    });
  }

  timeout(callback: () => void, delay = 0): number {
    if (this.disposed) return 0;
    const id = window.setTimeout(() => {
      this.timeouts.delete(id);
      if (!this.disposed) callback();
    }, delay);
    this.timeouts.add(id);
    return id;
  }

  interval(callback: () => void, delay = 0): number {
    if (this.disposed) return 0;
    const id = window.setInterval(callback, delay);
    this.intervals.add(id);
    return id;
  }

  frame(callback: FrameRequestCallback): number {
    if (this.disposed) return 0;
    const id = requestAnimationFrame(time => {
      this.frames.delete(id);
      if (!this.disposed) callback(time);
    });
    this.frames.add(id);
    return id;
  }

  clearTimeout(id: number) { window.clearTimeout(id); this.timeouts.delete(id); }
  clearInterval(id: number) { window.clearInterval(id); this.intervals.delete(id); }
  cancelFrame(id: number) { cancelAnimationFrame(id); this.frames.delete(id); }

  guard<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
    return (...args: Args): Result | undefined => {
      if (!this.disposed) return callback(...args);
    };
  }

  dispose() {
    this.disposed = true;
    this.abort.abort();
    this.timeouts.forEach(id => window.clearTimeout(id));
    this.intervals.forEach(id => window.clearInterval(id));
    this.frames.forEach(id => cancelAnimationFrame(id));
    this.timeouts.clear();
    this.intervals.clear();
    this.frames.clear();
  }
}
