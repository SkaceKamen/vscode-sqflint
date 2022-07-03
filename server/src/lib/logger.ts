/* eslint-disable @typescript-eslint/no-explicit-any */
import { LoggerContext, LoggerLevel } from "./logger-context";

export class Logger {
    context: LoggerContext;
    component: string;

    constructor(context: LoggerContext, component: string) {
        this.context = context;
        this.component = component;
    }

    log(level: LoggerLevel, ...args: any[]): void {
        if (level > this.context.level) {
            return;
        }
        
        let callback = this.context.target.log;

        if (level === LoggerLevel.Error) {
            callback = this.context.target.error;
        } else if (level === LoggerLevel.Warn) {
            callback = this.context.target.warn;
        }
        
        callback.bind(this.context.target)([
            '[' +
            new Date().toLocaleTimeString("en-US", {
                hour: "2-digit",
                hour12: false,
                minute: "2-digit",
                second: "2-digit"
            }) + ']',
            `[${LoggerLevel[level]}]`,
            `[${this.component}]`,
            ...args
        ].join(' '));
    }

    error(...args: any[]): void {
        this.log(LoggerLevel.Error, ...args);
    }

    warn(...args: any[]): void {
        this.log(LoggerLevel.Warn, ...args);
    }

    info(...args: any[]): void {
        this.log(LoggerLevel.Info, ...args);
    }

    debug(...args: any[]): void {
        this.log(LoggerLevel.Debug, ...args);
    }
}
