import { watch } from "chokidar";
import { resolve } from "path";

const dir = process.argv[2] || ".";
const resolved = resolve(dir);

console.log(`Watching: ${resolved}`);

const watcher = watch(resolved, {
  ignored: [
    /(^|[\/\\])\../, 
    /node_modules/,
    /dist/,
    /build/,
    /\.db$/,
    /\.lock$/,
  ],
  persistent: true,
  ignoreInitial: true,
});

watcher.on("ready", () => console.log("READY - watcher is ready"));
watcher.on("add", (path) => console.log(`ADD: ${path}`));
watcher.on("change", (path) => console.log(`CHANGE: ${path}`));
watcher.on("unlink", (path) => console.log(`UNLINK: ${path}`));
watcher.on("error", (err) => console.log(`ERROR: ${err}`));

console.log("Waiting for changes... (edit a file in the target dir)");
