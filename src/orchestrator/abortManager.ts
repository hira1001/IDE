/**
 * Abort Manager — Manages AbortControllers for all active tasks.
 * Allows safe cancellation of all in-flight LLM API calls.
 */
export class AbortManager {
  private controllers: Map<string, AbortController> = new Map();

  register(taskId: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    return controller;
  }

  abort(taskId: string): void {
    const controller = this.controllers.get(taskId);
    if (controller) {
      controller.abort();
      this.controllers.delete(taskId);
    }
  }

  abortAll(): void {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    this.controllers.clear();
  }

  remove(taskId: string): void {
    this.controllers.delete(taskId);
  }

  clear(): void {
    this.controllers.clear();
  }
}
