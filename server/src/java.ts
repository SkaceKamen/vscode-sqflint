import * as child from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Java {
    export function spawn(jar: string, args: string[]): child.ChildProcess {
        return child.spawn("java", [ "-jar", jar ].concat(args));
    }
}