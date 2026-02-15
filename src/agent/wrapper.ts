import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";

export interface AgentOutput {
  type: "stdout" | "stderr" | "exit" | "tool_use" | "thinking";
  data: string;
  timestamp: number;
}

// Strip ANSI escape codes for parsing
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

export class AgentWrapper extends EventEmitter {
  private process: ChildProcess | null = null;
  private outputLog: AgentOutput[] = [];
  private command: string;
  private args: string[];
  private cwd: string;
  private rawBuffer = "";

  constructor(command: string, args: string[], cwd: string) {
    super();
    this.command = command;
    this.args = args;
    this.cwd = cwd;
  }

  start(): void {
    this.process = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.opencode/bin:${process.env.HOME}/.bun/bin:${process.env.PATH}`,
        TERM: "xterm-256color",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      this.rawBuffer += text;
      
      const output: AgentOutput = {
        type: "stdout",
        data: text,
        timestamp: Date.now(),
      };
      this.outputLog.push(output);
      this.emit("output", output);

      // Parse OpenCode-specific events from output
      this.parseAgentOutput(text);
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      const output: AgentOutput = {
        type: "stderr",
        data: data.toString(),
        timestamp: Date.now(),
      };
      this.outputLog.push(output);
      this.emit("output", output);
    });

    this.process.on("exit", (code) => {
      const output: AgentOutput = {
        type: "exit",
        data: `Process exited with code ${code}`,
        timestamp: Date.now(),
      };
      this.outputLog.push(output);
      this.emit("exit", code);
    });

    this.emit("started", { command: this.command, args: this.args });
  }

  /**
   * Parse OpenCode's stdout for tool uses (file writes, reads, commands)
   */
  private parseAgentOutput(raw: string): void {
    const clean = stripAnsi(raw);

    // Detect file writes: "← Write src/foo.ts" or "← Edit src/foo.ts"
    const writeMatch = clean.match(/[←←]\s*(Write|Edit)\s+(.+)/);
    if (writeMatch) {
      this.emit("tool_use", {
        tool: writeMatch[1].toLowerCase(),
        file: writeMatch[2].trim(),
        timestamp: Date.now(),
      });
    }

    // Detect file reads: "→ Read src/foo.ts"
    const readMatch = clean.match(/[→→]\s*Read\s+(.+)/);
    if (readMatch) {
      this.emit("tool_use", {
        tool: "read",
        file: readMatch[1].trim(),
        timestamp: Date.now(),
      });
    }

    // Detect bash commands: "$ command"
    const bashMatch = clean.match(/\$\s+(.+)/);
    if (bashMatch) {
      this.emit("tool_use", {
        tool: "bash",
        command: bashMatch[1].trim(),
        timestamp: Date.now(),
      });
    }

    // Detect glob/grep: "✱ Glob/Grep ..."
    const searchMatch = clean.match(/[✱✱]\s*(Glob|Grep)\s+(.+)/);
    if (searchMatch) {
      this.emit("tool_use", {
        tool: searchMatch[1].toLowerCase(),
        query: searchMatch[2].trim(),
        timestamp: Date.now(),
      });
    }
  }

  sendInput(text: string): void {
    if (this.process?.stdin?.writable) {
      this.process.stdin.write(text + "\n");
    }
  }

  kill(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  getOutput(): AgentOutput[] {
    return [...this.outputLog];
  }

  getLastOutput(n: number = 10): string {
    return this.outputLog
      .slice(-n)
      .map((o) => o.data)
      .join("");
  }

  getRawBuffer(): string {
    return this.rawBuffer;
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}

/**
 * Convenience: run OpenCode with a prompt and return when done
 */
export function runOpenCode(
  prompt: string,
  cwd: string,
  model: string = "opencode/minimax-m2.5-free"
): Promise<{ output: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const agent = new AgentWrapper("opencode", ["run", "--model", model, prompt], cwd);
    let output = "";

    agent.on("output", (o: AgentOutput) => {
      output += o.data;
    });

    agent.on("exit", (code: number | null) => {
      resolve({ output: stripAnsi(output), exitCode: code });
    });

    agent.start();

    // Safety timeout
    setTimeout(() => {
      if (agent.isRunning()) {
        agent.kill();
        resolve({ output: stripAnsi(output), exitCode: -1 });
      }
    }, 120000);
  });
}
