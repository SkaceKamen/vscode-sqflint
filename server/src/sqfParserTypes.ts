// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace SqfParserTypes {
    /**
     * Base message.
     */
    class Message {
        constructor(
            public message: string,
            public range: Range
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
        macros: MacroInfo[] = [];
        includes: IncludeInfo[] = [];
        timeNeededSqfLint?: number;
        timeNeededMessagePass?: number;
    }

    export class IncludeInfo {
        /** Document where the include is used */
        document: string;
        /** Original filename used in the document */
        filename: string;
        /** Actual filename after resolving */
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
            return this.name.charAt(0) == "_";
        }
    }

    /**
     * Info about macro.
     */
    export class MacroInfo {
        name: string;
        arguments: string = null;
        definitions: MacroDefinition[];
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
        constructor(public start: Position, public end: Position, public filename?: string) {}
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
