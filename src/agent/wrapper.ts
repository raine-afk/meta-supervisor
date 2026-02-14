import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";

export interface AgentOutput {
  type: "stdout" | "stderr" | "exit";
  data: string;
  timestamp: number;
}

export class AgentWrapper extends EventEmitter {
  private process: ChildProcess | null = null;
  private outputLog: AgentOutput[] = [];
  private command: string;
  private args: string[];
  private cwd: string;

  constructor(command: string, args: string[], cwd: string) {
    super();
    this.command = command;
    this.args = args;
    this.cwd = cwd;
  }

  start(): void {
    this.process = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, PATH: `${process.env.HOME}/.opencode/bin:${process.env.HOME}/.bun/bin:${process.env.PATH}` },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      const output: AgentOutput = {
        type: "stdout",
        data: data.toString(),
        timestamp: Date.now(),
      };
      this.outputLog.push(output);
      this.emit("output", output);
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

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}
