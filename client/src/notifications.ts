import { NotificationHandler, NotificationType } from "vscode-languageclient";

export interface StatusBarTextParams {
    text: string;
    title?: string;
}

export interface ErrorMessageParams {
    text: string;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace StatusBarTextNotification {
    export const type = new NotificationType<StatusBarTextParams, void>('sqflint/status-bar/text');
    export type HandlerSignature = NotificationHandler<StatusBarTextParams>;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ErrorMessageNotification {
    export const type = new NotificationType<ErrorMessageParams, void>('sqflint/error-message/show');
    export type HandlerSignature = NotificationHandler<ErrorMessageParams>;
}
