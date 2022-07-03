# vscode-sqflint
Integrates sqflint tool into VS code.

# Prerequisites
Java ( You no longer need to have sqflint installed as it's bundled with extension. )

Works best with [SQF Language](https://marketplace.visualstudio.com/items?itemName=Armitxes.sqf) extension.

# Debugger

Experimental debugger that'll scan RPT file for changes and output new messages and errors to console.
Go to Debug tab to create debugger config.

# Features

Debugger (just watches RPT files for new output)

![Debugger launch choice example](https://sqflint.zipek.cz/images/sqflint-debugger-launch.png)

![Debugger output example](https://sqflint.zipek.cz/images/sqflint-debugger.png)

Syntax error checking

![Error example](https://sqflint.zipek.cz/images/sqflint-error.png)

Hover support for commands and BIS functions

![Hover example](https://sqflint.zipek.cz/images/sqflint-hover.png)

Signature help for some commands

![Signature example](https://sqflint.zipek.cz/images/sqflint-signature.png)

Autocomplete for commands and BIS functions (including basic description)

![Autocomplete example](https://sqflint.zipek.cz/images/sqflint-autocomplete.png)