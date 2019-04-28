import { window, StatusBarAlignment, StatusBarItem } from 'vscode';
import { LanguageClient, StaticFeature, InitializeParams, ClientCapabilities, ServerCapabilities, NotificationType, NotificationHandler, BaseLanguageClient } from "vscode-languageclient";

export class SqflintClient extends LanguageClient {
  protected registerBuiltinFeatures() {
    super.registerBuiltinFeatures();

    this.registerFeature(new StatusBarFeature(this));
  }
}

class StatusBarFeature implements StaticFeature {
  constructor(private _client: BaseLanguageClient) {}

  private bar: StatusBarItem;

  getStatusBar() {
    if (!this.bar) {
      this.bar = window.createStatusBarItem(StatusBarAlignment.Right, 100);
    }
    return this.bar;
  }

  fillClientCapabilities(capabilities: ClientCapabilities) {

  }

  initialize() {
    let client = this._client;
    client.onNotification(StatusBarTextNotification.type, (params: StatusBarTextParams) => {
      this.getStatusBar().text = params.text;
      if (params.text) {
        this.getStatusBar().show();
      } else {
        this.getStatusBar().hide();
      }
    })
  }
}

export interface StatusBarTextParams {
  text: string;
}

export namespace StatusBarTextNotification {
	export const type = new NotificationType<StatusBarTextParams, void>('sqflint/status-bar/text');
	export type HandlerSignature = NotificationHandler<StatusBarTextParams>;
}