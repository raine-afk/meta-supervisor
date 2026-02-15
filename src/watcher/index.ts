import { watch } from "chokidar";
import { readFile } from "fs/promises";
import { EventEmitter } from "events";
import { relative, resolve } from "path";

export interface FileChange {
  type: "add" | "change" | "unlink";
  path: string;
  relativePath: string;
  content?: string;
  timestamp: number;
}

export class FileWatcher extends EventEmitter {
  private watcher: ReturnType<typeof watch> | null = null;
  private targetDir: string;
  private changeBuffer: FileChange[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(targetDir: string) {
    super();
    this.targetDir = resolve(targetDir);
  }

  start(): void {
    this.watcher = watch(this.targetDir, {
      ignored: [
        /(^|[\/\\])\../, // dotfiles
        /node_modules/,
        /dist/,
        /build/,
        /\.db$/,
        /\.lock$/,
        /bun\.lock/,
      ],
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on("ready", () => {
      this.emit("ready", { dir: this.targetDir });
    });

    this.watcher.on("add", (path) => this.handleChange("add", path));
    this.watcher.on("change", (path) => this.handleChange("change", path));
    this.watcher.on("unlink", (path) => this.handleChange("unlink", path));
    this.watcher.on("error", (err) => this.emit("error", err));

    this.emit("started", { dir: this.targetDir });
  }

  private async handleChange(type: "add" | "change" | "unlink", path: string): Promise<void> {
    let content: string | undefined;

    if (type !== "unlink") {
      try {
        content = await readFile(path, "utf-8");
      } catch (e) {
        // File might be gone
      }
    }

    const change: FileChange = {
      type,
      path,
      relativePath: relative(this.targetDir, path),
      content,
      timestamp: Date.now(),
    };

    this.changeBuffer.push(change);

    // Debounce — emit batch after 500ms of quiet
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const batch = [...this.changeBuffer];
      this.changeBuffer = [];
      this.emit("changes", batch);
    }, 500);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.emit("stopped");
  }

  getTargetDir(): string {
    return this.targetDir;
  }
}
