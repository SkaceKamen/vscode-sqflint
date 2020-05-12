import { window, StatusBarAlignment, StatusBarItem, ExtensionContext } from 'vscode';
import { LanguageClient, StaticFeature, InitializeParams, ClientCapabilities, ServerCapabilities, NotificationType, NotificationHandler, BaseLanguageClient } from "vscode-languageclient";

export class SqflintClient extends LanguageClient {
  bar: StatusBarFeature;

  protected registerBuiltinFeatures() {
    super.registerBuiltinFeatures();

    this.bar = new StatusBarFeature(this);

    this.registerFeature(this.bar);
  }
}

class StatusBarFeature implements StaticFeature {
  constructor(private _client: SqflintClient) {
    this.bar = window.createStatusBarItem(StatusBarAlignment.Left, 10);
    this.bar.tooltip = 'SQFLint status';
  }

  public bar: StatusBarItem;

  fillClientCapabilities(capabilities: ClientCapabilities) {
  }

  initialize() {
    let client = this._client;
    client.onNotification(StatusBarTextNotification.type, (params: StatusBarTextParams) => {
      this.bar.text = params.text;
      this.bar.tooltip = params.title || 'SQFLint Status';
      if (params.text) {
        this.bar.show();
      } else {
        this.bar.hide();
      }
    })
  }
}

export interface StatusBarTextParams {
  text: string;
  title?: string;
}

export namespace StatusBarTextNotification {
	export const type = new NotificationType<StatusBarTextParams, void>('sqflint/status-bar/text');
	export type HandlerSignature = NotificationHandler<StatusBarTextParams>;
}