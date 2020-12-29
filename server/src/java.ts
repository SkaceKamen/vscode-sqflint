import * as child from 'child_process';
import { resolve as pathResolve } from 'path';

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Java {
    export function spawn(jar: string, args: string[]): child.ChildProcess {
        return child.spawn("java", [ "-jar", jar ].concat(args));
    }

    export async function detect(exe?: string) {
        return new Promise<string>((resolve, reject) => {
            child.exec(`${exe ? pathResolve(exe) : 'java'} -version`, (err, _, stderr) => {
                if (err) reject(err)

                const match = stderr.match(/java version "([^"]*)"/)

                if (match) {
                    resolve(match[1])
                } else {
                    resolve('unknown')
                }
            })
        })
    }
}