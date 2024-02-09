import { getLocationFromOffset, getMappedOffsetAt, preprocess } from '@bi-tools/preprocessor';
import { analyzeSqf } from '@bi-tools/sqf-analyzer';
import { parseSqfTokens, tokenizeSqf } from '@bi-tools/sqf-parser';
import { ChildProcess } from "child_process";
import * as fs from 'fs';
import * as path from 'path';
import { Java } from './java';
import { Logger } from './lib/logger';
import { LoggerContext } from './lib/logger-context';

function emitLines(stream): void {
    let backlog = '';
    stream.on('data', function (data) {
        backlog += data;
        let n = backlog.indexOf('\n');
        // got a \n? emit one or more 'line' events
        while (~n) {
            stream.emit('line', backlog.substring(0, n));
            backlog = backlog.substring(n + 1);
            n = backlog.indexOf('\n');
        }
    });
    stream.on('end', function () {
        if (backlog) {
            stream.emit('line', backlog);
        }
    });
}

/**
 * Class allowing abstract interface for accessing sqflint CLI.
 */
export class SQFLint {
    // This is list of waiting results
    private waiting: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [filename: string]: ((info: SQFLint.ParseInfo) => any);
    } = {};

    // Currently running sqflint process
    private childProcess: ChildProcess;

    private logger: Logger;

    constructor(context: LoggerContext) {
        this.logger = context.createLogger('sqflint');
    }

    /**
     * Launches sqflint process and assigns basic handlers.
     */
    private launchProcess(): void {
        this.childProcess = Java.spawn(
            path.join(__dirname, "..", "bin", "SQFLint.jar"),
            [
                "-j"
                ,"-v"
                ,"-s"
                // ,"-bl"
            ]
        );

        // Fix for nodejs issue (see https://gist.github.com/TooTallNate/1785026)
        emitLines(this.childProcess.stdout);

        this.childProcess.stdout.resume();
        this.childProcess.stdout.setEncoding('utf-8');
        this.childProcess.stdout.on('line', line => this.processLine(line.toString()));

        this.childProcess.stderr.on('data', data => {
            let dataStr: string = data.toString().trim();
            if (dataStr.startsWith('\n')) {
                dataStr = dataStr.substring(1).trim();
            }
            // benchLog begin with timestamp
            // TODO find better filter
            this.logger.error(dataStr.startsWith("158") ? "" : "SQFLint: Error message", dataStr);
        });

        this.childProcess.on('error', msg => {
            this.logger.error("SQFLint: Process crashed", msg);
            this.childProcess = null;
            this.flushWaiters();
        });

        this.childProcess.on('close', code => {
            if (code != 0) {
                this.logger.error("SQFLint: Process crashed with code", code);
            } else {
                this.logger.info('Background server stopped');
            }

            this.childProcess = null;
            this.flushWaiters();
        });
    }

    /**
     * Calls all waiters with empty result and clears the waiters list.
     */
    private flushWaiters(): void {
        for (const i in this.waiting) {
            this.waiting[i](new SQFLint.ParseInfo());
        }
        this.waiting = {};
    }

    /**
     * Processes sqflint server line
     * @param line sqflint output line in server mode
     */
    private processLine(line: string): void {
        // Prepare result info
        const info = new SQFLint.ParseInfo();

        // Skip empty lines
        if (line.replace(/(\r\n|\n|\r)/gm, "").length == 0) {
            return;
        }

        // Parse message
        let serverMessage: RawServerMessage;
        try {
            serverMessage = JSON.parse(line) as RawServerMessage;
        } catch (ex) {
            console.error("SQFLint: Failed to parse server output.");
            console.error(line);
            return;
        }

        // log some bench
        info.timeNeededSqfLint = serverMessage.timeneeded;

        // Parse messages
        for (const l in serverMessage.messages) {
            this.processMessage(serverMessage.messages[l], info);
        }

        // Pass result to waiter
        const waiter = this.waiting[serverMessage.file];
        if (waiter) {
            waiter(info);
            delete this.waiting[serverMessage.file];
        } else {
            console.error("SQFLint: Received unrequested info.");
        }
    }

    /**
     * Converts raw sqflint message into specific classes.
     * @param message sqflint info message
     * @param info used to store parsed messages
     */
    private processMessage(message: RawMessage, info: SQFLint.ParseInfo): void {
        const errors: SQFLint.Error[] = info.errors;
        const warnings: SQFLint.Warning[] = info.warnings;
        const variables: SQFLint.VariableInfo[] = info.variables;
        const macros: SQFLint.Macroinfo[] = info.macros;
        const includes: SQFLint.IncludeInfo[] = info.includes;

        // Preload position if present
        let position: SQFLint.Range = null;
        if (message.line && message.column) {
            position = this.parsePosition(message);
        }

        // Create different wrappers based on type
        if (message.type == "error") {
            errors.push(new SQFLint.Error(
                message.error || message.message,
                position
            ));
        } else if (message.type == "warning") {
            warnings.push(new SQFLint.Warning(
                message.error || message.message,
                position,
                message.filename
            ));
        } else if (message.type == "variable") {
            // Build variable info wrapper
            const variable = new SQFLint.VariableInfo();

            variable.name = message.variable;
            variable.comment = this.parseComment(message.comment);
            variable.usage = [];
            variable.definitions = [];

            // We need to convert raw positions to our format (compatible with vscode format)
            for(const i in message.definitions) {
                variable.definitions.push(this.parsePosition(message.definitions[i]));
            }

            for(const i in message.usage) {
                variable.usage.push(this.parsePosition(message.usage[i]));
            }

            variables.push(variable);
        } else if (message.type == "macro") {
            const macro = new SQFLint.Macroinfo();

            macro.name = message.macro;
            macro.definitions = [];

            if (macro.name.indexOf('(') >= 0) {
                macro.arguments = macro.name.substr(macro.name.indexOf('('));
                if (macro.arguments.indexOf(')') >= 0) {
                    macro.arguments = macro.arguments.substr(0, macro.arguments.indexOf(')') + 1);
                }
                macro.name = macro.name.substr(0, macro.name.indexOf('('));
            }

            const defs = message.definitions as unknown as { range: RawMessagePosition; value: string; filename: string }[];
            for(const i in defs) {
                const definition = new SQFLint.MacroDefinition();
                definition.position = this.parsePosition(defs[i].range);
                definition.value = defs[i].value;
                definition.filename = defs[i].filename;
                macro.definitions.push(definition);
            }

            macros.push(macro);
        } else if (message.type == "include") {
            const include = new SQFLint.IncludeInfo();
            include.filename = message.include;
            include.expanded = message.expandedInclude;

            includes.push(include);
        }
    }

    /**
     * Parses content and returns result wrapped in helper classes.
     * Warning: This only queues the item, the linting will start after 200ms to prevent fooding.
     */
    public async parse(filename: string, contents: string, options: SQFLint.Options): Promise<SQFLint.ParseInfo> {
        try {
            const preprocessed = preprocess(contents, { filename });

            try {
                const preprocessed = preprocess(contents, { filename });
                const data = parseSqfTokens(tokenizeSqf(preprocessed.code), filename);
                const analysis = analyzeSqf(data);
                const sourceMap = preprocessed.sourceMap;
                const fileContents = {} as Record<string, string>;

                const getContents = async (filename: string) => {
                    if (!fileContents[filename]) {
                        fileContents[filename] = (await fs.promises.readFile(filename)).toString();
                    }
                    return fileContents[filename];
                };

                return {
                    errors: [],
                    warnings: [],
                    variables: await Promise.all(Array.from(analysis.variables.values()).map(async v => ({
                        name: v.originalName,
                        comment: '',
                        ident: v.originalName,
                        usage: [],
                        isLocal(): boolean {
                            return this.name.charAt(0) == '_';
                        },
                        definitions: await Promise.all(v.assignments.map(async d => {
                            const startOffset = getMappedOffsetAt(sourceMap, d[0], filename);
                            const endOffset = getMappedOffsetAt(sourceMap, d[1], filename);

                            const startLocation = getLocationFromOffset(startOffset.offset, await getContents(startOffset.file));
                            const endLocation = getLocationFromOffset(endOffset.offset, await getContents(endOffset.file));

                            return new SQFLint.Range(
                                new SQFLint.Position(startLocation.line - 1, startLocation.column - 1),
                                new SQFLint.Position(endLocation.line - 1, endLocation.column - 1)
                            );
                        })),
                    }))),
                    includes: [],
                    macros: [],
                };
            } catch (err) {
                console.error(err);

                console.log(preprocessed.code);

                return {
                    errors: [new SQFLint.Error(err.message, new SQFLint.Range(new SQFLint.Position(0, 0), new SQFLint.Position(0, 0)),)],
                    warnings: [],
                    variables: [],
                    includes: [],
                    macros: [],
                };
            }
        } catch (err) {
            console.error(err);

            return {
                errors: [new SQFLint.Error(err.message, new SQFLint.Range(new SQFLint.Position(0, 0), new SQFLint.Position(0, 0)),)],
                warnings: [],
                variables: [],
                includes: [],
                macros: [],
            };
        }

        /*
        // Cancel previous callback if exists
        if (this.waiting[filename]) {
            this.waiting[filename](null);
            delete(this.waiting[filename]);
        }
        return new Promise<SQFLint.ParseInfo>((success): void => {
            if (!this.childProcess) {
                this.logger.info("Starting background server...");
                this.launchProcess();
                this.logger.info("Background server started");
            }

            const startTime = new Date();
            this.waiting[filename] = (info: SQFLint.ParseInfo): void => {
                info.timeNeededMessagePass = new Date().valueOf() - startTime.valueOf();
                success(info);
            };
            this.childProcess.stdin.write(JSON.stringify({ "file": filename, "contents": contents, "options": options }) + "\n");
        });
        */
    }

    /**
     * Stops subprocess if running.
     */
    public stop(): void {
        if (this.childProcess != null) {
            this.logger.info('Stopping background server');
            this.childProcess.stdin.write(JSON.stringify({ "type": "exit" }) + "\n");
        }
    }

    /**
     * Converts raw position to result position.
     */
    private parsePosition(position: RawMessagePosition): SQFLint.Range {
        return new SQFLint.Range(
            new SQFLint.Position(position.line[0] - 1, position.column[0] - 1),
            new SQFLint.Position(position.line[1] - 1, position.column[1])
        );
    }

    /**
     * Removes comment specific characters and trims the comment.
     */
    private parseComment(comment: string): string {
        if (comment) {
            comment = comment.trim();
            if (comment.indexOf("//") == 0) {
                comment = comment.substr(2).trim();
            }

            if (comment.indexOf("/*") == 0) {
                const clines = comment.substr(2, comment.length - 4).trim().split("\n");
                for(const c in clines) {
                    let cline = clines[c].trim();
                    if (cline.indexOf("*") == 0) {
                        cline = cline.substr(1).trim();
                    }
                    clines[c] = cline;
                }
                comment = clines.filter((i) => !!i).join("\r\n").trim();
            }
        }

        return comment;
    }
}

