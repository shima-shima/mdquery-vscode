import * as vscode from 'vscode';
import { MdQueryPanelProvider } from './panel-provider';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'mdquery.openPanel';
  context.subscriptions.push(statusBarItem);

  // Command
  const cmd = vscode.commands.registerCommand('mdquery.openPanel', () => {
    MdQueryPanelProvider.createOrShow(context, statusBarItem);
  });
  context.subscriptions.push(cmd);

  // Auto-show status bar for markdown files
  updateStatusBarVisibility();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => updateStatusBarVisibility())
  );
}

function updateStatusBarVisibility() {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.languageId === 'markdown') {
    statusBarItem.text = '$(search) MdQuery';
    statusBarItem.tooltip = 'Open MdQuery Panel';
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

export function deactivate() {}
