import { NotificationHandler, NotificationType } from "vscode-jsonrpc";

export interface StatusBarTextParams {
    text: string;
    title?: string;
}

export interface ErrorMessageParams {
    text: string;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace StatusBarTextNotification {
    export const type = new NotificationType<StatusBarTextParams>('sqflint/status-bar/text');
    export type HandlerSignature = NotificationHandler<StatusBarTextParams>;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ErrorMessageNotification {
    export const type = new NotificationType<ErrorMessageParams>('sqflint/error-message/show');
    export type HandlerSignature = NotificationHandler<ErrorMessageParams>;
}