/**
 * Raw message received from server.
 */
interface RawServerMessage {
    timeneeded?: number;
    file: string;
    messages: RawMessage[];
}

/**
 * Raw position received from sqflint CLI.
 */
interface RawMessagePosition {
    line: number[];
    column: number[];
}

/**
 * Raw message received from sqflint CLI.
 */
interface RawMessage extends RawMessagePosition {
    type: string;
    error?: string;
    message?: string;
    macro?: string;
    filename?: string;
    include?: string;
    expandedInclude?: string;

    variable?: string;
    comment?: string;
    usage: RawMessagePosition[];
    definitions: RawMessagePosition[];
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace SQFLint {
    /**
     * Base message.
     */
    class Message {
        constructor(
            public message: string,
            public range: Range,
            public filename?: string
        ) {}
    }

    /**
     * Error in code.
     */
    export class Error extends Message {}

    /**
     * Warning in code.
     */
    export class Warning extends Message {}

    /**
     * Contains info about parse result.
     */
    export class ParseInfo {
        errors: Error[] = [];
        warnings: Warning[] = [];
        variables: VariableInfo[] = [];
        macros: Macroinfo[] = [];
        includes: IncludeInfo[] = [];
        timeNeededSqfLint?: number;
        timeNeededMessagePass?: number;
    }

    export class IncludeInfo {
        filename: string;
        expanded: string;
    }

    /**
     * Contains info about variable used in document.
     */
    export class VariableInfo {
        name: string;
        ident: string;
        comment: string;
        definitions: Range[];
        usage: Range[];

        public isLocal(): boolean {
            return this.name.charAt(0) == '_';
        }
    }

    /**
     * Info about macro.
     */
    export class Macroinfo {
        name: string;
        arguments: string = null;
        definitions: MacroDefinition[]
    }

    /**
     * Info about one specific macro definition.
     */
    export class MacroDefinition {
        position: Range;
        value: string;
        filename: string;
    }

    /**
     * vscode compatible range
     */
    export class Range {
        constructor(
            public start: Position,
            public end: Position
        ) {}
    }

    /**
     * vscode compatible position
     */
    export class Position {
        constructor(
            public line: number,
            public character: number
        ) {}
    }

    export interface Options {
        checkPaths?: boolean;
        pathsRoot?: string;
        ignoredVariables?: string[];
        includePrefixes?: { [key: string]: string };
        contextSeparation?: boolean;
    }
}