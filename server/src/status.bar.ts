import { NotificationType, NotificationHandler } from "vscode-jsonrpc";

export interface StatusBarTextParams {
  text: string;
  title?: string;
}

// eslint-disable-next-line
export namespace StatusBarTextNotification {
    export const type = new NotificationType<StatusBarTextParams, void>('sqflint/status-bar/text');
    export type HandlerSignature = NotificationHandler<StatusBarTextParams>;
}