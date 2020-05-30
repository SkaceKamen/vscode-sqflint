// File system used to monitor rpt files
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

class RptLine {
    public time: Date = null;
    public text: string = null;

    constructor(line: string) {
        const match = line.match(/([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}) (.*)/);
        if (match) {
            const c = new Date();

            this.time = new Date(
                c.getFullYear(), c.getMonth(), c.getDate(),
                parseInt(match[1]), parseInt(match[2]), parseInt(match[3])
            );
            this.text = match[4];
        } else {
            this.text = line;
        }
    }
}

export class RptError {
    public filename: string;
    public line: number;
    public message: string;
    public time: Date;
    public position: string;
}

export class RptMessage {
    public message: string;
    public time: Date;
}

class RptFile {
    private lastLine = 0;

    constructor(
        private monitor: RptMonitor,
        private absPath: string
    ) {}

    public notify(): void {
        fs.readFile(this.absPath, (err, data) => {
            const lines = data.toString().replace(/\n$/, '').split("\n").slice(this.lastLine);
            let error: RptError = null;
            let errorCounter = 0;

            lines.forEach(line => {
                const parse = this.parseLine(line);

                if (error) {
                    if (parse.time == null) {
                        return;
                    } else if (errorCounter == 0) {
                        const match = parse.text.match(/Error position: <(.*)/);
                        if (match) {
                            error.position = match[1];
                        }
                        errorCounter++;
                    } else if (errorCounter == 1) {
                        error.message = parse.text.trim();
                        errorCounter++;
                    } else if (errorCounter == 2) {
                        const match = parse.text.match(/File ([^,]*), line ([0-9]+)/);
                        if (match) {
                            error.filename = match[1];
                            error.line = parseInt(match[2]);
                        }
                        this.monitor.notify(this, error);
                        errorCounter = 0;
                        error = null;
                    }
                } else {
                    if (parse.text.match(/Error in expression .*/i)) {
                        error = new RptError();
                        error.time = parse.time;
                        errorCounter = 0;
                    } else {
                        const message = new RptMessage();
                        message.message = parse.text;
                        message.time = parse.time;

                        this.monitor.notify(this, message);
                    }
                }
            });

            this.lastLine += lines.length;
        });
    }

    private parseLine(line): RptLine {
        return new RptLine(line);
    }
}

export class RptMonitor extends EventEmitter {
    private watcher: fs.FSWatcher;
    private files: { [filename: string]: RptFile };

    constructor(
        private rptPath?: string
    ) {
        super();

        this.files = {};

        if (!this.rptPath) {
            this.rptPath = this.getRptPath();
        }

        this.watcher = fs.watch(this.rptPath, { persistent: true });
        this.watcher.addListener(
            'change',
            (eventType, filename) => this.onPathChange(
                this.rptPath,
                filename.toString()
            )
        );
    }

    private onPathChange(root: string, filename: string): void {
        const absPath = path.join(root, filename);

        if (path.extname(filename).toLowerCase() == ".rpt") {
            fs.exists(absPath, (exists) => {
                if (!exists) {
                    if (this.files[filename]) {
                        delete(this.files[filename]);
                    }
                } else {
                    let file = this.files[filename];
                    if (!file) {
                        file = this.files[filename] = new RptFile(this, absPath);
                    }

                    file.notify();
                }
            });
        }
    }

    public notify(source: RptFile, message: RptMessage | RptError): void {
        if (message instanceof RptMessage) {
            this.emit('message', message);
        } else {
            this.emit('error', message);
        }
    }

    private getRptPath(): string {
        return path.join(process.env.LOCALAPPDATA, 'Arma 3');
    }
}

/*
let monitor = new RptMonitor();

monitor.addListener('message', (message : RptMessage) => {
    console.log(message.message);
});

monitor.addListener('error', (error : RptError) => {
    console.log(error.message);
    console.log("  at " + error.filename + ":" + error.line);
});
*/