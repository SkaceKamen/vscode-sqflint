import * as child from 'child_process';
import { resolve as pathResolve } from 'path';

export class Java {
    static customPath?: string

    static spawn(jar: string, args: string[]): child.ChildProcess {
        return child.spawn(this.getCallPath(), [ "-jar", jar ].concat(args));
    }

    static detect(): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            child.exec(`"${this.getCallPath()}" -version`, (err, _, stderr) => {
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

    private static getCallPath(): string {
        return this.customPath ? pathResolve(this.customPath) : 'java'
    }
}
