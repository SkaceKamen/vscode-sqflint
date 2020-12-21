/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger } from "./logger";

export enum LoggerLevel {
    Error,
    Warn,
    Info,
    Debug
}

export interface LoggerContextTarget {
    log(...args: any[]): void;
    error(...args: any[]): void;
    warn(...args: any[]): void;
}

export class LoggerContext {
    level = LoggerLevel.Info
    target: LoggerContextTarget = console

    createLogger(component: string): Logger {
        return new Logger(this, component)
    }
}
